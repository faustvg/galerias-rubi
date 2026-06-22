"""
api/routers/usuarios.py — Gestión de cuentas y roles del panel admin.
Acceso: exclusivamente rol 'superadmin'.

─────────────────────────────────────────────────────────────────────────────
CÓMO GARANTIZAMOS QUE SOLO EL SUPERADMIN ACCEDE

  Cada endpoint declara `requiere_roles("superadmin")` como dependencia de
  FastAPI. Esa función (api/auth.py):
    1. Lee la cookie de sesión y consulta la DB para obtener el usuario real.
    2. Verifica que usuario.rol == "superadmin".
    3. Si no, lanza 403 antes de ejecutar una sola línea del handler.
  No existe ningún endpoint de usuarios sin esa dependencia. No hay
  excepción para 'admin', 'viewer', ni nadie más.

CÓMO MANEJAMOS LAS CONTRASEÑAS

  El cliente envía la contraseña en texto plano (solo sobre HTTPS en prod).
  El endpoint llama a pwd_context.hash(password), que aplica bcrypt con una
  sal aleatoria única generada en el momento y devuelve un hash de ~60 chars.
  Solo ese hash se escribe en la columna password_hash.
  La columna password_hash NUNCA aparece en ningún SELECT de este archivo.
  Si ves 'password_hash' aquí, es únicamente en la cláusula INSERT/UPDATE.

GUARDAS ANTI-BLOQUEO

  Si el único superadmin pierde acceso, nadie puede gestionar usuarios sin
  tocar la base de datos directamente. Para evitar ese escenario existen
  dos guardas independientes, ejecutadas antes de cada cambio de rol/activo:

  Guarda 1 — AUTOPROTECCIÓN (absoluta)
    El superadmin logueado no puede cambiar su propio rol ni desactivar su
    propia cuenta, sin importar cuántos otros superadmins existan.
    Previene el error accidental de degradarse a uno mismo.

  Guarda 2 — ÚLTIMO SUPERADMIN (general)
    Antes de degradar o desactivar a cualquier superadmin activo, contamos
    cuántos superadmins activos quedan excluyendo al objetivo:
      SELECT COUNT(*) WHERE rol='superadmin' AND activo=true AND id != objetivo
    Si el resultado es 0, rechazamos la operación con 422.
    Así siempre queda al menos un superadmin activo en el sistema.

  Las dos guardas son mutuamente complementarias:
    Guarda 1 cubre: "no me degrado a mí mismo"
    Guarda 2 cubre: "no dejo al único otro superadmin sin acceso"
─────────────────────────────────────────────────────────────────────────────
"""

from datetime import datetime
from typing import Literal, Optional

import psycopg.errors
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.auth import pwd_context, requiere_roles, UsuarioActual
from api.database import get_db

router = APIRouter()

RolValido = Literal["superadmin", "admin", "viewer", "worker"]
ROLES_ESCRITURA = ("superadmin", "admin", "worker")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class UsuarioCreate(BaseModel):
    username: str        = Field(..., min_length=3, max_length=50)
    nombre:   str        = Field(..., min_length=1, max_length=100)
    rol:      RolValido
    # 'password' solo existe en la entrada — nunca en la salida.
    # Pydantic valida el mínimo; el resto lo hace bcrypt.
    password: str        = Field(..., min_length=8)


class UsuarioUpdate(BaseModel):
    """Todos los campos son opcionales: PUT parcial."""
    username: Optional[str]       = Field(None, min_length=3, max_length=50)
    nombre:   Optional[str]       = Field(None, min_length=1, max_length=100)
    rol:      Optional[RolValido] = None
    activo:   Optional[bool]      = None


class ResetPassword(BaseModel):
    nueva_password: str = Field(..., min_length=8)


class UsuarioOut(BaseModel):
    """Lo que devuelven los endpoints. password_hash está ausente a propósito."""
    id:        int
    username:  str
    nombre:    str
    rol:       str
    activo:    bool
    creado_en: datetime


