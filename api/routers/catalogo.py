from datetime import date, datetime
from typing import Annotated, Optional

import psycopg.errors
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.auth import get_usuario_actual, requiere_roles, UsuarioActual
from api.database import get_db

router = APIRouter()

ROLES_ESCRITURA = ("superadmin", "admin", "worker")


# ---------------------------------------------------------------------------
# Schemas — Categorias
# ---------------------------------------------------------------------------

class CategoriaCreate(BaseModel):
    nombre: str
    descuento_pct: Annotated[float, Field(ge=0, le=100)] = 0


class CategoriaUpdate(BaseModel):
    nombre: Optional[str] = None
    descuento_pct: Optional[Annotated[float, Field(ge=0, le=100)]] = None


# ---------------------------------------------------------------------------
# Schemas — Proveedores
# ---------------------------------------------------------------------------

class ProveedorCreate(BaseModel):
    proveedor: str


class ProveedorUpdate(BaseModel):
    proveedor: Optional[str] = None


# ---------------------------------------------------------------------------
# Schemas — Productos
# ---------------------------------------------------------------------------

class ProductoCreate(BaseModel):
    nombre: str
    categoria_id: Optional[int] = None
    proveedor_id: Optional[int] = None   # proveedor POR DEFECTO del catálogo — se fija al crear
    color: Optional[str] = None
    material: Optional[str] = None
    descripcion: Optional[str] = None
    precio_base: Annotated[float, Field(ge=0)] = 0
    costo:       Annotated[float, Field(ge=0)] = 0   # costo interno, nunca sale al público
    visible_en_sitio: bool = True
    destacados: bool = False
    descuento_pct: Optional[Annotated[float, Field(ge=0, le=100)]] = None
    fotos: list[str] = []
    # existencias, fecha_ingreso y ubicaciones NO se aceptan aquí (migración
    # 010): son derivados de movimientos_inventario vía trigger. Un producto
    # nuevo arranca en existencias=0 y ubicaciones={} (defaults de columna);
    # si ya trae stock/ubicación conocidos, se registran como su primer
    # movimiento en "Editar stock" después de crearlo — eso es lo que deja
    # fecha_ingreso y ubicaciones correctamente sembrados, no un valor
    # puesto a mano aquí que el trigger luego pisaría.


class ProductoUpdate(BaseModel):
    nombre: Optional[str] = None
    categoria_id: Optional[int] = None
    proveedor_id: Optional[int] = None
    color: Optional[str] = None
    material: Optional[str] = None
    descripcion: Optional[str] = None
    precio_base: Optional[Annotated[float, Field(ge=0)]]         = None
    costo:       Optional[Annotated[float, Field(ge=0)]]         = None
    visible_en_sitio: Optional[bool]                             = None
    destacados: Optional[bool]                                   = None
    descuento_pct: Optional[Annotated[float, Field(ge=0, le=100)]] = None
    fotos: Optional[list[str]] = None
    # existencias, fecha_ingreso y ubicaciones deliberadamente ausentes
    # (migración 010): son derivados de movimientos_inventario vía trigger
    # — escribirlos aquí competiría con el trigger y se perdería en el
    # próximo movimiento. Se editan indirectamente agregando/editando/
    # borrando movimientos en "Editar stock" (POST/PUT/DELETE
    # /productos/{id}/movimientos).


# ---------------------------------------------------------------------------
# Schemas — Movimientos de inventario (restock)
# ---------------------------------------------------------------------------

class MovimientoInventarioCreate(BaseModel):
    cantidad: Annotated[int, Field(gt=0)]
    fecha: Optional[date] = None       # si no se manda, el endpoint usa hoy
    ubicacion: Optional[str] = None
    proveedor_id: Optional[int] = None       # de qué proveedor vino ESTE lote (migración 010)
    costo_unitario: Optional[Annotated[float, Field(ge=0)]] = None   # opcional — no siempre hay factura a mano


