from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional
import os

from dotenv import load_dotenv

load_dotenv()  # Debe correr antes de importar api.* que lean env vars en su módulo

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

import api.database as database
from api.auth import get_usuario_actual, pwd_context, UsuarioActual
from api.routers.catalogo   import router as catalogo_router
from api.routers.dashboard  import router as dashboard_router
from api.routers.fotos      import router as fotos_router
from api.routers.notas      import router as notas_router
from api.routers.publico    import router as publico_router
from api.routers.usuarios   import router as usuarios_router

SECRET_KEY = os.getenv("SECRET_KEY", "")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY no está definida en api/.env. "
        "Genera una con: python -c \"import secrets; print(secrets.token_hex(32))\""
    )

# ---------------------------------------------------------------------------
# Lifespan — abre y cierra el pool de conexiones
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    conninfo = (
        f"host={os.getenv('DB_HOST')} "
        f"port={os.getenv('DB_PORT', '5432')} "
        f"dbname={os.getenv('DB_NAME')} "
        f"user={os.getenv('DB_USER')} "
        f"password={os.getenv('DB_PASSWORD')}"
    )
    database.pool = AsyncConnectionPool(conninfo=conninfo, min_size=1, max_size=5)

    # Crear la secuencia de folios digitales si no existe.
    # Se hace aquí (startup) para que esté lista antes del primer request.
    # En bases de datos nuevas también se puede agregar al schema.sql.
    async with database.pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "CREATE SEQUENCE IF NOT EXISTS notas_digital_seq START 1"
            )
        await conn.commit()

    yield
    await database.pool.close()


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Galerías Rubí API", version="1.0.0", lifespan=lifespan)

# Sesiones: cookie firmada con itsdangerous (HMAC-SHA256).
# max_age=28800 = 8 horas. https_only=True en producción (requiere HTTPS).
app.add_middleware(
    SessionMiddleware,
    secret_key=SECRET_KEY,
    session_cookie="grubi_session",
    max_age=28800,
    same_site="lax",
    https_only=False,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # ⚠️ tighten to your domain before public deploy
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

app.include_router(catalogo_router)
app.include_router(dashboard_router)
app.include_router(fotos_router)
app.include_router(notas_router)
app.include_router(publico_router)
app.include_router(usuarios_router)

# Servir las fotos subidas como archivos estáticos.
# TEMPORAL para desarrollo — en producción nginx servirá /uploads/ directamente.
# StaticFiles requiere que el directorio exista al montar, así que lo creamos.
Path("uploads/productos").mkdir(parents=True, exist_ok=True)
Path("uploads/notas").mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


# ---------------------------------------------------------------------------
# Auth schemas
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------

@app.post("/login")
async def login(data: LoginRequest, request: Request, conn=Depends(database.get_db)):
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT id, username, nombre, rol, activo, password_hash "
            "FROM usuarios WHERE username = %s",
            (data.username,),
        )
        row = await cur.fetchone()

    # Si el usuario no existe, igual corremos dummy_verify para que el tiempo
    # de respuesta sea igual que cuando sí existe (anti timing-attack).
    if row is None:
        pwd_context.dummy_verify()
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")

    _id, _username, _nombre, _rol, activo, password_hash = row

    if not pwd_context.verify(data.password, password_hash):
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")

    if not activo:
        raise HTTPException(status_code=403, detail="Usuario inactivo")

    request.session["user_id"] = _id
    return {"ok": True, "username": _username, "nombre": _nombre, "rol": _rol}


@app.post("/logout")
async def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@app.get("/yo", response_model=UsuarioActual)
async def quien_soy(usuario: UsuarioActual = Depends(get_usuario_actual)):
    return usuario


# ---------------------------------------------------------------------------
# Catalog read endpoints (public — used by the static site and admin UI)
# ---------------------------------------------------------------------------

class Categoria(BaseModel):
    id: int
    nombre: str
    descuento_pct: float


class Proveedor(BaseModel):
    id: int
    proveedor: str


class Producto(BaseModel):
    id: int
    nombre: str
    descripcion: Optional[str]
    precio: float
    descuento_pct: Optional[float]
    fotos: list[str]
    color: Optional[str]
    material: Optional[str]
    categoria_id: Optional[int]
    categoria: Optional[str]


@app.get("/categorias", response_model=list[Categoria])
async def listar_categorias(conn=Depends(database.get_db)):
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT id, nombre, descuento_pct FROM categorias ORDER BY nombre"
        )
        rows = await cur.fetchall()
    return [
        {"id": r[0], "nombre": r[1], "descuento_pct": float(r[2] or 0)}
        for r in rows
    ]


@app.get("/proveedores", response_model=list[Proveedor])
async def listar_proveedores(conn=Depends(database.get_db)):
    async with conn.cursor() as cur:
        await cur.execute("SELECT id, proveedor FROM proveedores ORDER BY proveedor")
        rows = await cur.fetchall()
    return [{"id": r[0], "proveedor": r[1]} for r in rows]


@app.get("/productos", response_model=list[Producto])
async def listar_productos(
    categoria_id: Optional[int] = Query(None, description="Filtrar por ID de categoría"),
    conn=Depends(database.get_db),
):
    sql = """
        SELECT
            p.id, p.nombre, p.descripcion, p.precio_base,
            COALESCE(p.descuento_pct, c.descuento_pct) AS descuento_efectivo,
            p.fotos, p.color, p.material, p.categoria_id, c.nombre AS categoria
        FROM productos p
        LEFT JOIN categorias c ON c.id = p.categoria_id
        WHERE p.visible_en_sitio = true
    """
    params: list = []
    if categoria_id is not None:
        sql += " AND p.categoria_id = %s"
        params.append(categoria_id)
    sql += " ORDER BY p.nombre"

    async with conn.cursor() as cur:
        await cur.execute(sql, params)
        rows = await cur.fetchall()

    return [_row_to_producto(r) for r in rows]


@app.get("/productos/{producto_id}", response_model=Producto)
async def obtener_producto(producto_id: int, conn=Depends(database.get_db)):
    sql = """
        SELECT
            p.id, p.nombre, p.descripcion, p.precio_base,
            COALESCE(p.descuento_pct, c.descuento_pct) AS descuento_efectivo,
            p.fotos, p.color, p.material, p.categoria_id, c.nombre AS categoria
        FROM productos p
        LEFT JOIN categorias c ON c.id = p.categoria_id
        WHERE p.id = %s
    """
    async with conn.cursor() as cur:
        await cur.execute(sql, (producto_id,))
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    return _row_to_producto(row)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row_to_producto(r) -> dict:
    return {
        "id": r[0],
        "nombre": r[1],
        "descripcion": r[2],
        "precio": float(r[3] or 0),
        "descuento_pct": float(r[4]) if r[4] is not None else None,
        "fotos": r[5] or [],
        "color": r[6],
        "material": r[7],
        "categoria_id": r[8],
        "categoria": r[9],
    }


# ---------------------------------------------------------------------------
# Sitio público estático (solo desarrollo local)
# Montado AL FINAL para que NUNCA intercepte rutas de API.
# Starlette usa el primer match; si este mount estuviera antes de los
# @app.post decorators, "/" daría match parcial y devolvería 405.
# En producción: el sitio va a GitHub Pages, este mount no aplica.
# ---------------------------------------------------------------------------
_web_dir = Path(__file__).parent.parent / "web-publico"
if _web_dir.is_dir():
    app.mount("/", StaticFiles(directory=_web_dir, html=True), name="sitio-publico")
