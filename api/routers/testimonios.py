from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.auth import requiere_roles, UsuarioActual
from api.database import get_db

router = APIRouter()

ROLES_ESCRITURA = ("superadmin", "admin")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class TestimonioOut(BaseModel):
    id: int
    texto: str
    autor: str
    ciudad: Optional[str]
    activo: bool
    orden: int


class TestimonioCreate(BaseModel):
    texto: str = Field(..., min_length=1)
    autor: str = Field(..., min_length=1, max_length=150)
    ciudad: Optional[str] = None
    activo: bool = True
    orden: int = 0


class TestimonioUpdate(BaseModel):
    texto: Optional[str] = Field(None, min_length=1)
    autor: Optional[str] = Field(None, min_length=1, max_length=150)
    ciudad: Optional[str] = None
    activo: Optional[bool] = None
    orden: Optional[int] = None


def _set_clause(campos: dict) -> tuple[str, list]:
    partes = ", ".join(f"{col} = %s" for col in campos)
    return partes, list(campos.values())


_COLUMNAS = "id, texto, autor, ciudad, activo, orden"


def _fila_a_testimonio(r) -> dict:
    return {
        "id": r[0],
        "texto": r[1],
        "autor": r[2],
        "ciudad": r[3],
        "activo": r[4],
        "orden": r[5],
    }


# ---------------------------------------------------------------------------
# Endpoints — panel admin (superadmin/admin, misma curación manual que
# productos.destacados: la familia decide qué se muestra sin tocar código)
# ---------------------------------------------------------------------------

@router.get("/testimonios", response_model=list[TestimonioOut])
async def listar_testimonios(
    _usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    async with conn.cursor() as cur:
        await cur.execute(f"SELECT {_COLUMNAS} FROM testimonios ORDER BY orden, id")
        rows = await cur.fetchall()
    return [_fila_a_testimonio(r) for r in rows]


@router.post("/testimonios", status_code=201, response_model=TestimonioOut)
async def crear_testimonio(
    data: TestimonioCreate,
    _usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    async with conn.cursor() as cur:
        await cur.execute(
            f"""
            INSERT INTO testimonios (texto, autor, ciudad, activo, orden)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING {_COLUMNAS}
            """,
            (data.texto, data.autor, data.ciudad, data.activo, data.orden),
        )
        row = await cur.fetchone()
    await conn.commit()
    return _fila_a_testimonio(row)


@router.put("/testimonios/{testimonio_id}", response_model=TestimonioOut)
async def actualizar_testimonio(
    testimonio_id: int,
    data: TestimonioUpdate,
    _usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    campos = data.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status_code=422, detail="No hay campos para actualizar")

    set_sql, valores = _set_clause(campos)
    async with conn.cursor() as cur:
        await cur.execute(
            f"UPDATE testimonios SET {set_sql} WHERE id = %s RETURNING {_COLUMNAS}",
            valores + [testimonio_id],
        )
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Testimonio no encontrado")

    await conn.commit()
    return _fila_a_testimonio(row)


@router.delete("/testimonios/{testimonio_id}")
async def eliminar_testimonio(
    testimonio_id: int,
    _usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    # Sin soft-delete: a diferencia de productos, un testimonio no tiene
    # historial transaccional que preservar (no hay FKs hacia notas/ventas)
    # — es contenido de marketing, borrarlo de verdad es lo esperado.
    async with conn.cursor() as cur:
        await cur.execute("DELETE FROM testimonios WHERE id = %s RETURNING id", (testimonio_id,))
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Testimonio no encontrado")

    await conn.commit()
    return {"ok": True}
