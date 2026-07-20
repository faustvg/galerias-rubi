"""
api/routers/notas.py — Gestión de notas de venta (cotizaciones / pedidos / entregas).

AISLAMIENTO POR ROL — se aplica SIEMPRE en el servidor, nunca solo en el frontend:
  worker     → solo ve y edita SUS propias notas (WHERE usuario_id = su id)
  admin / superadmin / viewer → ven TODAS las notas
  viewer     → solo lectura: NO puede crear ni editar

FOLIOS DIGITALES:
  Los talonarios de papel usan números puros ('0986', '1234').
  El sistema digital usa el prefijo 'D-' para nunca chocar con ningún
  folio de papel: 'D-00001', 'D-00002', …
  Se genera con la secuencia PostgreSQL `notas_digital_seq` (creada al
  arrancar la app con CREATE SEQUENCE IF NOT EXISTS). Los gaps por
  transacciones fallidas son normales y aceptables — igual que en los
  talonarios físicos donde a veces se anulan hojas.

INVENTARIO:
  Cuando una nota pasa a 'Entregado' por primera vez (estatus anterior ≠
  'Entregado'), se descuenta la cantidad de cada partida de las existencias
  del producto vinculado, SOLO si existencias > 0. Los productos hechos a
  medida (existencias = 0) se saltan: no tienen inventario que descontar.
  Si las existencias quedan negativas, eso indica una discrepancia real que
  el admin debe revisar — el sistema no la oculta ni la previene.
"""

import asyncio
import os
import smtplib
from datetime import date, datetime
from email.message import EmailMessage
from io import BytesIO
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from fpdf import FPDF
from pydantic import BaseModel, Field

from api.auth import get_usuario_actual, requiere_roles, UsuarioActual
from api.database import get_db

router = APIRouter()

ROLES_ESCRITURA = ("superadmin", "admin", "worker")

MESES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']


def _armar_etiqueta(
    nombre_ancla: Optional[str],
    num_partidas: int,
    fecha_pedido,
    folio: str,
    fecha_entrega=None,
) -> str:
    """
    Etiqueta legible calculada, NO guardada en la DB.

    Lógica:
      - Ancla = nombre del producto MÁS CARO de las partidas (mayor precio_unitario).
      - Si no hay partidas: devuelve el folio como fallback.
      - Fecha: usa fecha_entrega; si no existe, usa fecha_pedido.
      - Formato: DD.Mes.AA en español (ej. 01.Ago.26).
      - 1 partida : "Sala Michelle - 01.Ago.26"
      - N partidas: "Sala Michelle +N-1 - 01.Ago.26"

    El nombre_ancla llega del subquery SQL (ya ordenado por precio_unitario DESC).
    Para el detalle se calcula en Python desde las partidas ya cargadas.
    """
    if not nombre_ancla or num_partidas == 0:
        return folio
    fecha = fecha_entrega if fecha_entrega is not None else fecha_pedido
    if fecha is not None:
        mes = MESES_ES[fecha.month - 1]
        anio = str(fecha.year)[2:]
        parte_fecha = f" - {fecha.day:02d}.{mes}.{anio}"
    else:
        parte_fecha = ""
    if num_partidas == 1:
        return f"{nombre_ancla}{parte_fecha}"
    return f"{nombre_ancla} +{num_partidas - 1}{parte_fecha}"


# ---------------------------------------------------------------------------
# Schemas de ENTRADA
# ---------------------------------------------------------------------------

class PartidaInput(BaseModel):
    producto_id:     Optional[int]  = None
    cantidad:        int            = Field(1, ge=1)
    modificaciones:  Optional[str]  = None
    precio_unitario: float          = Field(0.0, ge=0)


class NotaCreate(BaseModel):
    fecha_pedido:    date   = Field(default_factory=date.today)
    fecha_entrega:   Optional[date] = None
    # Literal hace que FastAPI valide que solo lleguen estos tres valores;
    # la tabla no tiene CHECK constraint en estatus, así que la API es el guardián.
    estatus:         Literal["Presupuesto", "En proceso", "Entregado"] = "Presupuesto"
    total:           float  = Field(0.0, ge=0)
    anticipo:        float  = Field(0.0, ge=0)
    # Enlace estructurado al usuario que hizo la venta (ver NOTA en schema.sql).
    # Reemplaza al viejo campo de texto libre: el nombre mostrado siempre se
    # resuelve en vivo desde usuarios.nombre, así que un cambio de nombre se
    # refleja de inmediato en notas pasadas.
    vendedor_id:     Optional[int] = None
    nombre_cliente:  Optional[str] = None
    telefono:        Optional[str] = None
    consideraciones: Optional[str] = None
    foto_nota:       Optional[str] = None
    partidas:        list[PartidaInput] = []


class NotaUpdate(BaseModel):
    """
    Todos los campos son opcionales: solo se actualizan los que lleguen.
    Para `partidas`:
      - None (no enviado)  → no tocar las partidas existentes
      - []  (lista vacía)  → borrar todas las partidas
      - [...]              → REEMPLAZAR todas las partidas con las nuevas
    """
    fecha_pedido:    Optional[date] = None
    fecha_entrega:   Optional[date] = None
    estatus:         Optional[Literal["Presupuesto", "En proceso", "Entregado"]] = None
    total:           Optional[float] = Field(None, ge=0)
    anticipo:        Optional[float] = Field(None, ge=0)
    vendedor_id:     Optional[int] = None
    nombre_cliente:  Optional[str] = None
    telefono:        Optional[str] = None
    consideraciones: Optional[str] = None
    foto_nota:       Optional[str] = None
    partidas:        Optional[list[PartidaInput]] = None


# ---------------------------------------------------------------------------
# Schemas de SALIDA
# ---------------------------------------------------------------------------

class PartidaOut(BaseModel):
    id:              int
    producto_id:     Optional[int]
    nombre_producto: Optional[str]   # join de productos
    cantidad:        int
    modificaciones:  Optional[str]
    precio_unitario: float
    importe:         float


