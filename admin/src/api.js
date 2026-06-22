/**
 * api.js — Wrapper centralizado para todas las llamadas al backend.
 *
 * urlFoto(ruta) — Convierte la ruta guardada en la DB a una URL visualizable.
 *
 *   Problema: el backend almacena rutas RELATIVAS a la carpeta uploads/,
 *   por ejemplo "productos/abc123.webp" o "notas/def456.webp".
 *   Esas rutas no son URLs válidas en el navegador — falta el prefijo
 *   que indica dónde buscarlas.
 *
 *   Solución: anteponer "/uploads/" para construir la URL completa:
 *     "productos/abc123.webp"  →  "/uploads/productos/abc123.webp"
 *
 *   En desarrollo, Vite intercepta "/uploads/*" y lo redirige a
 *   http://localhost:8000/uploads/*, donde FastAPI sirve los archivos
 *   con StaticFiles. En producción, nginx los sirve directamente.
 *
 *   Centralizar esto aquí evita que cada componente tenga que recordar
 *   el prefijo. Si en algún momento cambia la ruta de montaje, se
 *   cambia solo aquí.
 *
 * Por qué existe este archivo en lugar de usar fetch() directamente:
 *  1. credentials: "include" debe ir en CADA petición para que el
 *     navegador envíe la cookie de sesión. Si lo olvidamos en una
 *     sola llamada, esa ruta falla con 401 sin mensaje claro.
 *  2. El header X-Admin-Request es nuestra protección CSRF adicional.
 *     Los navegadores no permiten que JavaScript de otros dominios
 *     ponga headers personalizados en peticiones credenciadas, así que
 *     solo nuestro frontend puede enviarlo.
 *  3. La URL base del API está en un solo lugar. Si cambia el puerto
 *     o el prefijo, se arregla aquí y punto.
 */

// En desarrollo, Vite intercepta '/api/...' y lo redirige a
// http://localhost:8000/... (ver vite.config.js).
// En producción, nginx hará lo mismo con proxy_pass.
const BASE_URL = '/api'

// Métodos que modifican datos → necesitan el header CSRF
const METODOS_ESCRITURA = new Set(['POST', 'PUT', 'DELETE', 'PATCH'])

/**
 * Llama a un endpoint del backend.
 * @param {string} path  - Ruta sin el prefijo base, ej. '/login', '/productos'
 * @param {RequestInit} options - Opciones de fetch (method, body, etc.)
 * @returns {Promise<Response>} - La respuesta cruda de fetch
 *
 * Manejo de errores: esta función devuelve el Response sin lanzar
 * excepciones. El código que la llama decide qué hacer con res.ok.
 */
/**
 * Convierte una ruta de upload almacenada en la DB a una URL visualizable.
 * @param {string|null} ruta  — ej. "productos/abc.webp" o "notas/def.webp"
 * @returns {string|null}     — ej. "/uploads/productos/abc.webp", o null
 */
export function urlFoto(ruta) {
  if (!ruta || !ruta.includes('/')) return null
  return `/uploads/${ruta}`
}

export async function apiFetch(path, options = {}) {
  const method = (options.method ?? 'GET').toUpperCase()

  // Si el body es un FormData (subida de archivo), el browser necesita poner
  // él mismo el Content-Type: multipart/form-data con el boundary correcto.
  // Si nosotros lo ponemos, el boundary no está → el servidor no puede parsear.
  const esFormData = options.body instanceof FormData

  const headers = {
    ...(esFormData ? {} : { 'Content-Type': 'application/json' }),
    ...options.headers,
  }

  if (METODOS_ESCRITURA.has(method)) {
    headers['X-Admin-Request'] = '1'
  }

  return fetch(`${BASE_URL}${path}`, {
    ...options,
    method,
    headers,
    credentials: 'include', // siempre enviar la cookie de sesión
  })
}