class MovimientoInventarioUpdate(BaseModel):
    """PUT parcial — mismo patrón que ProductoUpdate: solo se tocan los
    campos enviados. cantidad usa gt=0 igual que en creación (un movimiento
    de 0 o negativo no tiene sentido; para "deshacer" un movimiento se borra,
    no se edita a 0)."""
    cantidad: Optional[Annotated[int, Field(gt=0)]] = None
    fecha: Optional[date] = None
    ubicacion: Optional[str] = None
    proveedor_id: Optional[int] = None
    costo_unitario: Optional[Annotated[float, Field(ge=0)]] = None


class MovimientoInventarioOut(BaseModel):
    """Respuesta de POST y PUT — incluye el estado derivado ACTUAL del
    producto (existencias, fecha_ingreso, ubicaciones) para que el frontend
    pueda sincronizar sin una segunda petición. Los tres los recalcula el
    trigger; aquí solo se leen de vuelta, nunca se escriben."""
    id: int
    producto_id: int
    cantidad: int
    fecha: date
    ubicacion: Optional[str] = None
    proveedor_id: Optional[int] = None
    costo_unitario: Optional[float] = None
    costo_total: Optional[float] = None
    existencias_totales: int
    fecha_ingreso_producto: Optional[date] = None
    ubicaciones_producto: list[str] = []


class MovimientoInventarioItem(BaseModel):
    """Una fila del historial (GET)."""
    id: int
    producto_id: int
    cantidad: int
    fecha: date
    ubicacion: Optional[str] = None
    usuario_id: Optional[int] = None
    nombre_usuario: Optional[str] = None   # join de usuarios — quién lo registró
    proveedor_id: Optional[int] = None
    nombre_proveedor: Optional[str] = None   # join de proveedores
    costo_unitario: Optional[float] = None
    costo_total: Optional[float] = None
    creado_en: datetime


# ---------------------------------------------------------------------------
# Schema — Admin (lectura con todos los campos)
# ---------------------------------------------------------------------------

class AdminProducto(BaseModel):
    id: int
    nombre: str
    descripcion: Optional[str] = None
    precio_base: float
    costo: float = 0.0          # solo en el panel admin — nunca en el endpoint público
    descuento_pct: Optional[float] = None
    fotos: list[str]
    color: Optional[str] = None
    material: Optional[str] = None
    categoria_id: Optional[int] = None
    categoria: Optional[str] = None
    proveedor_id: Optional[int] = None
    proveedor: Optional[str] = None
    existencias: int
    visible_en_sitio: bool
    destacados: bool = False
    ubicaciones: list[str] = []
    fecha_ingreso: Optional[date] = None


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _set_clause(campos: dict) -> tuple[str, list]:
    """
    Construye la cláusula SET de un UPDATE parametrizado.

    Las claves de 'campos' son nombres de campos de modelos Pydantic
    (identifiers Python, nunca input del usuario), por lo que incluirlas
    en la cláusula SET no introduce riesgo de inyección SQL.
    Los valores sí van siempre como parámetros (%s).
    """
    partes = ", ".join(f"{col} = %s" for col in campos)
    return partes, list(campos.values())


# ---------------------------------------------------------------------------
# Endpoints — Categorias
# ---------------------------------------------------------------------------

@router.post("/categorias", status_code=201)
async def crear_categoria(
    data: CategoriaCreate,
    _usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    async with conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO categorias (nombre, descuento_pct) VALUES (%s, %s) RETURNING id",
            (data.nombre, data.descuento_pct),
        )
        row = await cur.fetchone()
    await conn.commit()
    return {"id": row[0], "nombre": data.nombre, "descuento_pct": data.descuento_pct}


@router.put("/categorias/{categoria_id}")
async def actualizar_categoria(
    categoria_id: int,
    data: CategoriaUpdate,
    _usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    campos = data.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status_code=422, detail="No hay campos para actualizar")

    set_sql, valores = _set_clause(campos)
    async with conn.cursor() as cur:
        await cur.execute(
            f"UPDATE categorias SET {set_sql} WHERE id = %s RETURNING id",
            valores + [categoria_id],
        )
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")

    await conn.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Endpoints — Proveedores