class NotaResumen(BaseModel):
    """Vista compacta para la lista de notas."""
    folio:          str
    etiqueta:       str            # campo calculado — mueble ancla + mes
    fecha_pedido:   date
    fecha_entrega:  Optional[date]
    estatus:        str
    total:          float
    anticipo:       float
    resta:          float
    vendedor:       Optional[str]   # nombre a mostrar: en vivo si hay vendedor_id, si no el texto histórico
    vendedor_id:    Optional[int]
    nombre_cliente: Optional[str]
    telefono:       Optional[str]
    usuario_id:     Optional[int]
    nombre_usuario: Optional[str]   # join de usuarios
    num_partidas:   int


class PagosResumen(BaseModel):
    """Desglose de lo cobrado por método — espejo de la vista notas_pagos_resumen."""
    total_efectivo:      float
    total_tarjeta:       float
    total_transferencia: float
    total_pagado:        float


class NotaDetalle(BaseModel):
    """Vista completa de una nota con todas sus partidas."""
    folio:           str
    etiqueta:        str           # campo calculado — mueble ancla + mes
    fecha_pedido:    date
    fecha_entrega:   Optional[date]
    estatus:         str
    total:           float
    anticipo:        float
    resta:           float
    vendedor:        Optional[str]   # nombre a mostrar: en vivo si hay vendedor_id, si no el texto histórico
    vendedor_id:     Optional[int]
    nombre_cliente:  Optional[str]
    telefono:        Optional[str]
    consideraciones: Optional[str]
    foto_nota:       Optional[str]
    usuario_id:      Optional[int]
    nombre_usuario:  Optional[str]
    partidas:        list[PartidaOut]
    pagos_resumen:   PagosResumen   # desglose de cómo se ha cobrado (ver tabla pagos)


# ---------------------------------------------------------------------------
# Schemas — Pagos (cómo se cobró la nota: efectivo / tarjeta / transferencia)
# ---------------------------------------------------------------------------

class PagoInput(BaseModel):
    fecha:  Optional[date] = None   # si no se manda, el endpoint usa hoy
    tipo:   Optional[str]  = None   # 'anticipo' | 'liquidacion' | 'abono' — libre, informativo
    metodo: str                     # 'efectivo' | 'tarjeta' | 'transferencia' | ... — libre
    monto:  float = Field(..., gt=0)


class PagoOut(BaseModel):
    id:             int
    folio_pedido:   str
    fecha:          date
    tipo:           Optional[str]
    metodo:         str
    monto:          float
    usuario_id:     Optional[int]
    nombre_usuario: Optional[str]   # join de usuarios — quién cobró
    creado_en:      datetime


# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------

async def _generar_folio(conn) -> str:
    """
    Genera el próximo folio digital (D-00001, D-00002, …).

    La secuencia `notas_digital_seq` se crea en el lifespan de la app
    (main.py). Si por alguna razón no existiera, CREATE SEQUENCE IF NOT
    EXISTS la crea aquí como respaldo — es idempotente.

    nextval() es intencionalmente NO-transaccional en PostgreSQL: aunque
    la transacción exterior haga rollback, el número ya fue consumido y
    no vuelve atrás. Esto previene deadlocks y es el comportamiento
    estándar de las secuencias; los gaps en los folios son normales.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            "CREATE SEQUENCE IF NOT EXISTS notas_digital_seq START 1"
        )
        await cur.execute("SELECT nextval('notas_digital_seq')")
        n = (await cur.fetchone())[0]
    return f"D-{n:05d}"


def _verificar_acceso(usuario: UsuarioActual, nota_usuario_id: Optional[int]) -> None:
    """
    Si el usuario es worker, levanta 404 si la nota no le pertenece.
    Devuelve 404 (no 403) para no revelar que la nota existe.
    """
    if usuario.rol == "worker" and nota_usuario_id != usuario.id:
        raise HTTPException(status_code=404, detail="Nota no encontrada.")


async def _descontar_inventario(conn, folio: str) -> None:
    """
    Descuenta existencias al marcar una nota como 'Entregado'.
    Criterio: solo productos con existencias > 0 en este momento.
    Los productos hechos a medida (existencias = 0 de forma permanente)
    se saltan — nunca llevan conteo de stock.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            """
            UPDATE productos p
               SET existencias = p.existencias - pt.cantidad
              FROM partidas pt
             WHERE pt.folio_pedido = %s
               AND pt.producto_id  = p.id
               AND p.existencias   > 0
            """,
            (folio,),
        )


