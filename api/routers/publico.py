"""
api/routers/publico.py — Endpoints públicos para el sitio web de clientes.

SIN AUTENTICACIÓN: cualquier visitante del sitio puede llamar estos endpoints.
SOLO LECTURA: únicamente GET. Ningún endpoint aquí modifica datos.

─────────────────────────────────────────────────────────────────────────────
CAMPOS EXPUESTOS vs. CAMPOS INTERNOS

  ✅ EXPUESTOS (seguros para clientes):
       id, nombre, fotos, categoria (nombre), categoria_id,
       color, material, descripcion, precio_efectivo

  ❌ NUNCA EXPUESTOS (internos del negocio):
       costo          — margen de ganancia, información comercial privada
       existencias    — stock interno, no relevante para el cliente
       proveedor      — relación comercial interna
       ubicaciones    — logística interna del taller
       descuento_pct  — porcentaje bruto; el cliente ve precio_efectivo calculado
       visible_en_sitio — flag interno, no sale al cliente

  El doble escudo:
    1. El SQL NO selecciona esos campos — nunca llegan al handler.
    2. El response_model de Pydantic — aunque llegaran, FastAPI los descartaría.

─────────────────────────────────────────────────────────────────────────────
PRECIO EFECTIVO

  Jerarquía de descuentos (COALESCE):
    1. descuento_pct del PRODUCTO (si está definido, tiene prioridad).
    2. descuento_pct de la CATEGORÍA (aplica si el producto no tiene uno propio).
    3. 0  (sin descuento).

  Fórmula:
    precio_efectivo = precio_base × (1 − COALESCE(p.descuento_pct,
                                                   c.descuento_pct, 0) / 100)

─────────────────────────────────────────────────────────────────────────────
CORS EN PRODUCCIÓN

  El middleware de CORS en main.py se aplica globalmente.
  En producción, allow_origins debe incluir AMBOS dominios:
    - El dominio del panel admin   (credenciales necesarias)
    - El dominio del sitio público (sin credenciales, solo GET)
  Ejemplo:
    allow_origins=["https://admin.galerias-rubi.com",
                   "https://galerias-rubi.com"]
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.database import get_db

router = APIRouter(prefix="/publico", tags=["público"])


# ---------------------------------------------------------------------------
# Schemas de SALIDA — solo campos seguros para el cliente
# ---------------------------------------------------------------------------

class ProductoPublico(BaseModel):
    """
    Vista pública de un producto. Ausencia deliberada de campos internos.
    categoria_id se incluye para que el frontend pueda filtrar por categoría
    usando los IDs que devuelve /publico/categorias.
    """
    id:               int
    nombre:           str
    fotos:            list[str]
    categoria_id:     Optional[int]
    categoria:        Optional[str]
    color:            Optional[str]
    material:         Optional[str]
    descripcion:      Optional[str]
    precio_efectivo:  float   # precio_base con descuento aplicado; costo NUNCA sale
    destacados:       bool    # marca manual del panel — filtra "Lo más buscado" en el sitio


class CategoriaPublica(BaseModel):
    """Vista pública de categoría — solo id y nombre, sin descuento_pct."""
    id:     int
    nombre: str


# ---------------------------------------------------------------------------
# SQL base — reutilizado por lista y detalle
# ---------------------------------------------------------------------------
# El SELECT solo nombra los campos seguros. Los campos internos (costo,
# existencias, proveedor, ubicaciones) no aparecen en ningún lugar de este SQL.
#
# Índices del resultado:
#   r[0] id, r[1] nombre, r[2] fotos, r[3] categoria_id,
#   r[4] categoria, r[5] color, r[6] material, r[7] descripcion,
#   r[8] precio_efectivo

_SQL_BASE = """
    SELECT
        p.id,
        p.nombre,
        p.fotos,
        p.categoria_id,
        c.nombre  AS categoria,
        p.color,
        p.material,
        p.descripcion,
        ROUND(
            p.precio_base
            * (1.0 - COALESCE(p.descuento_pct, c.descuento_pct, 0) / 100.0),
            2
        ) AS precio_efectivo,
        p.destacados
    FROM  productos   p
    LEFT  JOIN categorias c ON c.id = p.categoria_id
    WHERE p.visible_en_sitio = true
"""


def _fila_a_producto(r) -> dict:
    return {
        "id":              r[0],
        "nombre":          r[1],
        "fotos":           r[2] or [],
        "categoria_id":    r[3],
        "categoria":       r[4],
        "color":           r[5],
        "material":        r[6],
        "descripcion":     r[7],
        "precio_efectivo": float(r[8] or 0),
        "destacados":      r[9],
    }


# ---------------------------------------------------------------------------
# GET /publico/productos
# ---------------------------------------------------------------------------

@router.get("/productos", response_model=list[ProductoPublico])
async def productos_publicos(conn=Depends(get_db)):
    """
    Lista todos los productos visibles en el sitio.

    - visible_en_sitio = true → incluido, independientemente del stock.
      (Los productos hechos a pedido tienen existencias = 0 y deben aparecer.)
    - No requiere sesión.
    - Nunca expone: costo, existencias, proveedor, ubicaciones.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            _SQL_BASE + " ORDER BY c.nombre NULLS LAST, p.nombre"
        )
        rows = await cur.fetchall()
    return [_fila_a_producto(r) for r in rows]


# ---------------------------------------------------------------------------
# GET /publico/productos/{id}
# ---------------------------------------------------------------------------

@router.get("/productos/{producto_id}", response_model=ProductoPublico)
async def producto_publico(producto_id: int, conn=Depends(get_db)):
    """
    Detalle de un producto para la página individual.

    - Devuelve 404 si el producto no existe O no está visible en el sitio.
      (No revela si el producto existe pero está oculto.)
    - Nunca expone: costo, existencias, proveedor, ubicaciones.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            _SQL_BASE + " AND p.id = %s",
            (producto_id,),
        )
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    return _fila_a_producto(row)


# ---------------------------------------------------------------------------
# GET /publico/categorias
# ---------------------------------------------------------------------------

@router.get("/categorias", response_model=list[CategoriaPublica])
async def categorias_publicas(conn=Depends(get_db)):
    """
    Categorías que tienen al menos un producto visible en el sitio.

    - Las categorías sin productos visibles NO se incluyen (no tendrían
      contenido que mostrar en la pestaña del sitio).
    - Solo devuelve id y nombre — no expone descuento_pct ni ningún campo interno.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT c.id, c.nombre
            FROM   categorias c
            WHERE  EXISTS (
                SELECT 1
                FROM   productos p
                WHERE  p.categoria_id   = c.id
                  AND  p.visible_en_sitio = true
            )
            ORDER BY c.nombre
            """
        )
        rows = await cur.fetchall()
    return [{"id": r[0], "nombre": r[1]} for r in rows]
