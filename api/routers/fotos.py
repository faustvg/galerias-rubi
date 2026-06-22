"""
api/routers/fotos.py — Subida y gestión de fotos de productos.

Cadena de seguridad:
  1. Auth: sesión válida con rol de escritura (superadmin / admin / worker).
  2. Tamaño: rechaza archivos > MAX_FILE_SIZE antes de procesarlos.
  3. Validación: Pillow intenta abrir la imagen. Si falla, el archivo NO
     es una imagen válida, sin importar la extensión que declare el cliente.
  4. Formato: lista blanca de formatos que DETECTA Pillow (no lo que diga
     el Content-Type del request).
  5. Re-codificación: decodificamos hasta los píxeles y re-codificamos como
     WebP desde cero. Esto destruye cualquier payload oculto en metadatos,
     streams secundarios o comentarios EXIF del archivo original.
  6. Nombre seguro: UUID hex generado por el servidor. El nombre original
     del archivo NUNCA se usa ni se almacena.
  7. Anti path-traversal: el endpoint de borrado valida con regex estricta
     que el nombre sea exactamente {32 hex}.webp — ningún otro patrón pasa.
"""

import re
import uuid
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from PIL import Image, ImageOps

from api.auth import requiere_roles, UsuarioActual
from api.database import get_db

router = APIRouter()

ROLES_ESCRITURA = ("superadmin", "admin", "worker")

# Ruta en disco relativa al directorio de trabajo de uvicorn (raíz del proyecto).
UPLOADS_DIR       = Path("uploads/productos")
UPLOADS_NOTAS_DIR = Path("uploads/notas")

MAX_FILE_SIZE = 15 * 1024 * 1024  # 15 MB
MAX_FOTOS     = 5
FORMATOS_OK   = {"JPEG", "PNG", "WEBP"}
ANCHO_MAX     = 1200   # px — nunca se agranda una imagen ya más pequeña
CALIDAD_WEBP  = 80

# Acepta únicamente {32 hex}.webp — imposible incluir /, .., espacios, etc.
_NOMBRE_VALIDO = re.compile(r"^[0-9a-f]{32}\.webp$")


# ---------------------------------------------------------------------------
# POST /productos/{id}/fotos — subir una foto nueva
# ---------------------------------------------------------------------------

@router.post("/productos/{producto_id}/fotos")
async def subir_foto(
    producto_id: int,
    archivo: UploadFile = File(...),
    _usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    # ── 1. Verificar que el producto existe ──────────────────────────────────
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT fotos FROM productos WHERE id = %s", (producto_id,)
        )
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado.")

    fotos_actuales: list[str] = row[0] or []

    # ── 2. Límite de fotos por producto ─────────────────────────────────────
    if len(fotos_actuales) >= MAX_FOTOS:
        raise HTTPException(
            status_code=422,
            detail=f"Máximo {MAX_FOTOS} fotos por producto. Quita una para poder subir otra.",
        )

    # ── 3. Leer contenido y validar tamaño ──────────────────────────────────
    contenido = await archivo.read()
    if len(contenido) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"El archivo es demasiado grande. Máximo {MAX_FILE_SIZE // (1024 * 1024)} MB.",
        )

    # ── 4. Validar que sea una imagen real (Pillow como validador) ───────────
    # Si Pillow no puede abrirla, lanza excepción → no es imagen.
    # No confiamos en la extensión ni en el Content-Type del cliente.
    try:
        img = Image.open(BytesIO(contenido))
        formato = img.format  # "JPEG", "PNG", "WEBP" … lo detecta Pillow, no el cliente
    except Exception:
        raise HTTPException(
            status_code=422,
            detail="El archivo no es una imagen válida.",
        )

    if formato not in FORMATOS_OK:
        raise HTTPException(
            status_code=422,
            detail=f"Formato no permitido ({formato or 'desconocido'}). Sube JPG, PNG o WebP.",
        )

    # ── 5. Procesar la imagen ────────────────────────────────────────────────

    # exif_transpose aplica la rotación guardada en el EXIF de la foto.
    # Sin esto, las fotos tomadas en vertical con el celular aparecen giradas 90°.
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass  # EXIF malformado: continuamos sin rotar

    # Convertir a RGB. Los PNGs con transparencia (RGBA) los componemos sobre
    # fondo blanco; la paleta (P, típica en GIFs) también pasa por RGBA.
    if img.mode in ("RGBA", "LA", "P"):
        fondo = Image.new("RGB", img.size, (255, 255, 255))
        rgba  = img.convert("RGBA")
        fondo.paste(rgba, mask=rgba.split()[3])  # canal alpha como máscara de pegado
        img = fondo
    elif img.mode != "RGB":
        img = img.convert("RGB")

    # Redimensionar solo si supera el ancho máximo (nunca agrandar).
    if img.width > ANCHO_MAX:
        nuevo_alto = int(img.height * ANCHO_MAX / img.width)
        img = img.resize((ANCHO_MAX, nuevo_alto), Image.LANCZOS)

    # ── 6. Guardar en disco con nombre seguro ────────────────────────────────
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    nombre     = f"{uuid.uuid4().hex}.webp"   # nombre generado por el servidor
    ruta_disco = UPLOADS_DIR / nombre

    img.save(ruta_disco, format="WEBP", quality=CALIDAD_WEBP, method=6)

    # ── 7. Actualizar el array fotos en la DB ────────────────────────────────
    # Guardamos la ruta relativa a uploads/ para que funcione igual en dev y prod.
    ruta_db      = f"productos/{nombre}"
    nuevas_fotos = fotos_actuales + [ruta_db]

    async with conn.cursor() as cur:
        await cur.execute(
            "UPDATE productos SET fotos = %s WHERE id = %s",
            (nuevas_fotos, producto_id),
        )
    await conn.commit()

    return {"ruta": ruta_db, "fotos": nuevas_fotos}