async def _restaurar_inventario(conn, folio: str) -> None:
    """
    Devuelve las existencias cuando una nota SALE de 'Entregado'.
    Mismo criterio que _descontar: productos con existencias > 0 ahora.

    LÍMITE CONOCIDO — si una nota vendió exactamente las últimas N unidades
    de un producto (existencias = N - N = 0), la restauración no se aplica
    porque la condición 'existencias > 0' falla. El admin debe corregir
    ese caso a mano (ajustar existencias del producto directamente).

    Por qué no se usa una condición diferente:
      Si usamos sin filtro (restaura todo producto con producto_id), los
      productos hechos a medida (existencias = 0 permanentemente, nunca
      descontados) recibirían inventario falso. Ese error sería peor.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            """
            UPDATE productos p
               SET existencias = p.existencias + pt.cantidad
              FROM partidas pt
             WHERE pt.folio_pedido = %s
               AND pt.producto_id  = p.id
               AND p.existencias   > 0
            """,
            (folio,),
        )


# Mapeadores de filas a dicts (evitan repetir los índices en cada endpoint)

def _fila_a_resumen(r) -> dict:
    # r[13] = num_partidas, r[14] = nombre_ancla (mueble más caro del subquery)
    return {
        "folio":          r[0],
        "etiqueta":       _armar_etiqueta(r[14], r[13], r[1], r[0], r[2]),
        "fecha_pedido":   r[1],
        "fecha_entrega":  r[2],
        "estatus":        r[3],
        "total":          float(r[4] or 0),
        "anticipo":       float(r[5] or 0),
        "resta":          float(r[6] or 0),
        "vendedor":       r[7],
        "vendedor_id":    r[8],
        "nombre_cliente": r[9],
        "telefono":       r[10],
        "usuario_id":     r[11],
        "nombre_usuario": r[12],
        "num_partidas":   r[13],
    }


def _fila_a_detalle(r) -> dict:
    return {
        "folio":           r[0],
        "fecha_pedido":    r[1],
        "fecha_entrega":   r[2],
        "estatus":         r[3],
        "total":           float(r[4] or 0),
        "anticipo":        float(r[5] or 0),
        "resta":           float(r[6] or 0),
        "vendedor":        r[7],
        "vendedor_id":     r[8],
        "nombre_cliente":  r[9],
        "telefono":        r[10],
        "consideraciones": r[11],
        "foto_nota":       r[12],
        "usuario_id":      r[13],
        "nombre_usuario":  r[14],
    }


def _fila_a_partida(r) -> dict:
    return {
        "id":              r[0],
        "producto_id":     r[1],
        "cantidad":        r[2],
        "modificaciones":  r[3],
        "precio_unitario": float(r[4] or 0),
        "importe":         float(r[5] or 0),
        "nombre_producto": r[6],
    }


def _fila_a_pago(r) -> dict:
    return {
        "id":             r[0],
        "folio_pedido":   r[1],
        "fecha":          r[2],
        "tipo":           r[3],
        "metodo":         r[4],
        "monto":          float(r[5] or 0),
        "usuario_id":     r[6],
        "nombre_usuario": r[7],
        "creado_en":      r[8],
    }


async def _obtener_pagos_resumen(conn, folio: str) -> dict:
    """
    Lee el desglose de pagos desde la vista notas_pagos_resumen.
    Si la nota no tiene pagos registrados todavía, la vista no devuelve
    fila (el GROUP BY no produce una para folios sin filas en pagos) —
    en ese caso se devuelven ceros en vez de None, para que el frontend
    no tenga que manejar un caso especial.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT total_efectivo, total_tarjeta, total_transferencia, total_pagado
            FROM   notas_pagos_resumen
            WHERE  folio_pedido = %s
            """,
            (folio,),
        )
        row = await cur.fetchone()

    if row is None:
        return {
            "total_efectivo": 0.0, "total_tarjeta": 0.0,
            "total_transferencia": 0.0, "total_pagado": 0.0,
        }
    return {
        "total_efectivo":      float(row[0] or 0),
        "total_tarjeta":       float(row[1] or 0),
        "total_transferencia": float(row[2] or 0),
        "total_pagado":        float(row[3] or 0),
    }


# ---------------------------------------------------------------------------
# Consultas SQL reutilizadas
# ---------------------------------------------------------------------------

_SQL_PARTIDAS = """
    SELECT
        pt.id, pt.producto_id, pt.cantidad, pt.modificaciones,
        pt.precio_unitario, pt.importe,
        pr.nombre AS nombre_producto
    FROM  partidas  pt
    LEFT  JOIN productos pr ON pr.id = pt.producto_id
    WHERE pt.folio_pedido = %s
    ORDER BY pt.id
"""

_SQL_PAGOS = """
    SELECT
        pg.id, pg.folio_pedido, pg.fecha, pg.tipo, pg.metodo, pg.monto,
        pg.usuario_id, u.nombre AS nombre_usuario, pg.creado_en
    FROM  pagos    pg
    LEFT  JOIN usuarios u ON u.id = pg.usuario_id
    WHERE pg.folio_pedido = %s
    ORDER BY pg.fecha, pg.id
"""

_SQL_DETALLE = """
    SELECT
        n.folio, n.fecha_pedido, n.fecha_entrega, n.estatus,
        n.total, n.anticipo, n.resta,
        COALESCE(uv.nombre, n.vendedor) AS vendedor, n.vendedor_id,
        n.nombre_cliente, n.telefono,
        n.consideraciones, n.foto_nota,
        n.usuario_id, u.nombre AS nombre_usuario
    FROM  notas    n
    LEFT  JOIN usuarios u  ON u.id  = n.usuario_id
    LEFT  JOIN usuarios uv ON uv.id = n.vendedor_id
    WHERE n.folio = %s
"""


# ---------------------------------------------------------------------------
# ENDPOINT 1 — Crear nota con partidas (transacción única)
# ---------------------------------------------------------------------------

@router.post("/notas", status_code=201)
async def crear_nota(
    data: NotaCreate,
    usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    folio = await _generar_folio(conn)

    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO notas
              (folio, fecha_pedido, fecha_entrega, estatus, total, anticipo,
               vendedor_id, nombre_cliente, telefono, consideraciones, foto_nota,
               usuario_id)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                folio,
                data.fecha_pedido,
                data.fecha_entrega,
                data.estatus,
                data.total,
                data.anticipo,
                data.vendedor_id,
                data.nombre_cliente,
                data.telefono,
                data.consideraciones,
                data.foto_nota,
                usuario.id,
            ),
        )

        for p in data.partidas:
            await cur.execute(
                """
                INSERT INTO partidas
                  (folio_pedido, producto_id, cantidad, modificaciones, precio_unitario)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (folio, p.producto_id, p.cantidad, p.modificaciones, p.precio_unitario),
            )

    # Si la nota nace directamente en Entregado, descontar inventario ahora.
    if data.estatus == "Entregado":
        await _descontar_inventario(conn, folio)

    await conn.commit()
    return {"folio": folio}


# ---------------------------------------------------------------------------
# ENDPOINT 2 — Listar notas (con aislamiento por rol)
# ---------------------------------------------------------------------------

