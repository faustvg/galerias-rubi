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

        # ── Utilidad por sucursal ───────────────────────────────────────────────
        # Panel combinado: no es una restricción de acceso, es un desglose más
        # (mismo patrón que categoría/proveedor) — worker también lo ve, solo
        # limitado a sus propias notas como el resto de los desgloses.
        if es_worker:
            await cur.execute(
                """
                SELECT
                    COALESCE(s.nombre, 'Sin sucursal') AS nombre,
                    COALESCE(SUM(par.cantidad * (prod.precio_base - prod.costo)), 0) AS utilidad
                FROM partidas par
                JOIN notas n ON n.folio = par.folio_pedido
                JOIN productos prod ON prod.id = par.producto_id
                LEFT JOIN sucursales s ON s.id = n.sucursal_id
                WHERE n.estatus != 'Cancelado'
                  AND n.usuario_id = %s
                GROUP BY s.nombre
                ORDER BY utilidad DESC
                """,
                (usuario.id,),
            )
        else:
            await cur.execute(
                """
                SELECT
                    COALESCE(s.nombre, 'Sin sucursal') AS nombre,
                    COALESCE(SUM(par.cantidad * (prod.precio_base - prod.costo)), 0) AS utilidad
                FROM partidas par
                JOIN notas n ON n.folio = par.folio_pedido
                JOIN productos prod ON prod.id = par.producto_id
                LEFT JOIN sucursales s ON s.id = n.sucursal_id
                WHERE n.estatus != 'Cancelado'
                GROUP BY s.nombre
                ORDER BY utilidad DESC
                """
            )
        suc_rows = await cur.fetchall()

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
        "por_sucursal": [
            {"nombre": r[0], "utilidad": float(r[1] or 0)} for r in suc_rows
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

        # ── Por sucursal ────────────────────────────────────────────────────────
        if es_worker:
            await cur.execute(
                """
                SELECT
                    COALESCE(s.nombre, 'Sin sucursal') AS nombre,
                    COALESCE(SUM(par.cantidad * (prod.precio_base - prod.costo)), 0) AS utilidad
                FROM partidas par
                JOIN notas n ON n.folio = par.folio_pedido
                JOIN productos prod ON prod.id = par.producto_id
                LEFT JOIN sucursales s ON s.id = n.sucursal_id
                WHERE n.estatus != 'Cancelado'
                  AND n.fecha_pedido BETWEEN %s AND %s
                  AND n.usuario_id = %s
                GROUP BY s.nombre ORDER BY utilidad DESC
                """,
                (fecha_desde, fecha_hasta, usuario.id),
            )
        else:
            await cur.execute(
                """
                SELECT
                    COALESCE(s.nombre, 'Sin sucursal') AS nombre,
                    COALESCE(SUM(par.cantidad * (prod.precio_base - prod.costo)), 0) AS utilidad
                FROM partidas par
                JOIN notas n ON n.folio = par.folio_pedido
                JOIN productos prod ON prod.id = par.producto_id
                LEFT JOIN sucursales s ON s.id = n.sucursal_id
                WHERE n.estatus != 'Cancelado'
                  AND n.fecha_pedido BETWEEN %s AND %s
                GROUP BY s.nombre ORDER BY utilidad DESC
                """,
                (fecha_desde, fecha_hasta),
            )
        suc_rows = await cur.fetchall()

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
        "por_sucursal": [
            {"nombre": r[0], "utilidad": float(r[1] or 0)} for r in suc_rows
        ],
        "por_worker": [
            {"nombre": r[0], "utilidad": float(r[1] or 0)} for r in worker_rows
        ] if worker_rows is not None else None,
    }


# ---------------------------------------------------------------------------
# Convención semana/mes — compartida por todos los reportes agrupados de
# este archivo.
#
# date_trunc('week', fecha) en PostgreSQL ya trunca a LUNES por defecto
# (definición de semana ISO 8601) — no hace falta lógica de límite de
# semana a mano.
#
# Para la etiqueta "Semana N.AAAA" (convención Kalenderwoche / KW que la
# familia ya usa): se computa en Python con date.isocalendar(), que da
# (año ISO, semana ISO, día de la semana ISO) — año ISO, NO el año de
# calendario, porque pueden diferir en fechas cerca del límite de año
# (ej. el 31 de diciembre puede caer en la semana 1 del año ISO siguiente).
# isocalendar() usa la misma definición ISO 8601 que date_trunc('week', …)
# de Postgres, así que ambos siempre concuerdan.
# ---------------------------------------------------------------------------

_AGRUPACION_A_TRUNC = {"semana": "week", "mes": "month"}