# ---------------------------------------------------------------------------
# DELETE /productos/{id}/fotos/{nombre_archivo} — quitar una foto
# ---------------------------------------------------------------------------

@router.delete("/productos/{producto_id}/fotos/{nombre_archivo}")
async def quitar_foto(
    producto_id: int,
    nombre_archivo: str,
    _usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    # Validar formato del nombre ANTES de tocar nada — anti path-traversal.
    if not _NOMBRE_VALIDO.match(nombre_archivo):
        raise HTTPException(status_code=422, detail="Nombre de archivo inválido.")

    ruta_db = f"productos/{nombre_archivo}"

    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT fotos FROM productos WHERE id = %s", (producto_id,)
        )
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado.")

    fotos_actuales: list[str] = row[0] or []

    if ruta_db not in fotos_actuales:
        raise HTTPException(status_code=404, detail="Foto no encontrada en este producto.")

    # Actualizar la DB primero: si el borrado de disco falla después,
    # al menos la DB ya no referencia el archivo huérfano.
    nuevas_fotos = [f for f in fotos_actuales if f != ruta_db]

    async with conn.cursor() as cur:
        await cur.execute(
            "UPDATE productos SET fotos = %s WHERE id = %s",
            (nuevas_fotos, producto_id),
        )
    await conn.commit()

    # Borrar del disco (error no fatal: la DB ya está limpia).
    try:
        (UPLOADS_DIR / nombre_archivo).unlink(missing_ok=True)
    except OSError:
        pass

    return {"ok": True, "fotos": nuevas_fotos}


# ===========================================================================
# Foto de la NOTA DE PAPEL — una sola imagen por nota
# ===========================================================================
# Misma cadena de seguridad que las fotos de producto (Pillow, UUID, WebP).
# Diferencias: una sola foto por nota (reemplaza si ya hay), columna TEXT
# (no TEXT[]), aislamiento por rol (worker solo sus propias notas).


