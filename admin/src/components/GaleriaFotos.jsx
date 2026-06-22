/**
 * GaleriaFotos.jsx — Sección de fotos dentro del modal de editar producto.
 *
 * PATRÓN NUEVO: subida de archivos con FormData
 *   JSON no puede transportar archivos binarios. Para eso usamos
 *   multipart/form-data: el navegador codifica el archivo junto con
 *   otros campos de texto en un mismo cuerpo HTTP.
 *
 *   La trampa: NO debes poner Content-Type: application/json cuando usas
 *   FormData. El navegador necesita poner Content-Type: multipart/form-data
 *   con el boundary correcto (un separador único que él mismo genera).
 *   Si lo sobreescribes, el servidor no puede parsear el cuerpo.
 *   Por eso apiFetch detecta si body es FormData y omite el Content-Type.
 *
 * Flujo de una foto:
 *   Usuario selecciona archivo → subirFoto() → POST /productos/{id}/fotos
 *   → backend valida + procesa con Pillow → guarda en disco → actualiza DB
 *   → devuelve el array fotos actualizado → setFotos(data.fotos)
 *
 * Las fotos se guardan en la DB con CADA upload/borrado, NO al guardar
 * el formulario de texto. Esto simplifica el manejo de estado: el componente
 * siempre refleja lo que hay en la DB.
 *
 * Props:
 *   productoId    — ID del producto
 *   fotosIniciales — array de rutas desde la DB, ej. ["productos/abc.webp"]
 *                    (snapshot del momento en que se abrió el modal)
 */

import { useState, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../api'

const MAX_FOTOS = 5

export default function GaleriaFotos({ productoId, fotosIniciales }) {
  // Estado local: empieza con las fotos actuales del producto.
  // No necesita sincronizarse con useEffect porque el componente se monta
  // fresco cada vez que se abre el modal (está dentro de {modalAbierto && ...}).
  const [fotos, setFotos]       = useState(fotosIniciales ?? [])
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError]       = useState(null)

  // Referencia al <input type="file"> oculto — lo activamos con un botón visible.
  const inputRef = useRef(null)
  const { logout } = useAuth()

  // ── Cuando el usuario selecciona archivos ────────────────────────────────
  async function handleSeleccion(e) {
    const archivos = Array.from(e.target.files)
    // Resetear el input: así el usuario puede seleccionar el mismo archivo
    // de nuevo si quiere (sin el reset, el onChange no dispara en ese caso).
    e.target.value = ''

    // Subir uno por uno para que los errores sean por archivo.
    for (const archivo of archivos) {
      await subirFoto(archivo)
    }
  }

  // ── Subir una foto al servidor ───────────────────────────────────────────
  async function subirFoto(archivo) {
    setSubiendo(true)
    setError(null)

    // FormData empaqueta el archivo como multipart/form-data.
    // 'archivo' debe coincidir con el nombre del parámetro en el backend:
    //   async def subir_foto(archivo: UploadFile = File(...), ...)
    const formData = new FormData()
    formData.append('archivo', archivo)

    try {
      // apiFetch detecta FormData → no pone Content-Type: application/json
      // (el browser lo pone con el boundary correcto).
      const res = await apiFetch(`/productos/${productoId}/fotos`, {
        method: 'POST',
        body: formData,
      })

      if (res.status === 401) { await logout(); return }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail ?? 'Error al subir la foto.')
        return
      }

      const data = await res.json()
      setFotos(data.fotos) // el servidor devuelve el array completo actualizado
    } catch {
      setError('Error de conexión. Verifica que el servidor esté corriendo.')
    } finally {
      setSubiendo(false)
    }
  }

  // ── Quitar una foto ──────────────────────────────────────────────────────
  async function quitarFoto(ruta) {
    // ruta = "productos/abc123….webp"
    // La URL del endpoint espera solo el nombre: DELETE /productos/{id}/fotos/{nombre}
    const nombreArchivo = ruta.split('/').pop()
    setError(null)

    try {
      const res = await apiFetch(
        `/productos/${productoId}/fotos/${nombreArchivo}`,
        { method: 'DELETE' }
      )

      if (res.status === 401) { await logout(); return }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail ?? 'No se pudo quitar la foto.')
        return
      }

      const data = await res.json()
      setFotos(data.fotos)
    } catch {
      setError('Error de conexión.')
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Encabezado */}
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-gray-700">
          Fotos del producto
          <span className="ml-1 text-gray-400 font-normal">
            ({fotos.length}/{MAX_FOTOS})
          </span>
        </label>

        {/* Botón agregar — solo si hay espacio y ya hay al menos una foto */}
        {fotos.length > 0 && fotos.length < MAX_FOTOS && !subiendo && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-xs text-amber-600 hover:text-amber-700 font-medium"
          >
            + Agregar foto
          </button>
        )}
      </div>

      {/* Input de archivo oculto — el botón lo activa programáticamente */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={handleSeleccion}
      />

      {fotos.length > 0 ? (
        /* Grid de miniaturas */
        <div className="grid grid-cols-3 gap-2">
          {fotos.map((foto, i) => (
            <div key={foto} className="relative aspect-square">
              {/*
               * Las fotos viven en:  uploads/productos/uuid.webp
               * FastAPI (dev) las sirve en:  /uploads/productos/uuid.webp
               * El proxy de Vite redirige /uploads/* → http://localhost:8000/uploads/*
               * En producción, nginx sirve /uploads/ directamente.
               */}
              <img
                src={`/uploads/${foto}`}
                alt={`Foto ${i + 1}`}
                className="w-full h-full object-cover rounded-xl bg-gray-100"
              />

              {/* Botón quitar (×) */}
              <button
                type="button"
                onClick={() => quitarFoto(foto)}
                title="Quitar foto"
                className="absolute top-1 right-1 bg-black/50 hover:bg-red-600
                           text-white rounded-full w-6 h-6 text-sm leading-none
                           flex items-center justify-center transition-colors"
              >
                ×
              </button>

              {/* Badge "Principal" en la primera foto */}
              {i === 0 && (
                <span className="absolute bottom-1 left-1 text-xs
                                 bg-black/50 text-white px-1.5 py-0.5 rounded-full">
                  Principal
                </span>
              )}
            </div>
          ))}

          {/* Celda de progreso mientras se procesa la imagen */}
          {subiendo && (
            <div className="aspect-square bg-amber-50 border-2 border-dashed
                            border-amber-300 rounded-xl flex items-center
                            justify-center text-amber-400 text-xs">
              Procesando…
            </div>
          )}
        </div>
      ) : (
        /* Estado vacío: área clicable para agregar la primera foto */
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={subiendo}
          className="w-full py-8 bg-gray-50 border-2 border-dashed border-gray-300
                     rounded-xl flex flex-col items-center justify-center gap-1
                     text-gray-400 hover:border-amber-400 hover:text-amber-500
                     transition-colors disabled:opacity-40"
        >
          <span className="text-2xl">📷</span>
          <span className="text-xs">
            {subiendo ? 'Procesando…' : 'Toca para agregar la primera foto'}
          </span>
        </button>
      )}

      {/* Error */}
      {error && (
        <p className="mt-2 text-sm text-red-700 bg-red-50 border border-red-200
                      rounded-xl px-3 py-2">
          {error}
        </p>
      )}

      <p className="mt-2 text-xs text-gray-400">
        JPG, PNG o WebP · Máx. 15 MB por foto · La primera foto es la imagen
        principal del catálogo.
      </p>
    </div>
  )
}
