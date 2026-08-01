/**
 * Sucursales.jsx — edición de las ubicaciones de venta (San Pedro Tultepec,
 * Ciudad de México).
 *
 * A diferencia de Categorias.jsx/Proveedores.jsx, aquí NO hay crear ni
 * borrar: las dos sucursales son entidades legales fijas, sembradas por la
 * migración 011. Solo se editan sus datos (dirección, WhatsApp, si se
 * oculta el precio al público, si ya está activa en el sitio).
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../api'
import Layout from '../components/Layout'

async function leerError(res) {
  try {
    const data = await res.json()
    if (typeof data.detail === 'string') return data.detail
    if (Array.isArray(data.detail))
      return data.detail.map((e) => e.msg ?? String(e)).join('; ')
    return `Error ${res.status}`
  } catch {
    return `Error ${res.status}`
  }
}

export default function Sucursales() {
  const [sucursales, setSucursales]   = useState([])
  const [cargando, setCargando]       = useState(true)
  const [error, setError]             = useState(null)
  const [editando, setEditando]       = useState(null) // sucursal en edición, o null

  const { usuario, logout } = useAuth()
  const navigate = useNavigate()
  const puedeEscribir = ['superadmin', 'admin'].includes(usuario?.rol)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const res = await apiFetch('/sucursales')
      if (res.status === 401) { await logout(); navigate('/login'); return }
      if (!res.ok) throw new Error('No se pudo cargar las sucursales.')
      setSucursales(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }, [logout, navigate])

  useEffect(() => { cargar() }, [cargar])

  async function handleGuardado() { setEditando(null); await cargar() }

  return (
    <Layout>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Sucursales</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Ubicaciones de venta — sus datos alimentan el sitio público (dirección, WhatsApp)
        </p>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200
                        rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {cargando && (
        <p className="text-center text-gray-400 py-16 text-sm">Cargando sucursales…</p>
      )}

      {!cargando && (
        <div className="space-y-2">
          {sucursales.map((s) => (
            <div
              key={s.id}
              className="bg-white rounded-2xl border border-gray-200
                         hover:border-amber-200 transition-colors p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900">{s.nombre}</p>
                    {s.activo
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700">Activa en el sitio</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Sin publicar</span>
                    }
                    {/* Solo informativo — es_principal no es editable desde
                        aquí, se fija por migración (ver backend). */}
                    {s.es_principal && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">Principal</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">{s.razon_social}</p>
                  <p className="text-sm text-gray-400 mt-1">
                    {s.direccion || 'Sin dirección capturada'}
                  </p>
                  <p className="text-sm text-gray-400">
                    WhatsApp: {s.whatsapp || 'Sin número'}
                  </p>
                  {s.ocultar_precio_publico && (
                    <p className="text-xs text-amber-600 mt-1">
                      El sitio muestra "Consultar por WhatsApp" en vez de precio para esta sucursal
                    </p>
                  )}
                </div>
                {puedeEscribir && (
                  <button
                    onClick={() => setEditando(s)}
                    className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg
                               text-gray-700 hover:bg-gray-50 transition-colors shrink-0"
                  >
                    Editar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editando && (
        <SucursalModal
          sucursal={editando}
          onGuardado={handleGuardado}
          onCerrar={() => setEditando(null)}
        />
      )}
    </Layout>
  )
}


function SucursalModal({ sucursal, onGuardado, onCerrar }) {
  const [form, setForm] = useState({
    nombre:                 sucursal.nombre ?? '',
    razon_social:           sucursal.razon_social ?? '',
    direccion:              sucursal.direccion ?? '',
    maps_url:               sucursal.maps_url ?? '',
    whatsapp:               sucursal.whatsapp ?? '',
    ocultar_precio_publico: sucursal.ocultar_precio_publico ?? false,
    activo:                 sucursal.activo ?? false,
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError]         = useState(null)

  function cambiar(campo) {
    return (e) => {
      const valor = e.target.type === 'checkbox' ? e.target.checked : e.target.value
      setForm((prev) => ({ ...prev, [campo]: valor }))
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setGuardando(true)
    setError(null)
    try {
      const res = await apiFetch(`/sucursales/${sucursal.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          nombre: form.nombre.trim(),
          razon_social: form.razon_social.trim(),
          direccion: form.direccion.trim() || null,
          maps_url: form.maps_url.trim() || null,
          whatsapp: form.whatsapp.trim() || null,
          ocultar_precio_publico: form.ocultar_precio_publico,
          activo: form.activo,
        }),
      })
      if (!res.ok) { setError(await leerError(res)); return }
      await onGuardado()
    } catch {
      setError('Error de conexión. Intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center
                 justify-center z-50 p-4"
      onClick={onCerrar}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm
                   p-6 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold text-gray-900 text-base mb-4">
          Editar: {sucursal.nombre}
        </h2>

        {error && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200
                          rounded-xl px-3 py-2.5">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Nombre comercial</span>
            <input
              required
              value={form.nombre}
              onChange={cambiar('nombre')}
              className="mt-1.5 w-full border border-gray-300 rounded-xl px-3 py-2.5
                         text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Razón social</span>
            <span className="block text-xs text-gray-400 mb-1.5">
              Entidad legal — puede diferir del nombre comercial
            </span>
            <input
              required
              value={form.razon_social}
              onChange={cambiar('razon_social')}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5
                         text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Dirección</span>
            <textarea
              value={form.direccion}
              onChange={cambiar('direccion')}
              rows={2}
              className="mt-1.5 w-full border border-gray-300 rounded-xl px-3 py-2.5
                         text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Link de Google Maps</span>
            <input
              type="url"
              value={form.maps_url}
              onChange={cambiar('maps_url')}
              placeholder="https://maps.google.com/…"
              className="mt-1.5 w-full border border-gray-300 rounded-xl px-3 py-2.5
                         text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">WhatsApp</span>
            <span className="block text-xs text-gray-400 mb-1.5">
              Solo dígitos con código de país, ej. 5217225723939
            </span>
            <input
              value={form.whatsapp}
              onChange={cambiar('whatsapp')}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5
                         text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </label>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.ocultar_precio_publico}
              onChange={cambiar('ocultar_precio_publico')}
              className="w-4 h-4 rounded accent-amber-600 shrink-0"
            />
            <div>
              <span className="text-sm font-medium text-gray-700">
                Ocultar precio en el sitio público
              </span>
              <p className="text-xs text-gray-400">
                Si lo activas, el sitio muestra "Consultar por WhatsApp" en vez del precio
                para todo lo que vende esta sucursal.
              </p>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.activo}
              onChange={cambiar('activo')}
              className="w-4 h-4 rounded accent-amber-600 shrink-0"
            />
            <div>
              <span className="text-sm font-medium text-gray-700">
                Activa en el sitio público
              </span>
              <p className="text-xs text-gray-400">
                Si la desactivas, esta sucursal desaparece de la sección de contacto del sitio.
              </p>
            </div>
          </label>

          <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
            <button
              type="button"
              onClick={onCerrar}
              className="flex-1 py-2.5 border border-gray-300 rounded-xl text-sm
                         font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white
                         rounded-xl text-sm font-medium transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
