from fastapi import Depends, HTTPException, Request
from passlib.context import CryptContext
from pydantic import BaseModel

from api.database import get_db


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class UsuarioActual(BaseModel):
    id: int
    username: str
    nombre: str
    rol: str


async def get_usuario_actual(request: Request, conn=Depends(get_db)) -> UsuarioActual:
    """
    Dependencia que protege rutas: lee la sesión de la cookie, consulta
    la DB y devuelve el usuario activo, o rechaza con 401.
    """
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="No autenticado")

    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT id, username, nombre, rol, activo FROM usuarios WHERE id = %s",
            (user_id,),
        )
        row = await cur.fetchone()

    if row is None or not row[4]:
        request.session.clear()
        raise HTTPException(status_code=401, detail="No autenticado")

    return UsuarioActual(id=row[0], username=row[1], nombre=row[2], rol=row[3])


def requiere_roles(*roles: str):
    """
    Dependency factory para control de acceso por rol.

    Uso:
        usuario = requiere_roles("superadmin", "admin")

    Devuelve Depends() que resuelve al UsuarioActual logueado,
    o lanza 401 si no hay sesión, o 403 si el rol no está permitido.
    """
    async def _check(usuario: UsuarioActual = Depends(get_usuario_actual)) -> UsuarioActual:
        if usuario.rol not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Rol '{usuario.rol}' no tiene permiso para esta acción",
            )
        return usuario
    return Depends(_check)
