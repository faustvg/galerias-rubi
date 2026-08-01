"""
api/routers/publico.py — Endpoints públicos para el sitio web de clientes.

SIN AUTENTICACIÓN: cualquier visitante del sitio puede llamar estos endpoints.
SOLO LECTURA: únicamente GET. Ningún endpoint aquí modifica datos.

─────────────────────────────────────────────────────────────────────────────
CAMPOS EXPUESTOS vs. CAMPOS INTERNOS

  ✅ EXPUESTOS (seguros para clientes):
       id, nombre, fotos, categoria (nombre), categoria_id,
       color, material, descripcion, precio_efectivo,
       precio_base, descuento_pct (efectivo),
       disponible_cdmx, precio_cdmx (None si esa sucursal oculta precio)

  descuento_pct expuesto es el EFECTIVO (COALESCE producto → categoría → 0),
  junto con precio_base: el sitio los usa para mostrar la etiqueta de oferta
  y el precio original tachado. Un descuento es información de marketing —
  el cliente debe verlo. El margen (costo) sigue siendo privado.

  ❌ NUNCA EXPUESTOS (internos del negocio):
       costo          — margen de ganancia, información comercial privada
       existencias    — stock interno, no relevante para el cliente
       proveedor      — relación comercial interna
       ubicaciones    — logística interna del taller
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
    precio_base:      float   # precio de lista — el sitio lo muestra tachado si hay oferta
    descuento_pct:    float   # % efectivo (producto → categoría → 0); 0 = sin descuento
    # disponible_cdmx / precio_cdmx (migración 011): intencionalmente
    # específicos a "CDMX", no un array genérico de sucursales — con solo
    # 2 ubicaciones no vale la pena esa abstracción todavía. Si se agrega
    # una tercera sucursal, este endpoint necesita refactorizarse a una
    # lista genérica de disponibilidad/precio por sucursal.
    disponible_cdmx:  bool             # true si el producto también se vende en CDMX (y esa sucursal está activa)
    precio_cdmx:      Optional[float]  # precio en CDMX si esa sucursal muestra precio; None = mostrar CTA de WhatsApp en su lugar


class CategoriaPublica(BaseModel):
    """Vista pública de categoría — solo id y nombre, sin descuento_pct."""
    id:     int
    nombre: str


class SucursalPublica(BaseModel):
    """Vista pública de sucursal — sin ocultar_precio_publico (el frontend
    no necesita el flag crudo, solo el resultado ya calculado en
    ProductoPublico.precio_cdmx).
    es_principal se expone para que el JS del sitio identifique cuál
    sucursal alimenta los CTAs genéricos (burbuja de WhatsApp, footer)
    SIN comparar contra el texto de 'nombre' — ese es editable desde el
    panel y no debe usarse como llave de negocio (ver comentario en
    schema.sql / migración 011)."""
    id:           int
    nombre:       str
    direccion:    Optional[str]
    maps_url:     Optional[str]
    whatsapp:     Optional[str]
    es_principal: bool


class TestimonioPublico(BaseModel):
    """Vista pública de testimonio — sin activo/orden/creado_en, son
    detalles de curación interna que el sitio no necesita."""
    id:     int
    texto:  str
    autor:  str
    ciudad: Optional[str]


# ---------------------------------------------------------------------------
# SQL base — reutilizado por lista y detalle
# ---------------------------------------------------------------------------
# El SELECT solo nombra los campos seguros. Los campos internos (costo,
# existencias, proveedor, ubicaciones) no aparecen en ningún lugar de este SQL.
#
# Índices del resultado:
#   r[0] id, r[1] nombre, r[2] fotos, r[3] categoria_id,
#   r[4] categoria, r[5] color, r[6] material, r[7] descripcion,
#   r[8] precio_efectivo, r[9] destacados, r[10] precio_base,
#   r[11] descuento_pct (efectivo), r[12] disponible_cdmx, r[13] precio_cdmx

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
        p.destacados,
        p.precio_base,
        COALESCE(p.descuento_pct, c.descuento_pct, 0) AS descuento_pct,
        (s_cdmx.id IS NOT NULL)                                        AS disponible_cdmx,
        CASE WHEN s_cdmx.id IS NOT NULL AND NOT s_cdmx.ocultar_precio_publico
             THEN ps_cdmx.precio END                                   AS precio_cdmx
    FROM  productos   p
    LEFT  JOIN categorias c ON c.id = p.categoria_id
    LEFT  JOIN producto_sucursal ps_cdmx ON ps_cdmx.producto_id = p.id
    LEFT  JOIN sucursales s_cdmx
           -- "la otra sucursal" = la NO principal. NUNCA comparar contra
           -- nombre (editable desde el panel, ver Sucursales.jsx) — usar
           -- siempre es_principal, la única llave estable. activo=true
           -- además evita que CDMX aparezca disponible en el sitio antes
           -- de que la familia la active, aunque ya se haya preparado su
           -- catálogo desde el admin (ver GET /admin/productos en
           -- catalogo.py, que sí puede mostrarlo sin este filtro).
           -- ⚠️ Asume exactamente 2 sucursales — ver nota en migración 011.
           ON  s_cdmx.id = ps_cdmx.sucursal_id
           AND s_cdmx.es_principal = false
           AND s_cdmx.activo = true
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
        "precio_base":     float(r[10] or 0),
        "descuento_pct":   float(r[11] or 0),
        "disponible_cdmx": r[12],
        "precio_cdmx":     float(r[13]) if r[13] is not None else None,
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


# ---------------------------------------------------------------------------
# GET /publico/sucursales
# ---------------------------------------------------------------------------

@router.get("/sucursales", response_model=list[SucursalPublica])
async def sucursales_publicas(conn=Depends(get_db)):
    """
    Sucursales activas para la sección de contacto y el WhatsApp dinámico
    del sitio. Filtra activo=true — así CDMX no aparece hasta que la
    familia complete sus datos reales desde el panel y la active.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT id, nombre, direccion, maps_url, whatsapp, es_principal
            FROM   sucursales
            WHERE  activo = true
            ORDER BY id
            """
        )
        rows = await cur.fetchall()
    return [
        {
            "id": r[0], "nombre": r[1], "direccion": r[2],
            "maps_url": r[3], "whatsapp": r[4], "es_principal": r[5],
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# GET /publico/testimonios
# ---------------------------------------------------------------------------

@router.get("/testimonios", response_model=list[TestimonioPublico])
async def testimonios_publicos(conn=Depends(get_db)):
    """
    Testimonios activos para el carrusel del sitio, en el orden que
    decidió la familia desde el panel. Filtra activo=true — mismo
    criterio que destacados/visible_en_sitio en el resto del sitio.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT id, texto, autor, ciudad
            FROM   testimonios
            WHERE  activo = true
            ORDER BY orden, id
            """
        )
        rows = await cur.fetchall()
    return [
        {"id": r[0], "texto": r[1], "autor": r[2], "ciudad": r[3]}
        for r in rows
    ]