# ---------------------------------------------------------------------------

@router.post("/proveedores", status_code=201)
async def crear_proveedor(
    data: ProveedorCreate,
    _usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    async with conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO proveedores (proveedor) VALUES (%s) RETURNING id",
            (data.proveedor,),
        )
        row = await cur.fetchone()
    await conn.commit()
    return {"id": row[0], "proveedor": data.proveedor}


@router.put("/proveedores/{proveedor_id}")
async def actualizar_proveedor(
    proveedor_id: int,
    data: ProveedorUpdate,
    _usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    campos = data.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status_code=422, detail="No hay campos para actualizar")

    set_sql, valores = _set_clause(campos)
    async with conn.cursor() as cur:
        await cur.execute(
            f"UPDATE proveedores SET {set_sql} WHERE id = %s RETURNING id",
            valores + [proveedor_id],
        )
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")

    await conn.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Endpoints — Productos
# ---------------------------------------------------------------------------

@router.post("/productos", status_code=201)
async def crear_producto(
    data: ProductoCreate,
    _usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    # existencias, fecha_ingreso y ubicaciones NO se insertan aquí: arrancan
    # en sus DEFAULT de columna (0, CURRENT_DATE, '{}' — schema.sql) hasta
    # que el primer movimiento en "Editar stock" los sobreescriba vía el
    # trigger (migración 010).
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO productos
                    (nombre, categoria_id, proveedor_id, color, material,
                     descripcion, precio_base, costo,
                     visible_en_sitio, destacados, descuento_pct, fotos)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    data.nombre, data.categoria_id, data.proveedor_id,
                    data.color, data.material, data.descripcion,
                    data.precio_base, data.costo,
                    data.visible_en_sitio, data.destacados, data.descuento_pct, data.fotos,
                ),
            )
            row = await cur.fetchone()
        await conn.commit()
    except psycopg.errors.ForeignKeyViolation:
        raise HTTPException(
            status_code=422,
            detail="categoria_id o proveedor_id no existe",
        )

    return {"id": row[0]}


@router.put("/productos/{producto_id}")
async def actualizar_producto(
    producto_id: int,
    data: ProductoUpdate,
    _usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    campos = data.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status_code=422, detail="No hay campos para actualizar")

    set_sql, valores = _set_clause(campos)
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                f"UPDATE productos SET {set_sql} WHERE id = %s RETURNING id",
                valores + [producto_id],
            )
            row = await cur.fetchone()
    except psycopg.errors.ForeignKeyViolation:
        raise HTTPException(
            status_code=422,
            detail="categoria_id o proveedor_id no existe",
        )

    if row is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    await conn.commit()
    return {"ok": True}


@router.get("/admin/productos", response_model=list[AdminProducto])
async def listar_todos_productos(
    _usuario: UsuarioActual = Depends(get_usuario_actual),
    conn=Depends(get_db),
):
    """
    Endpoint exclusivo del panel admin: devuelve TODOS los productos,
    incluyendo los discontinuados (visible_en_sitio = false).
    Requiere sesión activa (cualquier rol).
    """
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT
                p.id, p.nombre, p.descripcion, p.precio_base, p.costo,
                p.descuento_pct, p.fotos, p.color, p.material,
                p.categoria_id, c.nombre AS categoria,
                p.proveedor_id, prov.proveedor,
                p.existencias, p.visible_en_sitio, p.ubicaciones,
                p.fecha_ingreso, p.destacados
            FROM productos p
            LEFT JOIN categorias c    ON c.id   = p.categoria_id
            LEFT JOIN proveedores prov ON prov.id = p.proveedor_id
            ORDER BY p.nombre
            """
        )
        rows = await cur.fetchall()

    return [
        {
            "id": r[0], "nombre": r[1], "descripcion": r[2],
            "precio_base": float(r[3] or 0),
            "costo": float(r[4] or 0),
            "descuento_pct": float(r[5]) if r[5] is not None else None,
            "fotos": r[6] or [], "color": r[7], "material": r[8],
            "categoria_id": r[9], "categoria": r[10],
            "proveedor_id": r[11], "proveedor": r[12],
            "existencias": r[13] or 0, "visible_en_sitio": r[14],
            "ubicaciones": r[15] or [],
            "fecha_ingreso": r[16],
            "destacados": r[17],
        }
        for r in rows
    ]


@router.delete("/productos/{producto_id}")
async def descontinuar_producto(
    producto_id: int,
    _usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    """
    Soft-delete: pone visible_en_sitio = false.
    El producto permanece en la DB para preservar historial de notas.
    Para borrarlo físicamente habría que hacerlo desde psql directamente.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            "UPDATE productos SET visible_en_sitio = false WHERE id = %s RETURNING id",
            (producto_id,),
        )
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    await conn.commit()
    return {"ok": True, "visible_en_sitio": False}


