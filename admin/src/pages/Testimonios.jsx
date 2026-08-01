/**
 * Testimonios.jsx — CRUD de testimonios curados para el carrusel del sitio
 * público, mismo patrón que Categorias.jsx (modal único crear/editar) más
 * borrar (a diferencia de categorías, un testimonio sí se puede eliminar
 * de verdad — no tiene historial transaccional que preservar).
 *
 * activo funciona igual que productos.destacados: la familia decide qué
 * se publica sin tocar código. orden controla la posición en el carrusel.
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../api'
import Layout from '../components/Layout'
import ConfirmDialog from '../components/ConfirmDialog'

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

export default function Testimonios() {
  const [testimonios, setTestimonios] = useState([])
  const [cargando, setCargando]       = useState(true)
  const [error, setError]             = useState(null)
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editando, setEditando]       = useState(null) // null=crear, obj=editar

  const [borrando, setBorrando]       = useState(null) // testimonio o null
  const [eliminando, setEliminando]   = useState(false)
  const [errorBorrar, setErrorBorrar] = useState(null)

  const { usuario, logout } = useAuth()
  const navigate = useNavigate()
  const puedeEscribir = ['superadmin', 'admin'].includes(usuario?.rol)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const res = await apiFetch('/testimonios')
      if (res.status === 401) { await logout(); navigate('/login'); return }
      if (!res.ok) throw new Error('No se pudo cargar los testimonios.')
      setTestimonios(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }, [logout, navigate])

  useEffect(() => { cargar() }, [cargar])

  function abrirNuevo()   { setEditando(null); setModalAbierto(true) }
  function abrirEditar(t) { setEditando(t);    setModalAbierto(true) }
  function cerrar()       { setModalAbierto(false); setEditando(null) }

  async function handleGuardado() { cerrar(); await cargar() }

  async function handleEliminar() {
    if (!borrando) return
    setEliminando(true)
    setErrorBorrar(null)
    try {
      const res = await apiFetch(`/testimonios/${borrando.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await leerError(res))
      setBorrando(null)
      await cargar()
    } catch (err) {
      setErrorBorrar(err.message)
      setBorrando(null)
    } finally {
      setEliminando(false)
    }
  }

  return (
    <Layout>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Testimonios</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {testimonios.length} testimonio{testimonios.length !== 1 ? 's' : ''} — controla qué se ve en el sitio público
          </p>
        </div>
        {puedeEscribir && (
          <button
            onClick={abrirNuevo}
            className="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium
                       px-4 py-2.5 rounded-xl transition-colors shrink-0"
          >
            + Nuevo testimonio
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200
                        rounded-xl px-4 py-3">
          {error}
        </div>
      )}
      {errorBorrar && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200
                        rounded-xl px-4 py-3">
          {errorBorrar}
        </div>
      )}

      {cargando && (
        <p className="text-center text-gray-400 py-16 text-sm">Cargando testimonios…</p>
      )}

      {!cargando && !error && testimonios.length === 0 && (
        <div className="text-center py-16">
          <p className="text-gray-400 mb-4">No hay testimonios todavía.</p>
          {puedeEscribir && (
            <button
              onClick={abrirNuevo}
              className="bg-amber-600 hover:bg-amber-700 text-white text-sm
                         font-medium px-5 py-2.5 rounded-xl"
            >
              Crear el primer testimonio
            </button>
          )}
        </div>
      )}

      {!cargando && testimonios.length > 0 && (
        <div className="space-y-2">
          {testimonios.map((t) => (
            <div
              key={t.id}
              className="bg-white rounded-2xl border border-gray-200
                         hover:border-amber-200 transition-colors p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {t.activo
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700">Visible en el sitio</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Oculto</span>
                    }
                    <span className="text-xs text-gray-400">Orden: {t.orden}</span>
                  </div>
                  <p className="text-sm text-gray-700 italic leading-relaxed line-clamp-3">
                    "{t.texto}"
                  </p>
                  <p className="text-xs text-gray-400 mt-1.5">
                    — {t.autor}{t.ciudad ? `, ${t.ciudad}` : ''}
                  </p>
                </div>
                {puedeEscribir && (
                  <div className="flex flex-col gap-2 shrink-0">
                    <button
                      onClick={() => abrirEditar(t)}
                      className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg
                                 text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => setBorrando(t)}
                      className="text-sm px-3 py-1.5 border border-red-200 rounded-lg
                                 text-red-600 hover:bg-red-50 transition-colors"
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modalAbierto && (
        <TestimonioModal
          testimonio={editando}
          onGuardado={handleGuardado}
          onCerrar={cerrar}
        />
      )}

      {borrando && (
        <ConfirmDialog
          titulo="¿Borrar este testimonio?"
          mensaje={`Se eliminará el testimonio de ${borrando.autor} — esta acción no se puede deshacer.`}
          textoConfirmar={eliminando ? 'Borrando…' : 'Borrar'}
          onConfirmar={handleEliminar}
          onCancelar={() => setBorrando(null)}
        />
      )}
    </Layout>
  )
}


function TestimonioModal({ testimonio, onGuardado, onCerrar }) {
  const modoEditar = Boolean(testimonio)

  const [form, setForm] = useState({
    texto:  testimonio?.texto  ?? '',
    autor:  testimonio?.autor  ?? '',
    ciudad: testimonio?.ciudad ?? '',
    activo: testimonio?.activo ?? true,
    orden:  testimonio?.orden  ?? 0,
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
    if (!form.texto.trim() || !form.autor.trim()) {
      setError('El texto y el autor son obligatorios.')
      return
    }
    const orden = parseInt(form.orden, 10)
    if (isNaN(orden)) {
      setError('El orden debe ser un número entero.')
      return
    }

    setGuardando(true)
    setError(null)
    try {
      const url    = modoEditar ? `/testimonios/${testimonio.id}` : '/testimonios'
      const method = modoEditar ? 'PUT' : 'POST'
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify({
          texto: form.texto.trim(),
          autor: form.autor.trim(),
          ciudad: form.ciudad.trim() || null,
          activo: form.activo,
          orden,
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
          {modoEditar ? `Editar testimonio de ${testimonio.autor}` : 'Nuevo testimonio'}
        </h2>

        {error && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200
                          rounded-xl px-3 py-2.5">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Texto del testimonio</span>
            <textarea
              required
              value={form.texto}
              onChange={cambiar('texto')}
              rows={4}
              className="mt-1.5 w-full border border-gray-300 rounded-xl px-3 py-2.5
                         text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
              placeholder="Lo que dijo el cliente…"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Autor</span>
            <input
              required
              value={form.autor}
              onChange={cambiar('autor')}
              className="mt-1.5 w-full border border-gray-300 rounded-xl px-3 py-2.5
                         text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="Ej. Familia Hernández"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Ciudad (opcional)</span>
            <input
              value={form.ciudad}
              onChange={cambiar('ciudad')}
              className="mt-1.5 w-full border border-gray-300 rounded-xl px-3 py-2.5
                         text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="Ej. Ciudad de México"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Orden</span>
            <span className="block text-xs text-gray-400 mb-1.5">
              Controla el orden en el carrusel del sitio — menor número aparece primero
            </span>
            <input
              type="number"
              step="1"
              value={form.orden}
              onChange={cambiar('orden')}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5
                         text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
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
                Visible en el sitio público
              </span>
              <p className="text-xs text-gray-400">
                Si lo desactivas, este testimonio no aparece en el carrusel.
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
              {guardando ? 'Guardando…' : modoEditar ? 'Guardar cambios' : 'Crear testimonio'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
