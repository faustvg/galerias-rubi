from datetime import date, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.auth import get_usuario_actual, UsuarioActual
from api.database import get_db
from api.routers.notas import _armar_etiqueta

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

VENTANAS_DIAS = frozenset({7, 14, 30})


# ---------------------------------------------------------------------------
# GET /dashboard/resumen
# ---------------------------------------------------------------------------

@router.get("/resumen")
async def resumen(
    ventana: int = Query(default=7),
    usuario: UsuarioActual = Depends(get_usuario_actual),
    conn=Depends(get_db),
):
    """
    Ventas recientes (en la ventana de días indicada) + resta pendiente total.
    Worker ve solo sus propias notas; otros roles ven todo el negocio.
    """
    if ventana not in VENTANAS_DIAS:
        raise HTTPException(status_code=422, detail="ventana debe ser 7, 14 o 30")

    delta = timedelta(days=ventana)  # psycopg3 envía esto como un interval de PostgreSQL
    es_worker = usuario.rol == "worker"

    async with conn.cursor() as cur:
        # ── Ventas recientes ──────────────────────────────────────────────────
        if es_worker:
            await cur.execute(
                """
                SELECT COALESCE(SUM(total), 0), COUNT(*)
                FROM notas
                WHERE estatus != 'Cancelado'
                  AND fecha_pedido >= CURRENT_DATE - %s
                  AND usuario_id = %s
                """,
                (delta, usuario.id),
            )
        else:
            await cur.execute(
                """
                SELECT COALESCE(SUM(total), 0), COUNT(*)
                FROM notas
                WHERE estatus != 'Cancelado'
                  AND fecha_pedido >= CURRENT_DATE - %s
                """,
                (delta,),
            )
        v = await cur.fetchone()

        # ── Resta pendiente ───────────────────────────────────────────────────
        if es_worker:
            await cur.execute(
                """
                SELECT COALESCE(SUM(resta), 0), COUNT(*)
                FROM notas
                WHERE estatus NOT IN ('Entregado', 'Cancelado')
                  AND resta > 0
                  AND usuario_id = %s
                """,
                (usuario.id,),
            )
        else:
            await cur.execute(
                """
                SELECT COALESCE(SUM(resta), 0), COUNT(*)
                FROM notas
                WHERE estatus NOT IN ('Entregado', 'Cancelado')
                  AND resta > 0
                """
            )
        r = await cur.fetchone()

    return {
        "ventana_dias":      ventana,
        "total_ventas":      float(v[0] or 0),
        "num_notas_ventas":  int(v[1] or 0),
        "resta_total":       float(r[0] or 0),
        "num_notas_resta":   int(r[1] or 0),
    }


# ---------------------------------------------------------------------------
# GET /dashboard/entregas-proximas
# ---------------------------------------------------------------------------