async def _verificar_acceso_nota(conn, folio: str, usuario: UsuarioActual) -> str | None:
    """
    Verifica que la nota existe y que el usuario tiene acceso.
    Devuelve el valor actual de foto_nota, o lanza 404.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT usuario_id, foto_nota FROM notas WHERE folio = %s", (folio,)
        )
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Nota no encontrada.")
    nota_usuario_id, foto_actual = row[0], row[1]

    if usuario.rol == "worker" and nota_usuario_id != usuario.id:
        raise HTTPException(status_code=404, detail="Nota no encontrada.")

    return foto_actual


def _procesar_imagen(contenido: bytes) -> bytes:
    """
    Aplica la misma cadena de procesamiento que las fotos de producto:
    valida con Pillow, corrige orientación EXIF, convierte a RGB,
    redimensiona si supera ANCHO_MAX, re-codifica como WebP.
    Devuelve los bytes del WebP resultante.
    """
    try:
        img = Image.open(BytesIO(contenido))
        formato = img.format
    except Exception:
        raise HTTPException(status_code=422, detail="El archivo no es una imagen válida.")

    if formato not in FORMATOS_OK:
        raise HTTPException(
            status_code=422,
            detail=f"Formato no permitido ({formato or 'desconocido'}). Sube JPG, PNG o WebP.",
        )

    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass

    if img.mode in ("RGBA", "LA", "P"):
        fondo = Image.new("RGB", img.size, (255, 255, 255))
        rgba  = img.convert("RGBA")
        fondo.paste(rgba, mask=rgba.split()[3])
        img = fondo
    elif img.mode != "RGB":
        img = img.convert("RGB")

    if img.width > ANCHO_MAX:
        nuevo_alto = int(img.height * ANCHO_MAX / img.width)
        img = img.resize((ANCHO_MAX, nuevo_alto), Image.LANCZOS)

    buf = BytesIO()
    img.save(buf, format="WEBP", quality=CALIDAD_WEBP, method=6)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# POST /notas/{folio}/foto — subir o reemplazar la foto de la nota de papel
# ---------------------------------------------------------------------------

@router.post("/notas/{folio}/foto")
async def subir_foto_nota(
    folio: str,
    archivo: UploadFile = File(...),
    usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    foto_anterior = await _verificar_acceso_nota(conn, folio, usuario)

    contenido = await archivo.read()
    if len(contenido) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"El archivo es demasiado grande. Máximo {MAX_FILE_SIZE // (1024 * 1024)} MB.",
        )

    webp_bytes = _procesar_imagen(contenido)

    UPLOADS_NOTAS_DIR.mkdir(parents=True, exist_ok=True)
    nombre    = f"{uuid.uuid4().hex}.webp"
    ruta_db   = f"notas/{nombre}"
    ruta_disco = UPLOADS_NOTAS_DIR / nombre

    ruta_disco.write_bytes(webp_bytes)

    async with conn.cursor() as cur:
        await cur.execute(
            "UPDATE notas SET foto_nota = %s WHERE folio = %s",
            (ruta_db, folio),
        )
    await conn.commit()

    # Borrar la foto anterior del disco (error no fatal — la DB ya está actualizada).
    if foto_anterior:
        nombre_anterior = foto_anterior.split("/")[-1]
        if _NOMBRE_VALIDO.match(nombre_anterior):
            try:
                (UPLOADS_NOTAS_DIR / nombre_anterior).unlink(missing_ok=True)
            except OSError:
                pass

    return {"foto_nota": ruta_db}


# ---------------------------------------------------------------------------
# DELETE /notas/{folio}/foto — quitar la foto de la nota de papel
# ---------------------------------------------------------------------------

@router.delete("/notas/{folio}/foto")
async def quitar_foto_nota(
    folio: str,
    usuario: UsuarioActual = requiere_roles(*ROLES_ESCRITURA),
    conn=Depends(get_db),
):
    foto_actual = await _verificar_acceso_nota(conn, folio, usuario)

    if not foto_actual:
        raise HTTPException(status_code=404, detail="Esta nota no tiene foto.")

    # Actualizar la DB primero; si el borrado de disco falla, la DB queda limpia.
    async with conn.cursor() as cur:
        await cur.execute(
            "UPDATE notas SET foto_nota = NULL WHERE folio = %s", (folio,)
        )
    await conn.commit()

    nombre = foto_actual.split("/")[-1]
    if _NOMBRE_VALIDO.match(nombre):
        try:
            (UPLOADS_NOTAS_DIR / nombre).unlink(missing_ok=True)
        except OSError:
            pass

    return {"ok": True, "foto_nota": None}