# ---------------------------------------------------------------------------
# Endpoints — Movimientos de inventario (restock)
# ---------------------------------------------------------------------------

@router.post(
    "/productos/{producto_id}/movimientos",
    status_code=201,
    response_model=MovimientoInventarioOut,
)
async def registrar_movimiento_inventario(
    producto_id: int,
    data: MovimientoInventarioCreate,
    usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    """
    Registra una entrada de inventario (restock). productos.existencias y
    productos.fecha_ingreso NO se tocan aquí a mano — el trigger
    trg_recalcular_existencias (migración 010) los recalcula solo en cuanto
    se hace el INSERT, dentro de la misma transacción. Este endpoint solo
    lee de vuelta el resultado para devolvérselo al frontend.
    """
    fecha = data.fecha or date.today()

    async with conn.cursor() as cur:
        await cur.execute("SELECT id FROM productos WHERE id = %s", (producto_id,))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")

        await cur.execute(
            """
            INSERT INTO movimientos_inventario
                (producto_id, cantidad, fecha, ubicacion, usuario_id, proveedor_id, costo_unitario)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id, costo_total
            """,
            (
                producto_id, data.cantidad, fecha, data.ubicacion, usuario.id,
                data.proveedor_id, data.costo_unitario,
            ),
        )
        mov_id, costo_total = await cur.fetchone()

        # El trigger ya corrió (AFTER INSERT, misma transacción) — esto lee
        # el resultado, no lo calcula aquí.
        await cur.execute(
            "SELECT existencias, fecha_ingreso, ubicaciones FROM productos WHERE id = %s",
            (producto_id,),
        )
        existencias_totales, fecha_ingreso_producto, ubicaciones_producto = await cur.fetchone()

    await conn.commit()
    return {
        "id": mov_id,
        "producto_id": producto_id,
        "cantidad": data.cantidad,
        "fecha": fecha,
        "ubicacion": data.ubicacion,
        "proveedor_id": data.proveedor_id,
        "costo_unitario": float(data.costo_unitario) if data.costo_unitario is not None else None,
        "costo_total": float(costo_total) if costo_total is not None else None,
        "existencias_totales": existencias_totales,
        "fecha_ingreso_producto": fecha_ingreso_producto,
        "ubicaciones_producto": ubicaciones_producto or [],
    }


@router.get(
    "/productos/{producto_id}/movimientos",
    response_model=list[MovimientoInventarioItem],
)
async def listar_movimientos_inventario(
    producto_id: int,
    _usuario: UsuarioActual = Depends(get_usuario_actual),
    conn=Depends(get_db),
):
    """
    Historial de entradas de inventario de un producto, más reciente primero.
    Cualquier rol autenticado puede leerlo — es solo lectura, mismo criterio
    de acceso que /admin/productos.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT id FROM productos WHERE id = %s", (producto_id,)
        )
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")

        await cur.execute(
            """
            SELECT
                m.id, m.producto_id, m.cantidad, m.fecha, m.ubicacion,
                m.usuario_id, u.nombre AS nombre_usuario, m.creado_en,
                m.proveedor_id, prov.proveedor AS nombre_proveedor,
                m.costo_unitario, m.costo_total
            FROM  movimientos_inventario m
            LEFT  JOIN usuarios    u    ON u.id    = m.usuario_id
            LEFT  JOIN proveedores prov ON prov.id = m.proveedor_id
            WHERE m.producto_id = %s
            ORDER BY m.fecha DESC, m.id DESC
            """,
            (producto_id,),
        )
        rows = await cur.fetchall()

    return [
        {
            "id": r[0], "producto_id": r[1], "cantidad": r[2], "fecha": r[3],
            "ubicacion": r[4], "usuario_id": r[5], "nombre_usuario": r[6],
            "creado_en": r[7],
            "proveedor_id": r[8], "nombre_proveedor": r[9],
            "costo_unitario": float(r[10]) if r[10] is not None else None,
            "costo_total": float(r[11]) if r[11] is not None else None,
        }
        for r in rows
    ]


@router.put(
    "/productos/{producto_id}/movimientos/{movimiento_id}",
    response_model=MovimientoInventarioOut,
)
async def editar_movimiento_inventario(
    producto_id: int,
    movimiento_id: int,
    data: MovimientoInventarioUpdate,
    _usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    """
    Corrige una entrada ya registrada (cantidad, fecha, ubicación, proveedor
    o costo mal capturados). Igual que en el POST, productos.existencias,
    fecha_ingreso y ubicaciones se recalculan solos vía trigger — este
    endpoint nunca los toca directamente.
    """
    campos = data.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status_code=422, detail="No hay campos para actualizar")

    set_sql, valores = _set_clause(campos)
    async with conn.cursor() as cur:
        await cur.execute(
            f"""
            UPDATE movimientos_inventario SET {set_sql}
            WHERE id = %s AND producto_id = %s
            RETURNING id, producto_id, cantidad, fecha, ubicacion,
                      proveedor_id, costo_unitario, costo_total
            """,
            valores + [movimiento_id, producto_id],
        )
        row = await cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Movimiento no encontrado")

        await cur.execute(
            "SELECT existencias, fecha_ingreso, ubicaciones FROM productos WHERE id = %s",
            (producto_id,),
        )
        existencias_totales, fecha_ingreso_producto, ubicaciones_producto = await cur.fetchone()

    await conn.commit()
    return {
        "id": row[0],
        "producto_id": row[1],
        "cantidad": row[2],
        "fecha": row[3],
        "ubicacion": row[4],
        "proveedor_id": row[5],
        "costo_unitario": float(row[6]) if row[6] is not None else None,
        "costo_total": float(row[7]) if row[7] is not None else None,
        "existencias_totales": existencias_totales,
        "fecha_ingreso_producto": fecha_ingreso_producto,
        "ubicaciones_producto": ubicaciones_producto or [],
    }


@router.delete("/productos/{producto_id}/movimientos/{movimiento_id}")
async def eliminar_movimiento_inventario(
    producto_id: int,
    movimiento_id: int,
    _usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    """
    Borra una entrada capturada por error. El trigger recalcula
    existencias/fecha_ingreso/ubicaciones solo; se devuelven ya
    actualizados para que el frontend no necesite una segunda petición.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            "DELETE FROM movimientos_inventario WHERE id = %s AND producto_id = %s RETURNING id",
            (movimiento_id, producto_id),
        )
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="Movimiento no encontrado")

        await cur.execute(
            "SELECT existencias, fecha_ingreso, ubicaciones FROM productos WHERE id = %s",
            (producto_id,),
        )
        existencias_totales, fecha_ingreso_producto, ubicaciones_producto = await cur.fetchone()

    await conn.commit()
    return {
        "ok": True,
        "existencias_totales": existencias_totales,
        "fecha_ingreso_producto": fecha_ingreso_producto,
        "ubicaciones_producto": ubicaciones_producto or [],
    }