@router.get("/entregas-proximas")
async def entregas_proximas(
    usuario: UsuarioActual = Depends(get_usuario_actual),
    conn=Depends(get_db),
):
    """
    Notas no entregadas con fecha_entrega en los próximos 30 días, ordenadas
    por fecha. Incluye la etiqueta automática (mueble ancla + fecha) en lugar
    del nombre del cliente. Worker ve solo las suyas.

    Columnas del SELECT:
      r[0] folio, r[1] fecha_pedido, r[2] fecha_entrega,
      r[3] total, r[4] resta, r[5] estatus,
      r[6] num_partidas, r[7] nombre_ancla
    """
    es_worker = usuario.rol == "worker"

    _SQL = """
        SELECT
            n.folio,
            n.fecha_pedido,
            n.fecha_entrega,
            n.total,
            n.resta,
            n.estatus,
            (SELECT COUNT(*) FROM partidas par WHERE par.folio_pedido = n.folio)
                AS num_partidas,
            (
                SELECT COALESCE(pr.nombre, 'Artículo')
                FROM   partidas par
                LEFT   JOIN productos pr ON pr.id = par.producto_id
                WHERE  par.folio_pedido = n.folio
                ORDER  BY par.precio_unitario DESC, par.id
                LIMIT  1
            ) AS nombre_ancla
        FROM notas n
        WHERE n.estatus NOT IN ('Entregado', 'Cancelado')
          AND n.fecha_entrega IS NOT NULL
          AND n.fecha_entrega >= CURRENT_DATE
          AND n.fecha_entrega <= CURRENT_DATE + INTERVAL '30 days'
    """

    async with conn.cursor() as cur:
        if es_worker:
            await cur.execute(_SQL + " AND n.usuario_id = %s ORDER BY n.fecha_entrega ASC LIMIT 15", (usuario.id,))
        else:
            await cur.execute(_SQL + " ORDER BY n.fecha_entrega ASC LIMIT 15")
        rows = await cur.fetchall()

    return [
        {
            "folio":         r[0],
            "etiqueta":      _armar_etiqueta(r[7], r[6], r[1], r[0], r[2]),
            "fecha_entrega": r[2].isoformat() if r[2] else None,
            "total":         float(r[3] or 0),
            "resta":         float(r[4] or 0),
            "estatus":       r[5],
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# GET /dashboard/utilidad
# ---------------------------------------------------------------------------

@router.get("/utilidad")
async def utilidad(
    usuario: UsuarioActual = Depends(get_usuario_actual),
    conn=Depends(get_db),
):
    """
    Desglose de utilidad estimada (precio_base - costo) de los productos vendidos,
    agrupada por categoría, proveedor y worker.

    Worker ve solo sus propias notas. El desglose por worker (comparación entre
    vendedores) solo se devuelve para admin / superadmin / viewer — los workers
    nunca ven los números de sus compañeros.

    Partidas con producto_id NULL (ítems fuera de catálogo) se excluyen del
    cálculo de utilidad porque no tienen costo registrado.
    """
    es_worker = usuario.rol == "worker"

    async with conn.cursor() as cur:

        # ── Utilidad por categoría ─────────────────────────────────────────────
        if es_worker:
            await cur.execute(
                """
                SELECT
                    COALESCE(c.nombre, 'Sin categoría') AS nombre,
                    COALESCE(SUM(par.cantidad * (prod.precio_base - prod.costo)), 0) AS utilidad
                FROM partidas par
                JOIN notas n ON n.folio = par.folio_pedido
                JOIN productos prod ON prod.id = par.producto_id
                LEFT JOIN categorias c ON c.id = prod.categoria_id
                WHERE n.estatus != 'Cancelado'
                  AND n.usuario_id = %s
                GROUP BY c.nombre
                ORDER BY utilidad DESC
                """,
                (usuario.id,),
            )
        else:
            await cur.execute(
                """
                SELECT
                    COALESCE(c.nombre, 'Sin categoría') AS nombre,
                    COALESCE(SUM(par.cantidad * (prod.precio_base - prod.costo)), 0) AS utilidad
                FROM partidas par
                JOIN notas n ON n.folio = par.folio_pedido
                JOIN productos prod ON prod.id = par.producto_id
                LEFT JOIN categorias c ON c.id = prod.categoria_id
                WHERE n.estatus != 'Cancelado'
                GROUP BY c.nombre
                ORDER BY utilidad DESC
                """
            )
        cat_rows = await cur.fetchall()

        # ── Utilidad por proveedor ─────────────────────────────────────────────
        if es_worker:
            await cur.execute(
                """
                SELECT
                    COALESCE(prov.proveedor, 'Sin proveedor') AS nombre,
                    COALESCE(SUM(par.cantidad * (prod.precio_base - prod.costo)), 0) AS utilidad
                FROM partidas par
                JOIN notas n ON n.folio = par.folio_pedido
                JOIN productos prod ON prod.id = par.producto_id
                LEFT JOIN proveedores prov ON prov.id = prod.proveedor_id
                WHERE n.estatus != 'Cancelado'
                  AND n.usuario_id = %s
                GROUP BY prov.proveedor
                ORDER BY utilidad DESC
                """,
                (usuario.id,),
            )
        else:
            await cur.execute(
                """
                SELECT
                    COALESCE(prov.proveedor, 'Sin proveedor') AS nombre,
                    COALESCE(SUM(par.cantidad * (prod.precio_base - prod.costo)), 0) AS utilidad
                FROM partidas par
                JOIN notas n ON n.folio = par.folio_pedido
                JOIN productos prod ON prod.id = par.producto_id
                LEFT JOIN proveedores prov ON prov.id = prod.proveedor_id
                WHERE n.estatus != 'Cancelado'
                GROUP BY prov.proveedor
                ORDER BY utilidad DESC
                """
            )
        prov_rows = await cur.fetchall()

        # ── Utilidad por worker (solo admin / superadmin / viewer) ────────────
        worker_rows = None
        if not es_worker:
            await cur.execute(
                """
                SELECT
                    COALESCE(uv.nombre, n.vendedor, 'Sin asignar') AS nombre,
                    COALESCE(SUM(par.cantidad * (prod.precio_base - prod.costo)), 0) AS utilidad
                FROM partidas par
                JOIN notas n ON n.folio = par.folio_pedido
                JOIN productos prod ON prod.id = par.producto_id
                LEFT JOIN usuarios uv ON uv.id = n.vendedor_id
                WHERE n.estatus != 'Cancelado'
                GROUP BY 1
                ORDER BY utilidad DESC
                """
            )
            worker_rows = await cur.fetchall()

    return {
        "por_categoria": [
            {"nombre": r[0], "utilidad": float(r[1] or 0)} for r in cat_rows
        ],
        "por_proveedor": [
            {"nombre": r[0], "utilidad": float(r[1] or 0)} for r in prov_rows
        ],
        "por_worker": [
            {"nombre": r[0], "utilidad": float(r[1] or 0)} for r in worker_rows
        ] if worker_rows is not None else None,
    }


# ---------------------------------------------------------------------------
# GET /dashboard/historico/resumen
# ---------------------------------------------------------------------------

@router.get("/historico/resumen")
async def historico_resumen(
    fecha_desde: date = Query(..., description="Inicio del periodo (YYYY-MM-DD, inclusive)"),
    fecha_hasta: date = Query(..., description="Fin del periodo (YYYY-MM-DD, inclusive)"),
    usuario: UsuarioActual = Depends(get_usuario_actual),
    conn=Depends(get_db),
):
    """
    Resumen de un periodo pasado: ventas totales, resta pendiente generada
    en el periodo, y lista de entregas que se completaron en él.

    - Ventas: notas con fecha_pedido en el rango (estatus != Cancelado).
    - Resta pendiente: notas del periodo aún abiertas (no Entregado/Cancelado) con resta > 0.
    - Entregadas: notas con estatus = 'Entregado' y fecha_entrega en el rango.

    Worker ve solo sus propias notas; el aislamiento va en el SQL.
    """
    es_worker = usuario.rol == "worker"

    async with conn.cursor() as cur:

        # ── Ventas del periodo ─────────────────────────────────────────────────
        if es_worker:
            await cur.execute(
                """
                SELECT COALESCE(SUM(total), 0), COUNT(*)
                FROM notas
                WHERE estatus != 'Cancelado'
                  AND fecha_pedido BETWEEN %s AND %s
                  AND usuario_id = %s
                """,
                (fecha_desde, fecha_hasta, usuario.id),
            )
        else:
            await cur.execute(
                """
                SELECT COALESCE(SUM(total), 0), COUNT(*)
                FROM notas
                WHERE estatus != 'Cancelado'
                  AND fecha_pedido BETWEEN %s AND %s
                """,
                (fecha_desde, fecha_hasta),
            )
        v = await cur.fetchone()

        # ── Resta pendiente de notas del periodo ───────────────────────────────
        if es_worker:
            await cur.execute(
                """
                SELECT COALESCE(SUM(resta), 0), COUNT(*)
                FROM notas
                WHERE estatus NOT IN ('Entregado', 'Cancelado')
                  AND resta > 0
                  AND fecha_pedido BETWEEN %s AND %s
                  AND usuario_id = %s
                """,
                (fecha_desde, fecha_hasta, usuario.id),
            )
        else:
            await cur.execute(
                """
                SELECT COALESCE(SUM(resta), 0), COUNT(*)
                FROM notas
                WHERE estatus NOT IN ('Entregado', 'Cancelado')
                  AND resta > 0
                  AND fecha_pedido BETWEEN %s AND %s
                """,
                (fecha_desde, fecha_hasta),
            )
        p = await cur.fetchone()

        # ── Entregas completadas en el periodo ─────────────────────────────────
        # notas con estatus = 'Entregado' y fecha_entrega dentro del rango.
        # Incluye subqueries para armar la etiqueta automática.
        #   row[0] folio, row[1] fecha_pedido, row[2] fecha_entrega,
        #   row[3] total, row[4] resta, row[5] estatus,
        #   row[6] num_partidas, row[7] nombre_ancla
        _SQL_ENT = """
            SELECT
                n.folio, n.fecha_pedido, n.fecha_entrega,
                n.total, n.resta, n.estatus,
                (SELECT COUNT(*) FROM partidas par WHERE par.folio_pedido = n.folio)
                    AS num_partidas,
                (
                    SELECT COALESCE(pr.nombre, 'Artículo')
                    FROM   partidas par
                    LEFT   JOIN productos pr ON pr.id = par.producto_id
                    WHERE  par.folio_pedido = n.folio
                    ORDER  BY par.precio_unitario DESC, par.id
                    LIMIT  1
                ) AS nombre_ancla
            FROM notas n
            WHERE n.estatus = 'Entregado'
              AND n.fecha_entrega BETWEEN %s AND %s
        """
        if es_worker:
            await cur.execute(
                _SQL_ENT + " AND n.usuario_id = %s ORDER BY n.fecha_entrega DESC LIMIT 50",
                (fecha_desde, fecha_hasta, usuario.id),
            )
        else:
            await cur.execute(
                _SQL_ENT + " ORDER BY n.fecha_entrega DESC LIMIT 50",
                (fecha_desde, fecha_hasta),
            )
        ent_rows = await cur.fetchall()

    return {
        "fecha_desde":     fecha_desde.isoformat(),
        "fecha_hasta":     fecha_hasta.isoformat(),
        "total_ventas":    float(v[0] or 0),
        "num_notas":       int(v[1] or 0),
        "resta_pendiente": float(p[0] or 0),
        "num_notas_resta": int(p[1] or 0),
        "entregadas": [
            {
                "folio":         row[0],
                "etiqueta":      _armar_etiqueta(row[7], row[6], row[1], row[0], row[2]),
                "fecha_entrega": row[2].isoformat() if row[2] else None,
                "total":         float(row[3] or 0),
            }
            for row in ent_rows
        ],
    }


# ---------------------------------------------------------------------------
# GET /dashboard/historico/utilidad
# ---------------------------------------------------------------------------

@router.get("/historico/utilidad")
async def historico_utilidad(
    fecha_desde: date = Query(..., description="Inicio del periodo (YYYY-MM-DD, inclusive)"),
    fecha_hasta: date = Query(..., description="Fin del periodo (YYYY-MM-DD, inclusive)"),
    usuario: UsuarioActual = Depends(get_usuario_actual),
    conn=Depends(get_db),
):
    """
    Desglose de utilidad estimada (precio_base - costo) por categoría, proveedor
    y vendedor para el periodo indicado. Filtra por fecha_pedido.

    Worker ve solo sus notas; el desglose por vendedor solo para admin+.
    Artículos sin producto_id (fuera de catálogo) se excluyen — no tienen costo.
    """
    es_worker = usuario.rol == "worker"

    async with conn.cursor() as cur:

        # ── Por categoría ──────────────────────────────────────────────────────
        if es_worker:
            await cur.execute(
                """
                SELECT
                    COALESCE(c.nombre, 'Sin categoría') AS nombre,
                    COALESCE(SUM(par.cantidad * (prod.precio_base - prod.costo)), 0) AS utilidad
                FROM partidas par
                JOIN notas n ON n.folio = par.folio_pedido
                JOIN productos prod ON prod.id = par.producto_id
                LEFT JOIN categorias c ON c.id = prod.categoria_id
                WHERE n.estatus != 'Cancelado'
                  AND n.fecha_pedido BETWEEN %s AND %s
                  AND n.usuario_id = %s
                GROUP BY c.nombre ORDER BY utilidad DESC
                """,
                (fecha_desde, fecha_hasta, usuario.id),
            )
        else:
            await cur.execute(
                """
                SELECT
                    COALESCE(c.nombre, 'Sin categoría') AS nombre,
                    COALESCE(SUM(par.cantidad * (prod.precio_base - prod.costo)), 0) AS utilidad
                FROM partidas par
                JOIN notas n ON n.folio = par.folio_pedido
                JOIN productos prod ON prod.id = par.producto_id
                LEFT JOIN categorias c ON c.id = prod.categoria_id
                WHERE n.estatus != 'Cancelado'
                  AND n.fecha_pedido BETWEEN %s AND %s
                GROUP BY c.nombre ORDER BY utilidad DESC
                """,
                (fecha_desde, fecha_hasta),
            )
        cat_rows = await cur.fetchall()

        # ── Por proveedor ──────────────────────────────────────────────────────
        if es_worker:
            await cur.execute(
                """
                SELECT
                    COALESCE(prov.proveedor, 'Sin proveedor') AS nombre,
                    COALESCE(SUM(par.cantidad * (prod.precio_base - prod.costo)), 0) AS utilidad
                FROM partidas par
                JOIN notas n ON n.folio = par.folio_pedido
                JOIN productos prod ON prod.id = par.producto_id
                LEFT JOIN proveedores prov ON prov.id = prod.proveedor_id
                WHERE n.estatus != 'Cancelado'
                  AND n.fecha_pedido BETWEEN %s AND %s
                  AND n.usuario_id = %s
                GROUP BY prov.proveedor ORDER BY utilidad DESC
                """,
                (fecha_desde, fecha_hasta, usuario.id),
            )
        else:
            await cur.execute(
                """
                SELECT
                    COALESCE(prov.proveedor, 'Sin proveedor') AS nombre,
                    COALESCE(SUM(par.cantidad * (prod.precio_base - prod.costo)), 0) AS utilidad
                FROM partidas par
                JOIN notas n ON n.folio = par.folio_pedido
                JOIN productos prod ON prod.id = par.producto_id
                LEFT JOIN proveedores prov ON prov.id = prod.proveedor_id
                WHERE n.estatus != 'Cancelado'
                  AND n.fecha_pedido BETWEEN %s AND %s
                GROUP BY prov.proveedor ORDER BY utilidad DESC
                """,
                (fecha_desde, fecha_hasta),
            )
        prov_rows = await cur.fetchall()

        # ── Por vendedor (solo admin / superadmin / viewer) ────────────────────
        worker_rows = None
        if not es_worker:
            await cur.execute(
                """
                SELECT
                    COALESCE(uv.nombre, n.vendedor, 'Sin asignar') AS nombre,
                    COALESCE(SUM(par.cantidad * (prod.precio_base - prod.costo)), 0) AS utilidad
                FROM partidas par
                JOIN notas n ON n.folio = par.folio_pedido
                JOIN productos prod ON prod.id = par.producto_id
                LEFT JOIN usuarios uv ON uv.id = n.vendedor_id
                WHERE n.estatus != 'Cancelado'
                  AND n.fecha_pedido BETWEEN %s AND %s
                GROUP BY 1 ORDER BY utilidad DESC
                """,
                (fecha_desde, fecha_hasta),
            )
            worker_rows = await cur.fetchall()

    return {
        "por_categoria": [
            {"nombre": r[0], "utilidad": float(r[1] or 0)} for r in cat_rows
        ],
        "por_proveedor": [
            {"nombre": r[0], "utilidad": float(r[1] or 0)} for r in prov_rows
        ],
        "por_worker": [
            {"nombre": r[0], "utilidad": float(r[1] or 0)} for r in worker_rows
        ] if worker_rows is not None else None,
    }


# ---------------------------------------------------------------------------
# GET /dashboard/ingresos-productos
# ---------------------------------------------------------------------------
# Cuántas UNIDADES de inventario entraron por periodo (semana/mes),
# opcionalmente filtrado por proveedor. Usa movimientos_inventario (migración
# 008), no productos.fecha_ingreso — fecha_ingreso solo marca la primera vez
# que un MODELO entra al catálogo; movimientos_inventario tiene cada llegada
# por separado con su propia cantidad, así que SUM(cantidad) da el historial
# real de arribos, incluyendo restocks — que es justo lo que esta vista
# necesita mostrar.
# ---------------------------------------------------------------------------

_AGRUPACION_A_TRUNC = {"semana": "week", "mes": "month"}


@router.get("/ingresos-productos")
async def ingresos_productos(
    agrupacion: Literal["semana", "mes"] = Query("mes"),
    proveedor_id: Optional[int] = Query(None, description="Filtrar por proveedor"),
    _usuario: UsuarioActual = Depends(get_usuario_actual),
    conn=Depends(get_db),
):
    # agrupacion ya viene validada por Literal, pero igual la mapeamos a un
    # valor fijo nuestro (nunca el texto crudo del cliente) antes de pasarla
    # a date_trunc — no hay atajo de parámetro %s para el nombre de unidad
    # de date_trunc, así que esta es la manera segura de fijarla.
    trunc_unit = _AGRUPACION_A_TRUNC[agrupacion]

    sql = f"""
        SELECT
            date_trunc('{trunc_unit}', m.fecha)::date AS periodo,
            COALESCE(prov.proveedor, 'Sin proveedor') AS proveedor,
            SUM(m.cantidad) AS unidades_ingresadas
        FROM  movimientos_inventario m
        JOIN  productos    p    ON p.id    = m.producto_id
        LEFT  JOIN proveedores prov ON prov.id = p.proveedor_id
        WHERE 1 = 1
    """
    params: list = []
    if proveedor_id is not None:
        sql += " AND p.proveedor_id = %s"
        params.append(proveedor_id)

    # GROUP BY 1, 2 por posición — no por alias — para evitar el mismo
    # AmbiguousColumn que ya mordió a utilidad-por-worker si algún día esta
    # consulta también hace JOIN con categorias (categorias.nombre chocaría
    # con cualquier alias de nombre en el SELECT).
    sql += " GROUP BY 1, 2 ORDER BY 1, 2"

    async with conn.cursor() as cur:
        await cur.execute(sql, params)
        rows = await cur.fetchall()

    return [
        {
            "periodo":              r[0].isoformat(),
            "proveedor":            r[1],
            "unidades_ingresadas":  r[2],
        }
        for r in rows
    ]