class VendedorOut(BaseModel):
    """Vista mínima para el menú de vendedores en el formulario de notas."""
    id:     int
    nombre: str


# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------

def _fila_a_usuario(r) -> dict:
    """Convierte una fila SQL en dict listo para UsuarioOut."""
    return {
        "id":        r[0],
        "username":  r[1],
        "nombre":    r[2],
        "rol":       r[3],
        "activo":    r[4],
        "creado_en": r[5],
    }


async def _aplicar_guardas(
    conn,
    *,
    id_objetivo: int,
    id_superadmin_activo: int,
    rol_actual: str,
    activo_actual: bool,
    cambio_rol:    Optional[str],
    cambio_activo: Optional[bool],
) -> None:
    """
    Ejecuta las dos guardas anti-bloqueo y lanza 422 si alguna no se cumple.
    Se llama desde editar_usuario, que ya leyó el estado actual del objetivo.

    Separar la lógica en esta función la hace fácil de leer y de probar.
    """

    # ── Guarda 1: autoprotección ─────────────────────────────────────────────
    if id_objetivo == id_superadmin_activo:
        if cambio_rol is not None:
            raise HTTPException(
                status_code=422,
                detail="No puedes cambiar tu propio rol. "
                       "Pide a otro superadmin que lo haga.",
            )
        if cambio_activo is False:
            raise HTTPException(
                status_code=422,
                detail="No puedes desactivar tu propia cuenta.",
            )

    # ── Guarda 2: último superadmin activo ───────────────────────────────────
    # Solo es relevante cuando el objetivo ES superadmin activo ahora mismo
    # Y la operación lo sacaría de ese estado.
    if rol_actual == "superadmin" and activo_actual:
        quita_superadmin = (
            (cambio_rol is not None and cambio_rol != "superadmin")
            or cambio_activo is False
        )
        if quita_superadmin:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT COUNT(*) FROM usuarios
                    WHERE  rol = 'superadmin' AND activo = true AND id != %s
                    """,
                    (id_objetivo,),
                )
                otros = (await cur.fetchone())[0]

            if otros == 0:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "Esta operación dejaría el sistema sin ningún superadmin activo. "
                        "Promueve a otro usuario a superadmin antes de hacer este cambio."
                    ),
                )


# ---------------------------------------------------------------------------
# ENDPOINT 0 — Vendedores activos (para el menú del formulario de notas)
# ---------------------------------------------------------------------------
# Accesible a todos los que pueden escribir notas (superadmin, admin, worker).
# Solo devuelve id y nombre — ningún dato sensible — para llenar un <select>.

@router.get("/usuarios/vendedores", response_model=list[VendedorOut])
async def listar_vendedores(
    _usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT id, nombre FROM usuarios "
            "WHERE activo = true "
            "ORDER BY nombre"
        )
        rows = await cur.fetchall()
    return [{"id": r[0], "nombre": r[1]} for r in rows]


# ---------------------------------------------------------------------------
# ENDPOINT 1 — Listar todos los usuarios
# ---------------------------------------------------------------------------

@router.get("/usuarios", response_model=list[UsuarioOut])
async def listar_usuarios(
    _usuario: UsuarioActual = requiere_roles("superadmin"),
    conn=Depends(get_db),
):
    async with conn.cursor() as cur:
        await cur.execute(
            # password_hash deliberadamente omitido del SELECT
            """
            SELECT id, username, nombre, rol, activo, creado_en
            FROM   usuarios
            ORDER  BY creado_en, id
            """
        )
        rows = await cur.fetchall()
    return [_fila_a_usuario(r) for r in rows]


# ---------------------------------------------------------------------------
# ENDPOINT 2 — Crear usuario
# ---------------------------------------------------------------------------

@router.post("/usuarios", response_model=UsuarioOut, status_code=201)
async def crear_usuario(
    data: UsuarioCreate,
    _usuario: UsuarioActual = requiere_roles("superadmin"),
    conn=Depends(get_db),
):
    # bcrypt genera una sal distinta en cada llamada: dos hashes del mismo
    # texto plano son siempre diferentes pero ambos verificables con verify().
    password_hash = pwd_context.hash(data.password)

    try:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO usuarios (username, nombre, rol, password_hash)
                VALUES (%s, %s, %s, %s)
                RETURNING id, username, nombre, rol, activo, creado_en
                """,
                (data.username, data.nombre, data.rol, password_hash),
            )
            row = await cur.fetchone()
        await conn.commit()

    except psycopg.errors.UniqueViolation:
        await conn.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"El username '{data.username}' ya está en uso.",
        )

    return _fila_a_usuario(row)


