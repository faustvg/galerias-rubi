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
    proveedor_id: Optional[int] = None
    color: Optional[str] = None
    material: Optional[str] = None
    descripcion: Optional[str] = None
    precio_base: Annotated[float, Field(ge=0)] = 0
    costo:       Annotated[float, Field(ge=0)] = 0   # costo interno, nunca sale al público
    existencias: Annotated[int, Field(ge=0)] = 0
    visible_en_sitio: bool = True
    descuento_pct: Optional[Annotated[float, Field(ge=0, le=100)]] = None
    fotos: list[str] = []
    ubicaciones: list[str] = []


class ProductoUpdate(BaseModel):
    nombre: Optional[str] = None
    categoria_id: Optional[int] = None
    proveedor_id: Optional[int] = None
    color: Optional[str] = None
    material: Optional[str] = None
    descripcion: Optional[str] = None
    precio_base: Optional[Annotated[float, Field(ge=0)]]         = None
    costo:       Optional[Annotated[float, Field(ge=0)]]         = None
    existencias: Optional[Annotated[int, Field(ge=0)]]           = None
    visible_en_sitio: Optional[bool]                             = None
    descuento_pct: Optional[Annotated[float, Field(ge=0, le=100)]] = None
    fotos: Optional[list[str]] = None
    ubicaciones: Optional[list[str]] = None


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
    ubicaciones: list[str] = []


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
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO productos
                    (nombre, categoria_id, proveedor_id, color, material,
                     descripcion, precio_base, costo, existencias,
                     visible_en_sitio, descuento_pct, fotos, ubicaciones)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    data.nombre, data.categoria_id, data.proveedor_id,
                    data.color, data.material, data.descripcion,
                    data.precio_base, data.costo, data.existencias,
                    data.visible_en_sitio, data.descuento_pct, data.fotos,
                    data.ubicaciones,
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
                p.existencias, p.visible_en_sitio, p.ubicaciones
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