@router.get("/notas", response_model=list[NotaResumen])
async def listar_notas(
    # Filtros backend — se combinan con AND; todos son opcionales
    vendedor_id: Optional[int]  = Query(None, description="Filtrar por vendedor_id (usuario que hizo la venta)"),
    fecha_desde: Optional[date] = Query(None, description="Fecha de pedido desde (inclusive)"),
    fecha_hasta: Optional[date] = Query(None, description="Fecha de pedido hasta (inclusive)"),
    busqueda:    Optional[str]  = Query(None, description="Búsqueda en modificaciones y consideraciones"),
    usuario: UsuarioActual = Depends(get_usuario_actual),
    conn=Depends(get_db),
):
    """
    Lista de notas con filtros opcionales y etiqueta calculada.

    ── CÓMO SE ARMA LA ETIQUETA ─────────────────────────────────────────────
    El campo `etiqueta` no existe en la tabla. Se construye así:
      1. Un subquery anidado busca el producto más caro de cada nota
         (ORDER BY precio_unitario DESC LIMIT 1) y trae su nombre.
         Esto se llama "mueble ancla".
      2. _armar_etiqueta() combina nombre_ancla + num_partidas + mes
         para producir p.ej. "Sala Michelle +2 - Jun".
    No guardamos nada nuevo: el dato vive en las partidas existentes.

    ── CÓMO FUNCIONA LA BÚSQUEDA EN PARTIDAS ────────────────────────────────
    Para que una nota aparezca al buscar "modular", alguna de estas debe ser
    verdadera (OR):
      a) n.consideraciones ILIKE '%modular%'
      b) EXISTS (SELECT 1 FROM partidas WHERE … modificaciones ILIKE '%modular%')
      c) EXISTS (SELECT 1 FROM partidas … JOIN productos … nombre ILIKE '%modular%')

    ILIKE es case-insensitive nativo de PostgreSQL. El término '%modular%' va
    como parámetro (%s) — nunca interpolado en el SQL, así no hay inyección.
    EXISTS es eficiente: para en cuanto encuentra la primera fila coincidente.
    """
    # ── SQL base: incluye subquery para el mueble ancla de la etiqueta ────────
    sql = """
        SELECT
            n.folio, n.fecha_pedido, n.fecha_entrega, n.estatus,
            n.total, n.anticipo, n.resta,
            COALESCE(uv.nombre, n.vendedor) AS vendedor, n.vendedor_id,
            n.nombre_cliente, n.telefono,
            n.usuario_id, u.nombre AS nombre_usuario,
            (SELECT COUNT(*) FROM partidas p  WHERE p.folio_pedido  = n.folio) AS num_partidas,
            (
                SELECT COALESCE(pr.nombre, 'Artículo')
                FROM   partidas par
                LEFT   JOIN productos pr ON pr.id = par.producto_id
                WHERE  par.folio_pedido = n.folio
                ORDER  BY par.precio_unitario DESC, par.id
                LIMIT  1
            ) AS nombre_ancla
        FROM  notas    n
        LEFT  JOIN usuarios u  ON u.id  = n.usuario_id
        LEFT  JOIN usuarios uv ON uv.id = n.vendedor_id
    """

    # ── Condiciones dinámicas (todas hardcodeadas en SQL; user data solo en params) ─
    conditions: list[str] = []
    params:     list      = []

    if usuario.rol == "worker":
        conditions.append("n.usuario_id = %s")
        params.append(usuario.id)

    if vendedor_id is not None:
        conditions.append("n.vendedor_id = %s")
        params.append(vendedor_id)

    if fecha_desde is not None:
        conditions.append("n.fecha_pedido >= %s")
        params.append(fecha_desde)

    if fecha_hasta is not None:
        conditions.append("n.fecha_pedido <= %s")
        params.append(fecha_hasta)

    if busqueda:
        termino = f"%{busqueda}%"   # el % es de ILIKE, no de psycopg — va en params
        conditions.append(
            "(n.consideraciones ILIKE %s"
            " OR EXISTS ("
            "     SELECT 1 FROM partidas par2"
            "     LEFT JOIN productos pr2 ON pr2.id = par2.producto_id"
            "     WHERE par2.folio_pedido = n.folio"
            "       AND (par2.modificaciones ILIKE %s"
            "            OR COALESCE(pr2.nombre, '') ILIKE %s)"
            " ))"
        )
        params.extend([termino, termino, termino])

    if conditions:
        sql += " WHERE " + " AND ".join(conditions)

    sql += " ORDER BY n.fecha_pedido DESC, n.folio DESC"

    async with conn.cursor() as cur:
        await cur.execute(sql, params)
        rows = await cur.fetchall()

    return [_fila_a_resumen(r) for r in rows]


# ---------------------------------------------------------------------------
# ENDPOINT 3 — Ver una nota con sus partidas (con aislamiento)
# ---------------------------------------------------------------------------

@router.get("/notas/{folio}", response_model=NotaDetalle)
async def obtener_nota(
    folio: str,
    usuario: UsuarioActual = Depends(get_usuario_actual),
    conn=Depends(get_db),
):
    async with conn.cursor() as cur:
        await cur.execute(_SQL_DETALLE, (folio,))
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Nota no encontrada.")

    # row[13] = usuario_id de la nota
    _verificar_acceso(usuario, row[13])

    async with conn.cursor() as cur:
        await cur.execute(_SQL_PARTIDAS, (folio,))
        partidas_rows = await cur.fetchall()

    partidas = [_fila_a_partida(r) for r in partidas_rows]
    detalle  = _fila_a_detalle(row)
    detalle["partidas"] = partidas
    detalle["pagos_resumen"] = await _obtener_pagos_resumen(conn, folio)

    # Calcular etiqueta desde las partidas ya cargadas:
    # buscar la de mayor precio_unitario como ancla.
    if partidas:
        ancla = max(partidas, key=lambda p: p["precio_unitario"])["nombre_producto"]
    else:
        ancla = None
    detalle["etiqueta"] = _armar_etiqueta(ancla, len(partidas), row[1], row[0], row[2])

    return detalle


# ---------------------------------------------------------------------------
# ENDPOINT 4 — Editar nota y/o sus partidas (con aislamiento, sin viewer)
# ---------------------------------------------------------------------------