def _etiqueta_periodo(periodo, agrupacion: str) -> Optional[str]:
    if agrupacion != "semana":
        return None
    iso_year, iso_week, _ = periodo.isocalendar()
    return f"Semana {iso_week}.{iso_year}"


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
            "etiqueta":             _etiqueta_periodo(r[0], agrupacion),
            "proveedor":            r[1],
            "unidades_ingresadas":  r[2],
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# GET /dashboard/gasto-restock
# ---------------------------------------------------------------------------
# Cuánto se gastó reabasteciendo inventario, por periodo (semana/mes), y por
# proveedor + ubicación (migración 010: movimientos_inventario ahora guarda
# costo_unitario/costo_total y proveedor_id POR LOTE — no el proveedor por
# defecto del producto, sino de dónde vino ESE restock específico).
#
# Movimientos sin costo capturado (costo_unitario NULL, opcional a propósito
# — no siempre hay factura a la mano al momento de registrar) se excluyen:
# no tiene sentido un renglón "$0 gastado" mezclado con gasto real.
# ---------------------------------------------------------------------------

@router.get("/gasto-restock")
async def gasto_restock(
    agrupacion: Literal["semana", "mes"] = Query("mes"),
    proveedor_id: Optional[int] = Query(None, description="Filtrar por proveedor del lote"),
    ubicacion: Optional[str] = Query(None, description="Filtrar por ubicación"),
    _usuario: UsuarioActual = Depends(get_usuario_actual),
    conn=Depends(get_db),
):
    trunc_unit = _AGRUPACION_A_TRUNC[agrupacion]

    sql = f"""
        SELECT
            date_trunc('{trunc_unit}', m.fecha)::date AS periodo,
            COALESCE(prov.proveedor, 'Sin proveedor')  AS proveedor,
            COALESCE(m.ubicacion, 'Sin ubicación')      AS ubicacion,
            SUM(m.costo_total)                          AS gasto_total
        FROM  movimientos_inventario m
        LEFT  JOIN proveedores prov ON prov.id = m.proveedor_id
        WHERE m.costo_total IS NOT NULL
    """
    params: list = []
    if proveedor_id is not None:
        sql += " AND m.proveedor_id = %s"
        params.append(proveedor_id)
    if ubicacion is not None:
        sql += " AND m.ubicacion = %s"
        params.append(ubicacion)

    # GROUP BY posicional — mismo motivo que en ingresos-productos.
    sql += " GROUP BY 1, 2, 3 ORDER BY 1, 2, 3"

    async with conn.cursor() as cur:
        await cur.execute(sql, params)
        rows = await cur.fetchall()

    return [
        {
            "periodo":     r[0].isoformat(),
            "etiqueta":    _etiqueta_periodo(r[0], agrupacion),
            "proveedor":   r[1],
            "ubicacion":   r[2],
            "gasto_total": float(r[3] or 0),
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# GET /dashboard/gasto-restock/detalle
# ---------------------------------------------------------------------------
# Detalle de gasto de restock para UN periodo puntual (no agrupado por
# semana/mes como /gasto-restock arriba). Usado por dos pantallas nuevas:
#   - El KPI "Inversión en restock" de Histórico (Parte 5) — solo necesita
#     gasto_total + entradas_sin_costo.
#   - El drill-down semanal de Nuevos Ingresos (Parte 6) — usa también los
#     4 desgloses.
# ---------------------------------------------------------------------------

@router.get("/gasto-restock/detalle")
async def gasto_restock_detalle(
    fecha_desde: date = Query(..., description="Inicio del periodo (inclusive)"),
    fecha_hasta: date = Query(..., description="Fin del periodo (inclusive)"),
    _usuario: UsuarioActual = Depends(get_usuario_actual),
    conn=Depends(get_db),
):
    """
    Cuatro desgloses del gasto de restock del periodo, en consultas
    SEPARADAS -- mismo criterio que /dashboard/utilidad -- para evitar el
    AmbiguousColumn que ya mordió una vez a este proyecto al combinar en un
    solo JOIN columnas 'nombre' que existen en varias tablas a la vez
    (notas/productos/usuarios/proveedores comparten ese nombre de columna).

    entradas_sin_costo: movimientos del periodo con costo_unitario NULL --
    quedan FUERA de gasto_total (mismo criterio que /gasto-restock: no
    tiene sentido un renglón "$0 gastado" mezclado con gasto real) pero se
    cuentan aparte para que el frontend pueda avisar "N entradas sin costo,
    no incluidas" en vez de mostrar un total que parece exacto sin serlo.

    por_sucursal vs. por_ubicacion -- NO son lo mismo, aunque hoy con solo
    2 sucursales activas se parezcan:
      - por_ubicacion agrupa por el texto libre m.ubicacion tal cual.
      - por_sucursal agrupa vía m.bodega_id -> bodegas.sucursal_id, una
        capa MÁS GRUESA: San Pedro hoy tiene 3 bodegas distintas ("Local
        Jose", "Local Amarillo", "Almacen") que colapsan en un solo grupo
        de sucursal, mientras que por_ubicacion las sigue mostrando por
        separado. bodega_id es nullable (movimientos históricos cuyo texto
        de ubicacion nunca hizo match en el backfill de la migración 012,
        ver ese archivo) -- esos caen en "Sin sucursal" aquí, un grupo
        DISTINTO de "Sin ubicación" (que usa m.ubicacion IS NULL).
    """
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT
                COALESCE(SUM(costo_total), 0),
                COUNT(*) FILTER (WHERE costo_unitario IS NULL)
            FROM movimientos_inventario
            WHERE fecha BETWEEN %s AND %s
            """,
            (fecha_desde, fecha_hasta),
        )
        gasto_total, entradas_sin_costo = await cur.fetchone()

        await cur.execute(
            """
            SELECT COALESCE(prov.proveedor, 'Sin proveedor') AS nombre, SUM(m.costo_total) AS gasto
            FROM   movimientos_inventario m
            LEFT   JOIN proveedores prov ON prov.id = m.proveedor_id
            WHERE  m.fecha BETWEEN %s AND %s AND m.costo_total IS NOT NULL
            GROUP BY 1 ORDER BY gasto DESC
            """,
            (fecha_desde, fecha_hasta),
        )
        prov_rows = await cur.fetchall()

        await cur.execute(
            """
            SELECT COALESCE(c.nombre, 'Sin categoría') AS nombre, SUM(m.costo_total) AS gasto
            FROM   movimientos_inventario m
            JOIN   productos   p ON p.id = m.producto_id
            LEFT   JOIN categorias c ON c.id = p.categoria_id
            WHERE  m.fecha BETWEEN %s AND %s AND m.costo_total IS NOT NULL
            GROUP BY 1 ORDER BY gasto DESC
            """,
            (fecha_desde, fecha_hasta),
        )
        cat_rows = await cur.fetchall()

        await cur.execute(
            """
            SELECT COALESCE(s.nombre, 'Sin sucursal') AS nombre, SUM(m.costo_total) AS gasto
            FROM   movimientos_inventario m
            LEFT   JOIN bodegas    b ON b.id = m.bodega_id
            LEFT   JOIN sucursales s ON s.id = b.sucursal_id
            WHERE  m.fecha BETWEEN %s AND %s AND m.costo_total IS NOT NULL
            GROUP BY 1 ORDER BY gasto DESC
            """,
            (fecha_desde, fecha_hasta),
        )
        suc_rows = await cur.fetchall()

        await cur.execute(
            """
            SELECT COALESCE(m.ubicacion, 'Sin ubicación') AS nombre, SUM(m.costo_total) AS gasto
            FROM   movimientos_inventario m
            WHERE  m.fecha BETWEEN %s AND %s AND m.costo_total IS NOT NULL
            GROUP BY 1 ORDER BY gasto DESC
            """,
            (fecha_desde, fecha_hasta),
        )
        ubi_rows = await cur.fetchall()

    return {
        "gasto_total":        float(gasto_total or 0),
        "entradas_sin_costo": int(entradas_sin_costo or 0),
        "por_proveedor": [{"nombre": r[0], "gasto": float(r[1] or 0)} for r in prov_rows],
        "por_categoria": [{"nombre": r[0], "gasto": float(r[1] or 0)} for r in cat_rows],
        "por_sucursal":  [{"nombre": r[0], "gasto": float(r[1] or 0)} for r in suc_rows],
        "por_ubicacion": [{"nombre": r[0], "gasto": float(r[1] or 0)} for r in ubi_rows],
    }


# ---------------------------------------------------------------------------
# GET /dashboard/movimientos-periodo
# ---------------------------------------------------------------------------
# Lista de entradas de inventario (restock) de TODOS los productos en un
# periodo, más reciente primero. Mismas columnas que GET
# /productos/{id}/movimientos (catalogo.py) más el nombre del producto,
# porque aquí abarca varios productos a la vez -- usada por el panel
# derecho de Histórico (Parte 5) y podría reusarse donde se necesite ver
# "todo lo que entró" sin filtrar por producto.
# ---------------------------------------------------------------------------

@router.get("/movimientos-periodo")
async def movimientos_periodo(
    fecha_desde: date = Query(..., description="Inicio del periodo (inclusive)"),
    fecha_hasta: date = Query(..., description="Fin del periodo (inclusive)"),
    _usuario: UsuarioActual = Depends(get_usuario_actual),
    conn=Depends(get_db),
):
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT
                m.id, m.producto_id, p.nombre AS nombre_producto,
                m.cantidad, m.fecha, m.ubicacion,
                bod.nombre AS nombre_bodega,
                prov.proveedor AS nombre_proveedor,
                m.costo_unitario, m.costo_total
            FROM  movimientos_inventario m
            JOIN  productos    p    ON p.id    = m.producto_id
            LEFT  JOIN proveedores prov ON prov.id = m.proveedor_id
            LEFT  JOIN bodegas     bod  ON bod.id  = m.bodega_id
            WHERE m.fecha BETWEEN %s AND %s
            ORDER BY m.fecha DESC, m.id DESC
            """,
            (fecha_desde, fecha_hasta),
        )
        rows = await cur.fetchall()

    return [
        {
            "id": r[0], "producto_id": r[1], "nombre_producto": r[2],
            "cantidad": r[3], "fecha": r[4].isoformat(),
            "ubicacion": r[5], "nombre_bodega": r[6],
            "nombre_proveedor": r[7],
            "costo_unitario": float(r[8]) if r[8] is not None else None,
            "costo_total":    float(r[9]) if r[9] is not None else None,
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# GET /dashboard/cobros-periodo
# ---------------------------------------------------------------------------
# "Cobros del periodo" (Parte B, ronda 3) — dinero que REALMENTE entró en el
# periodo, sumado por pagos.fecha (cuándo se cobró), no por notas.fecha_pedido
# (cuándo se levantó el pedido) ni notas.fecha_entrega (cuándo se entregó).
# Esa es la brecha real que tenía el dashboard: un pedido abierto hace
# semanas que recibe un abono HOY no aparecía en ningún total de "hoy",
# porque nada sumaba por fecha de pago. pagos.fecha ya traía justo ese dato.
#
# "Pedido abierto" (derivado, sin migración): anticipo > 0 AND fecha_entrega
# IS NULL AND estatus != 'Cancelado'. anticipo > 0 es redundante en la
# práctica aquí (si esta fila de pago existe, ya hay al menos ese abono),
# pero se deja explícito en el WHERE/SELECT por si algún día se listan
# pagos con monto 0 o se cambia el criterio.
# ---------------------------------------------------------------------------

@router.get("/cobros-periodo")
async def cobros_periodo(
    fecha_desde: date = Query(..., description="Inicio del periodo (inclusive)"),
    fecha_hasta: date = Query(..., description="Fin del periodo (inclusive)"),
    usuario: UsuarioActual = Depends(get_usuario_actual),
    conn=Depends(get_db),
):
    es_worker = usuario.rol == "worker"

    _SQL = """
        SELECT
            pg.id, pg.folio_pedido, pg.fecha, pg.monto, pg.metodo, pg.tipo,
            n.fecha_pedido, n.fecha_entrega, n.estatus, n.anticipo,
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
        FROM  pagos pg
        JOIN  notas n ON n.folio = pg.folio_pedido
        WHERE pg.fecha BETWEEN %s AND %s
    """
    params: list = [fecha_desde, fecha_hasta]
    if es_worker:
        _SQL += " AND n.usuario_id = %s"
        params.append(usuario.id)
    _SQL += " ORDER BY pg.fecha DESC, pg.id DESC"

    async with conn.cursor() as cur:
        await cur.execute(_SQL, params)
        rows = await cur.fetchall()

    def _pedido_abierto(fecha_entrega, estatus, anticipo) -> bool:
        return fecha_entrega is None and estatus != "Cancelado" and float(anticipo or 0) > 0

    # cobrado_total se suma aquí, no en un segundo SELECT: rows ya trae
    # exactamente las filas filtradas por fecha (y por usuario_id si es
    # worker) — sumar en Python evita repetir ese mismo filtro dos veces
    # y que ambos números puedan desincronizarse si alguno cambia después.
    return {
        "cobrado_total": sum(float(r[3]) for r in rows),
        "pagos": [
            {
                "id":              r[0],
                "folio":           r[1],
                "fecha":           r[2].isoformat(),
                "monto":           float(r[3]),
                "metodo":          r[4],
                "tipo":            r[5],
                "etiqueta":        _armar_etiqueta(r[11], r[10], r[6], r[1], r[7]),
                "pedido_abierto":  _pedido_abierto(r[7], r[8], r[9]),
            }
            for r in rows
        ],
    }