# ---------------------------------------------------------------------------
# ENDPOINT 3 — Editar usuario (nombre, rol, activo)
# ---------------------------------------------------------------------------

@router.put("/usuarios/{id_objetivo}", response_model=UsuarioOut)
async def editar_usuario(
    id_objetivo: int,
    data: UsuarioUpdate,
    usuario: UsuarioActual = requiere_roles("superadmin"),
    conn=Depends(get_db),
):
    # ── Leer estado actual del objetivo ──────────────────────────────────────
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT rol, activo FROM usuarios WHERE id = %s",
            (id_objetivo,),
        )
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    rol_actual, activo_actual = row[0], row[1]

    # model_dump(exclude_unset=True): solo los campos que llegaron en el request.
    cambios = data.model_dump(exclude_unset=True)

    if not cambios:
        # Nada que cambiar: devolver el usuario tal como está sin tocar la DB.
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, username, nombre, rol, activo, creado_en "
                "FROM usuarios WHERE id = %s",
                (id_objetivo,),
            )
            return _fila_a_usuario(await cur.fetchone())

    # ── Aplicar guardas anti-bloqueo ─────────────────────────────────────────
    await _aplicar_guardas(
        conn,
        id_objetivo=id_objetivo,
        id_superadmin_activo=usuario.id,
        rol_actual=rol_actual,
        activo_actual=activo_actual,
        cambio_rol=cambios.get("rol"),
        cambio_activo=cambios.get("activo"),
    )

    # ── UPDATE dinámico — solo los campos enviados ────────────────────────────
    # Los nombres de columna vienen del modelo Pydantic (controlados por
    # nosotros, no por el cliente), así que el f-string no es inyección SQL.
    # Los valores siempre van como parámetros %s.
    columnas = [f"{k} = %s" for k in cambios]
    valores  = list(cambios.values()) + [id_objetivo]

    try:
        async with conn.cursor() as cur:
            await cur.execute(
                f"UPDATE usuarios SET {', '.join(columnas)} WHERE id = %s "
                "RETURNING id, username, nombre, rol, activo, creado_en",
                valores,
            )
            row_actualizado = await cur.fetchone()
        await conn.commit()
    except psycopg.errors.UniqueViolation:
        await conn.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"El username '{cambios['username']}' ya está en uso.",
        )

    return _fila_a_usuario(row_actualizado)


# ---------------------------------------------------------------------------
# ENDPOINT 4 — Resetear contraseña de un usuario
# ---------------------------------------------------------------------------

@router.post("/usuarios/{id_objetivo}/password")
async def resetear_password(
    id_objetivo: int,
    data: ResetPassword,
    _usuario: UsuarioActual = requiere_roles("superadmin"),
    conn=Depends(get_db),
):
    # Verificar que el objetivo existe antes de intentar el UPDATE.
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT id FROM usuarios WHERE id = %s", (id_objetivo,)
        )
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    nuevo_hash = pwd_context.hash(data.nueva_password)

    async with conn.cursor() as cur:
        await cur.execute(
            "UPDATE usuarios SET password_hash = %s WHERE id = %s",
            (nuevo_hash, id_objetivo),
        )
    await conn.commit()

    # No se devuelve el hash ni ningún dato sensible.
    return {"ok": True}