@router.put("/notas/{folio}", response_model=NotaDetalle)
async def editar_nota(
    folio: str,
    data: NotaUpdate,
    usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    # Leer estado actual para:
    #   a) verificar que existe y que el worker tiene acceso
    #   b) saber el estatus anterior (para lógica de inventario)
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT usuario_id, estatus FROM notas WHERE folio = %s", (folio,)
        )
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Nota no encontrada.")

    nota_usuario_id, estatus_anterior = row[0], row[1]
    _verificar_acceso(usuario, nota_usuario_id)

    # model_dump(exclude_unset=True) devuelve SOLO los campos que llegaron en el
    # request. Así un PUT parcial no pisa los campos que el cliente no tocó.
    campos = data.model_dump(exclude_unset=True, exclude={"partidas"})
    nuevo_estatus = campos.get("estatus")  # None si el request no incluyó estatus

    # ── Inventario: restaurar ANTES de reemplazar partidas ───────────────────
    # La restauración usa las partidas ACTUALES (las que se descontaron al
    # marcar Entregado). Si las reemplazáramos primero, restauraríamos montos
    # incorrectos.
    #
    # Cómo se evita doble operación:
    #   1. `nuevo_estatus is not None` — si el request no toca estatus, no pasa nada.
    #   2. Las condiciones de deducir y restaurar son mutuamente excluyentes:
    #      deducir requiere  (nuevo == Entregado AND anterior != Entregado)
    #      restaurar requiere (anterior == Entregado AND nuevo != Entregado)
    #      Nunca pueden ser ambas True a la vez.
    #   3. Ambas verifican que hubo un CAMBIO real de estatus (no solo que se
    #      envió el mismo valor de nuevo).
    if nuevo_estatus is not None and estatus_anterior == "Entregado" and nuevo_estatus != "Entregado":
        await _restaurar_inventario(conn, folio)

    # ── Actualizar campos de la cabecera ─────────────────────────────────────
    if campos:
        # Los nombres de campo de NotaUpdate coinciden con las columnas de la tabla.
        # Nunca construimos SQL con valores del usuario — siempre %s.
        columnas = [f"{k} = %s" for k in campos]
        valores  = list(campos.values()) + [folio]
        async with conn.cursor() as cur:
            await cur.execute(
                f"UPDATE notas SET {', '.join(columnas)} WHERE folio = %s",
                valores,
            )

    # ── Reemplazar partidas si se enviaron ───────────────────────────────────
    # Estrategia "replace": borrar todas y re-insertar.
    # Más simple que detectar cuáles cambiaron, cuáles son nuevas, cuáles
    # se borraron. Funciona bien para listas cortas (< 20 partidas).
    if data.partidas is not None:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM partidas WHERE folio_pedido = %s", (folio,)
            )
            for p in data.partidas:
                await cur.execute(
                    """
                    INSERT INTO partidas
                      (folio_pedido, producto_id, cantidad, modificaciones, precio_unitario)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (folio, p.producto_id, p.cantidad, p.modificaciones, p.precio_unitario),
                )

    # ── Inventario: descontar DESPUÉS de reemplazar partidas ─────────────────
    # La deducción usa las partidas NUEVAS (lo que realmente se va a entregar).
    if nuevo_estatus is not None and nuevo_estatus == "Entregado" and estatus_anterior != "Entregado":
        await _descontar_inventario(conn, folio)

    await conn.commit()

    # Devolver el estado final de la nota para que el frontend refleje los cambios.
    # Llamamos la función directamente pasando la misma conexión (ya commitada).
    return await obtener_nota(folio, usuario, conn)


# ---------------------------------------------------------------------------
# ENDPOINT — Borrar una nota (solo admin/superadmin)
# ---------------------------------------------------------------------------
# Es un registro financiero, así que a diferencia de los demás endpoints de
# escritura (ROLES_ESCRITURA incluye worker) este se restringe a
# superadmin/admin — worker y viewer no lo ven ni pueden dispararlo.
#
# partidas y pagos tienen ON DELETE CASCADE sobre folio_pedido (ver
# schema.sql): se limpian solos, no hace falta borrarlos a mano ni una
# migración nueva.
# ---------------------------------------------------------------------------

@router.delete("/notas/{folio}")
async def eliminar_nota(
    folio: str,
    _usuario: UsuarioActual = requiere_roles("superadmin", "admin"),
    conn=Depends(get_db),
):
    async with conn.cursor() as cur:
        await cur.execute(
            "DELETE FROM notas WHERE folio = %s RETURNING folio", (folio,)
        )
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Nota no encontrada.")

    await conn.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# ENDPOINT 5 — Generar PDF imprimible de una nota
# ---------------------------------------------------------------------------
# El PDF se genera en el backend (Python) con fpdf2, así funciona igual en
# cualquier dispositivo sin depender del motor de impresión del navegador.
#
# Mismo aislamiento que los demás endpoints: worker solo puede generar el
# PDF de sus propias notas; admin/superadmin/viewer pueden generar cualquiera.
#
# La leyenda "No tiene validez fiscal" aparece dos veces en el PDF:
#   1. Bajo el título "COMPROBANTE DE PEDIDO" (primera vista, zona visible)
#   2. Al final del documento (zona de cierre, refuerzo legal)
# ---------------------------------------------------------------------------

_LOGO_RUTA = Path("web-publico/assets/logo_transparente.png")


def _fmt_mxn(valor) -> str:
    """Formatea como moneda MXN: $15,000 o $15,000.50"""
    v = float(valor or 0)
    if v == round(v, 0):
        return f"${int(round(v)):,}"
    return f"${v:,.2f}"


def _fmt_fecha(d) -> str:
    if d is None:
        return "s/f"
    if hasattr(d, "strftime"):
        return d.strftime("%d/%m/%Y")
    return str(d)


def _truncar(texto: Optional[str], max_c: int) -> str:
    if not texto:
        return ""
    return texto if len(texto) <= max_c else texto[: max_c - 1] + "+"


def _latin1(texto: Optional[str], fallback: str = "") -> str:
    """
    Convierte el texto a Latin-1 (el rango que soporta Helvetica en fpdf2).
    Caracteres fuera de ese rango — como el em dash — se reemplazan con '?'.
    Esto previene FPDFUnicodeEncodingException con datos de usuario.
    """
    if not texto:
        return fallback
    return texto.encode("latin-1", errors="replace").decode("latin-1")


def _generar_pdf_bytes(nota: dict, partidas: list) -> bytes:
    """
    Genera el PDF de una nota de venta con fpdf2.

    Layout (A4 portrait, márgenes 15mm):
      Encabezado → logo + nombre + dirección
      Separador
      Título "COMPROBANTE DE PEDIDO" + leyenda fiscal breve
      Caja folio / fechas / estatus
      Datos del cliente
      Tabla de muebles (partidas)
      Caja de montos (Total / Cantidad Pagada / Resta)
      Consideraciones (si las hay)
      Leyenda fiscal completa al pie
    """
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_margins(left=15, top=15, right=15)
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    W = 180  # ancho de contenido: 210 − 15 − 15

    # ── Encabezado ────────────────────────────────────────────────────────────
    y0 = 15
    x_titulo = 15

    if _LOGO_RUTA.exists():
        try:
            pdf.image(str(_LOGO_RUTA), x=15, y=y0, h=22)
            x_titulo = 44   # 15 + 25mm logo + 4mm gap
        except Exception:
            pass  # logo no disponible en esta ejecución; continuar sin él

    texto_w = W - (x_titulo - 15)
    pdf.set_xy(x_titulo, y0)
    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(texto_w, 9, "Galerías Rubí", ln=True)

    pdf.set_x(x_titulo)
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(texto_w, 5, "San Pedro Tultepec, Lerma, Estado de México", ln=True)

    pdf.set_x(x_titulo)
    pdf.cell(texto_w, 5, "Tel: (722) 572-7393 ext. 9", ln=True)

    # Asegurar que bajamos al menos hasta debajo del logo
    pdf.set_y(max(pdf.get_y(), y0 + 24))

    pdf.ln(2)
    pdf.set_draw_color(200, 200, 200)
    pdf.line(15, pdf.get_y(), 195, pdf.get_y())
    pdf.ln(4)

    # ── Título del documento ──────────────────────────────────────────────────
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(W, 7, "COMPROBANTE DE PEDIDO", align="C", ln=True)

    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(140, 100, 30)   # ámbar para llamar la atención
    pdf.cell(
        W, 5,
        "Este documento NO tiene validez fiscal. No es un CFDI ni una factura.",
        align="C", ln=True,
    )
    pdf.set_text_color(0, 0, 0)
    pdf.ln(4)

    # ── Caja de info del pedido ───────────────────────────────────────────────
    col = W / 2
    pdf.set_fill_color(247, 247, 247)
    pdf.set_draw_color(210, 210, 210)

    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(col, 7, f"Folio: {nota['folio']}", border=1, fill=True)
    pdf.cell(col, 7, f"Estatus: {nota['estatus']}", border=1, fill=True, ln=True)

    pdf.set_font("Helvetica", "", 9)
    pdf.cell(col, 6.5, f"Fecha de pedido: {_fmt_fecha(nota.get('fecha_pedido'))}", border=1)
    pdf.cell(col, 6.5, f"Fecha de entrega: {_fmt_fecha(nota.get('fecha_entrega'))}", border=1, ln=True)
    pdf.ln(5)

    # ── Datos del cliente ─────────────────────────────────────────────────────
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(W, 6, "DATOS DEL CLIENTE", ln=True)
    pdf.set_draw_color(200, 200, 200)
    pdf.line(15, pdf.get_y(), 195, pdf.get_y())
    pdf.ln(2)

    pdf.set_font("Helvetica", "", 9)
    nombre_cli = _latin1(nota.get("nombre_cliente"), "s/d")
    tel_cli    = _latin1(nota.get("telefono"),        "s/d")
    vendedor   = _latin1(nota.get("vendedor"),        "s/d")

    pdf.cell(col, 6, f"Nombre: {_truncar(nombre_cli, 35)}")
    pdf.cell(col, 6, f"Tel: {tel_cli}", ln=True)
    pdf.cell(col, 6, f"Vendedor: {_truncar(vendedor, 35)}", ln=True)
    pdf.ln(5)

    # ── Tabla de partidas ─────────────────────────────────────────────────────
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(W, 6, "MUEBLES / ARTÍCULOS", ln=True)
    pdf.set_draw_color(200, 200, 200)
    pdf.line(15, pdf.get_y(), 195, pdf.get_y())
    pdf.ln(2)

    if partidas:
        # Anchos de columna (suman exactamente W = 180mm)
        cw      = [68, 14, 44, 28, 26]
        headers = ["Mueble / Producto", "Cant.", "Modificaciones", "Precio u.", "Importe"]
        aligns  = ["L", "C", "L", "R", "R"]

        pdf.set_fill_color(238, 238, 238)
        pdf.set_draw_color(200, 200, 200)
        pdf.set_font("Helvetica", "B", 8)
        for w, txt, aln in zip(cw, headers, aligns):
            pdf.cell(w, 6.5, txt, border=1, fill=True, align=aln)
        pdf.ln()

        pdf.set_font("Helvetica", "", 8)
        for p in partidas:
            nombre  = _latin1(_truncar(p.get("nombre_producto") or "Articulo libre", 38))
            cant    = str(p.get("cantidad", 1))
            mods    = _latin1(_truncar(p.get("modificaciones"), 25)) or "-"
            precio  = _fmt_mxn(p.get("precio_unitario", 0))
            importe = _fmt_mxn(p.get("importe", 0))

            pdf.cell(cw[0], 6, nombre,  border=1)
            pdf.cell(cw[1], 6, cant,    border=1, align="C")
            pdf.cell(cw[2], 6, mods,    border=1)
            pdf.cell(cw[3], 6, precio,  border=1, align="R")
            pdf.cell(cw[4], 6, importe, border=1, align="R")
            pdf.ln()
    else:
        pdf.set_font("Helvetica", "I", 9)
        pdf.cell(W, 6, "Sin artículos registrados.", ln=True)

    pdf.ln(5)

    # ── Montos ────────────────────────────────────────────────────────────────
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(W, 6, "MONTOS", ln=True)
    pdf.set_draw_color(200, 200, 200)
    pdf.line(15, pdf.get_y(), 195, pdf.get_y())
    pdf.ln(2)

    mw = W / 3   # 60mm por columna
    pdf.set_fill_color(248, 248, 248)
    pdf.set_draw_color(210, 210, 210)

    # Etiquetas
    pdf.set_font("Helvetica", "B", 8)
    for etiqueta in ("TOTAL", "CANTIDAD PAGADA", "RESTA"):
        pdf.cell(mw, 6, etiqueta, border=1, fill=True, align="C")
    pdf.ln()

    # Valores
    valores_m = [
        ("total",    nota.get("total",    0), False),
        ("anticipo", nota.get("anticipo", 0), False),
        ("resta",    nota.get("resta",    0), True),
    ]
    pdf.set_font("Helvetica", "B", 12)
    for _, val, es_resta in valores_m:
        if es_resta and float(val or 0) > 0:
            pdf.set_text_color(160, 90, 0)   # ámbar = saldo pendiente
        pdf.cell(mw, 9, _fmt_mxn(val), border=1, align="C")
        pdf.set_text_color(0, 0, 0)
    pdf.ln()
    pdf.ln(5)

    # ── Consideraciones ───────────────────────────────────────────────────────
    consideraciones = nota.get("consideraciones")
    if consideraciones:
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(W, 6, "CONSIDERACIONES", ln=True)
        pdf.set_draw_color(200, 200, 200)
        pdf.line(15, pdf.get_y(), 195, pdf.get_y())
        pdf.ln(2)
        pdf.set_font("Helvetica", "", 9)
        pdf.multi_cell(W, 5, _latin1(consideraciones), align="L")
        pdf.ln(4)

    # ── Condiciones del pedido (anticipo / cancelación) ───────────────────────
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(W, 6, "CONDICIONES", ln=True)
    pdf.set_draw_color(200, 200, 200)
    pdf.line(15, pdf.get_y(), 195, pdf.get_y())
    pdf.ln(2)
    pdf.set_font("Helvetica", "", 8)
    pdf.multi_cell(
        W, 4.5,
        _latin1(
            "- Después de 30 días de la fecha del pedido no se aceptan "
            "reclamaciones sobre el anticipo.\n"
            "- En caso de cancelación del pedido se cobrará un 10% del "
            "valor total del pedido."
        ),
        align="L",
    )
    pdf.ln(4)

    # ── Leyenda fiscal (refuerzo al final) ────────────────────────────────────
    pdf.set_draw_color(200, 200, 200)
    pdf.line(15, pdf.get_y(), 195, pdf.get_y())
    pdf.ln(3)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(120, 120, 120)
    pdf.multi_cell(
        W, 4.5,
        "Este documento es un comprobante de pedido y NO tiene validez fiscal. "
        "No es un CFDI ni una factura electrónica. "
        "Para obtener un comprobante fiscal, solicitarlo expresamente al vendedor.",
        align="C",
    )
    pdf.set_text_color(0, 0, 0)

    return pdf.output()


@router.get("/notas/{folio}/pdf")
async def generar_pdf_nota(
    folio: str,
    usuario: UsuarioActual = Depends(get_usuario_actual),
    conn=Depends(get_db),
):
    # Misma lógica que obtener_nota para cargar y verificar acceso.
    async with conn.cursor() as cur:
        await cur.execute(_SQL_DETALLE, (folio,))
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Nota no encontrada.")

    _verificar_acceso(usuario, row[13])   # row[13] = usuario_id de la nota

    async with conn.cursor() as cur:
        await cur.execute(_SQL_PARTIDAS, (folio,))
        partidas_rows = await cur.fetchall()

    nota_data = _fila_a_detalle(row)
    partidas_lista = [_fila_a_partida(r) for r in partidas_rows]

    pdf_bytes = bytes(_generar_pdf_bytes(nota_data, partidas_lista))

    nombre_archivo = f"nota-{folio}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{nombre_archivo}"'},
    )


# ---------------------------------------------------------------------------
# ENDPOINT 6 — Enviar el PDF de la nota por correo
# ---------------------------------------------------------------------------
# Envía una copia del PDF a la casilla del negocio (NOTA_EMAIL_DESTINO en
# api/.env, por defecto mueblesrubimx@gmail.com) — pensado como respaldo /
# archivo de la nota, no como envío al cliente (no hay campo de email de
# cliente en el esquema, solo teléfono).
#
# Requiere en api/.env:
#   SMTP_HOST      (opcional, default smtp.gmail.com)
#   SMTP_PORT      (opcional, default 587 — STARTTLS; ver nota en _enviar_pdf_por_email)
#   SMTP_USER      la cuenta que envía (ej. mueblesrubimx@gmail.com)
#   SMTP_PASSWORD  contraseña de aplicación de Gmail (NO la contraseña normal
#                  de la cuenta — Cuenta de Google → Seguridad → Verificación
#                  en 2 pasos → Contraseñas de aplicaciones)
#   NOTA_EMAIL_DESTINO (opcional, default mueblesrubimx@gmail.com)
# ---------------------------------------------------------------------------

NOTA_EMAIL_DESTINO_DEFAULT = "mueblesrubimx@gmail.com"


def _enviar_pdf_por_email(
    destinatario: str,
    asunto: str,
    cuerpo: str,
    pdf_bytes: bytes,
    nombre_archivo: str,
) -> None:
    """
    Envío SMTP bloqueante — se llama vía asyncio.to_thread() desde el
    endpoint async para no congelar el event loop mientras dura la
    conexión con el servidor de correo.

    Puerto 587 + STARTTLS (no 465 + TLS implícito): varios proveedores de
    VPS, incluido Hetzner, bloquean el puerto 465 saliente por defecto
    (anti-spam). 587 es texto plano al conectar y sube a TLS con
    STARTTLS() después del saludo — por eso se usa SMTP() normal, NUNCA
    SMTP_SSL() (que asume TLS implícito desde el primer byte y truena con
    'WRONG_VERSION_NUMBER' si el puerto es 587).
    """
    usuario_smtp   = os.getenv("SMTP_USER")
    password_smtp  = os.getenv("SMTP_PASSWORD")

    if not usuario_smtp or not password_smtp:
        raise RuntimeError(
            "El envío de correo no está configurado: faltan SMTP_USER / "
            "SMTP_PASSWORD en api/.env."
        )

    host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    port = int(os.getenv("SMTP_PORT", "587"))

    msg = EmailMessage()
    msg["Subject"] = asunto
    msg["From"]    = os.getenv("SMTP_FROM", usuario_smtp)
    msg["To"]      = destinatario
    msg.set_content(cuerpo)
    msg.add_attachment(
        pdf_bytes, maintype="application", subtype="pdf", filename=nombre_archivo
    )

    with smtplib.SMTP(host, port) as server:
        server.starttls()
        server.login(usuario_smtp, password_smtp)
        server.send_message(msg)


@router.post("/notas/{folio}/enviar-email")
async def enviar_nota_email(
    folio: str,
    usuario: UsuarioActual = Depends(get_usuario_actual),
    conn=Depends(get_db),
):
    # Misma lógica que obtener_nota/generar_pdf_nota para cargar y verificar acceso.
    async with conn.cursor() as cur:
        await cur.execute(_SQL_DETALLE, (folio,))
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Nota no encontrada.")

    _verificar_acceso(usuario, row[13])   # row[13] = usuario_id de la nota

    async with conn.cursor() as cur:
        await cur.execute(_SQL_PARTIDAS, (folio,))
        partidas_rows = await cur.fetchall()

    nota_data      = _fila_a_detalle(row)
    partidas_lista = [_fila_a_partida(r) for r in partidas_rows]
    pdf_bytes      = bytes(_generar_pdf_bytes(nota_data, partidas_lista))

    destinatario = os.getenv("NOTA_EMAIL_DESTINO", NOTA_EMAIL_DESTINO_DEFAULT)
    cliente      = nota_data.get("nombre_cliente") or "sin nombre"
    asunto       = f"Nota {folio} - {cliente}"
    cuerpo = (
        f"Nota de venta {folio}\n"
        f"Cliente: {cliente}\n"
        f"Total: {_fmt_mxn(nota_data.get('total', 0))}\n"
        f"Resta: {_fmt_mxn(nota_data.get('resta', 0))}\n"
        f"Enviado desde el panel por: {usuario.nombre}\n"
    )

    try:
        await asyncio.to_thread(
            _enviar_pdf_por_email,
            destinatario, asunto, cuerpo, pdf_bytes, f"nota-{folio}.pdf",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except smtplib.SMTPException:
        raise HTTPException(
            status_code=502,
            detail="No se pudo enviar el correo. Revisa la configuración SMTP en api/.env.",
        )

    return {"ok": True, "destinatario": destinatario}


# ---------------------------------------------------------------------------
# ENDPOINT 7 — Pagos (cómo se cobró la nota: efectivo / tarjeta / transferencia)
# ---------------------------------------------------------------------------
# Mismo aislamiento que el resto de sub-recursos de notas: un worker solo
# puede ver/registrar/borrar pagos de SUS PROPIAS notas; admin/superadmin ven
# y editan todas. anticipo/resta en NOTAS siguen siendo la fuente de verdad
# del monto total — esto es solo el registro de CÓMO se cobró.
# ---------------------------------------------------------------------------

async def _obtener_nota_o_404(conn, folio: str) -> Optional[int]:
    """Devuelve el usuario_id dueño de la nota, o levanta 404 si no existe."""
    async with conn.cursor() as cur:
        await cur.execute("SELECT usuario_id FROM notas WHERE folio = %s", (folio,))
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Nota no encontrada.")
    return row[0]


@router.post("/notas/{folio}/pagos", response_model=PagoOut, status_code=201)
async def crear_pago(
    folio: str,
    data: PagoInput,
    usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    nota_usuario_id = await _obtener_nota_o_404(conn, folio)
    _verificar_acceso(usuario, nota_usuario_id)

    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO pagos (folio_pedido, fecha, tipo, metodo, monto, usuario_id)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (folio, data.fecha or date.today(), data.tipo, data.metodo, data.monto, usuario.id),
        )
        nuevo_id = (await cur.fetchone())[0]
    await conn.commit()

    # Releer el pago recién creado con el join de nombre_usuario ya resuelto.
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT
                pg.id, pg.folio_pedido, pg.fecha, pg.tipo, pg.metodo, pg.monto,
                pg.usuario_id, u.nombre AS nombre_usuario, pg.creado_en
            FROM  pagos pg
            LEFT  JOIN usuarios u ON u.id = pg.usuario_id
            WHERE pg.id = %s
            """,
            (nuevo_id,),
        )
        row = await cur.fetchone()

    return _fila_a_pago(row)


@router.get("/notas/{folio}/pagos", response_model=list[PagoOut])
async def listar_pagos(
    folio: str,
    usuario: UsuarioActual = Depends(get_usuario_actual),
    conn=Depends(get_db),
):
    nota_usuario_id = await _obtener_nota_o_404(conn, folio)
    _verificar_acceso(usuario, nota_usuario_id)

    async with conn.cursor() as cur:
        await cur.execute(_SQL_PAGOS, (folio,))
        rows = await cur.fetchall()

    return [_fila_a_pago(r) for r in rows]


@router.delete("/notas/{folio}/pagos/{pago_id}")
async def eliminar_pago(
    folio: str,
    pago_id: int,
    usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    nota_usuario_id = await _obtener_nota_o_404(conn, folio)
    _verificar_acceso(usuario, nota_usuario_id)

    async with conn.cursor() as cur:
        await cur.execute(
            "DELETE FROM pagos WHERE id = %s AND folio_pedido = %s RETURNING id",
            (pago_id, folio),
        )
        eliminado = await cur.fetchone()

    if eliminado is None:
        raise HTTPException(status_code=404, detail="Pago no encontrado.")

    await conn.commit()
    return {"ok": True}
