from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import requiere_roles, UsuarioActual
from api.database import get_db

router = APIRouter()

ROLES_ESCRITURA = ("superadmin", "admin")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SucursalOut(BaseModel):
    id: int
    nombre: str
    razon_social: str
    direccion: Optional[str]
    maps_url: Optional[str]
    whatsapp: Optional[str]
    ocultar_precio_publico: bool
    activo: bool
    # Solo lectura — ver SucursalUpdate para el porqué de no aceptarlo aquí.
    es_principal: bool


class SucursalUpdate(BaseModel):
    """
    es_principal NO está en este modelo a propósito: es la llave estable
    que el backend usa para identificar "San Pedro" vs "la otra sucursal"
    sin depender del texto editable de 'nombre' (ver migración 011 /
    _sucursal_cdmx_id en catalogo.py). Si se pudiera editar desde aquí sin
    ninguna guarda, sería trivial terminar con 0 o 2+ sucursales marcadas
    como principal a la vez. Se deja fija por seed/migración hasta que
    valga la pena construir esa validación — no antes.
    """
    nombre: Optional[str] = None
    razon_social: Optional[str] = None
    direccion: Optional[str] = None
    maps_url: Optional[str] = None
    whatsapp: Optional[str] = None
    ocultar_precio_publico: Optional[bool] = None
    activo: Optional[bool] = None


def _set_clause(campos: dict) -> tuple[str, list]:
    partes = ", ".join(f"{col} = %s" for col in campos)
    return partes, list(campos.values())


_COLUMNAS = (
    "id, nombre, razon_social, direccion, maps_url, whatsapp,"
    " ocultar_precio_publico, activo, es_principal"
)


def _fila_a_sucursal(r) -> dict:
    return {
        "id": r[0],
        "nombre": r[1],
        "razon_social": r[2],
        "direccion": r[3],
        "maps_url": r[4],
        "whatsapp": r[5],
        "ocultar_precio_publico": r[6],
        "activo": r[7],
        "es_principal": r[8],
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

# Sin catálogo dinámico: solo San Pedro y CDMX existen y no se crean/borran
# desde la app (son entidades legales fijas) — por eso no hay POST/DELETE,
# solo listar y editar los datos de las dos filas que sembró la migración 011.

@router.get("/sucursales", response_model=list[SucursalOut])
async def listar_sucursales(
    # Cualquier rol que pueda crear/editar notas necesita ver esta lista
    # (NotaFormulario la usa para el select editable de sucursal).
    _usuario: UsuarioActual = requiere_roles("superadmin", "admin", "worker"),
    conn=Depends(get_db),
):
    async with conn.cursor() as cur:
        await cur.execute(f"SELECT {_COLUMNAS} FROM sucursales ORDER BY nombre")
        rows = await cur.fetchall()
    return [_fila_a_sucursal(r) for r in rows]


@router.put("/sucursales/{sucursal_id}", response_model=SucursalOut)
async def actualizar_sucursal(
    sucursal_id: int,
    data: SucursalUpdate,
    _usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    campos = data.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status_code=422, detail="No hay campos para actualizar")

    set_sql, valores = _set_clause(campos)
    async with conn.cursor() as cur:
        await cur.execute(
            f"UPDATE sucursales SET {set_sql} WHERE id = %s RETURNING {_COLUMNAS}",
            valores + [sucursal_id],
        )
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada")

    await conn.commit()
    return _fila_a_sucursal(row)
