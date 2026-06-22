/**
 * Categorias.jsx — CRUD de categorías de productos.
 *
 * ── PATRÓN: MODAL CON DOS MODOS (crear / editar) ───────────────────────────
 *
 * Un solo componente CategoriaModal se usa para crear Y editar.
 * El estado `categoriaEditando` controla cuál modo está activo:
 *
 *   null  → modal de CREAR (campos vacíos)
 *   {…}   → modal de EDITAR (campos prellenados con la categoría)
 *
 * El boolean `modalAbierto` decide si el modal se renderiza.
 * Se usa un par (modalAbierto, categoriaEditando) en lugar de solo
 * categoriaEditando para que el modal pueda ser null en modo crear,
 * que es más legible que usar un valor centinela diferente a null.
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../api'
import Layout from '../components/Layout'

// Extrae el mensaje de error de una respuesta FastAPI.
// FastAPI usa { detail: string } para HTTPException y
// { detail: [{msg, loc}] } para errores de validación Pydantic.
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

export default function Categorias() {
  const [categorias, setCategorias]           = useState([])
  const [cargando, setCargando]               = useState(true)
  const [error, setError]                     = useState(null)
  const [modalAbierto, setModalAbierto]       = useState(false)
  const [categoriaEditando, setCatEditando]   = useState(null) // null=crear, obj=editar

  const { usuario, logout } = useAuth()
  const navigate = useNavigate()
  const puedeEscribir = ['superadmin', 'admin', 'worker'].includes(usuario?.rol)

  // ── Carga la lista ──────────────────────────────────────────────────────
  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const res = await apiFetch('/categorias')
      if (res.status === 401) { await logout(); navigate('/login'); return }
      if (!res.ok) throw new Error('No se pudo cargar las categorías.')
      setCategorias(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }, [logout, navigate])

  useEffect(() => { cargar() }, [cargar])

  // ── Handlers del modal ──────────────────────────────────────────────────
  function abrirNuevo()  { setCatEditando(null); setModalAbierto(true) }
  function abrirEditar(c) { setCatEditando(c);  setModalAbierto(true) }
  function cerrar()       { setModalAbierto(false); setCatEditando(null) }

  async function handleGuardado() { cerrar(); await cargar() }

  return (
    <Layout>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Categorías</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {categorias.length} categoría{categorias.length !== 1 ? 's' : ''}
          </p>
        </div>
        {puedeEscribir && (
          <button
            onClick={abrirNuevo}
            className="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium
                       px-4 py-2.5 rounded-xl transition-colors shrink-0"
          >
            + Nueva categoría
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200
                        rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {cargando && (
        <p className="text-center text-gray-400 py-16 text-sm">Cargando categorías…</p>
      )}

      {!cargando && !error && categorias.length === 0 && (
        <div className="text-center py-16">
          <p className="text-gray-400 mb-4">No hay categorías todavía.</p>
          {puedeEscribir && (
            <button
              onClick={abrirNuevo}
              className="bg-amber-600 hover:bg-amber-700 text-white text-sm
                         font-medium px-5 py-2.5 rounded-xl"
            >
              Crear la primera categoría
            </button>
          )}
        </div>
      )}

      {!cargando && categorias.length > 0 && (
        <div className="space-y-2">
          {categorias.map((c) => (
            <div
              key={c.id}
              className="bg-white rounded-2xl border border-gray-200
                         hover:border-amber-200 transition-colors p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{c.nombre}</p>
                  <p className="text-sm mt-0.5">
                    {c.descuento_pct > 0
                      ? <span className="text-green-600">↓ {c.descuento_pct}% descuento a toda la categoría</span>
                      : <span className="text-gray-400">Sin descuento de categoría</span>
                    }
                  </p>
                </div>
                {puedeEscribir && (
                  <button
                    onClick={() => abrirEditar(c)}
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

      {modalAbierto && (
        <CategoriaModal
          categoria={categoriaEditando}
          onGuardado={handleGuardado}
          onCerrar={cerrar}
        />
      )}
    </Layout>
  )
}


// ── Modal de crear / editar ──────────────────────────────────────────────────
// Componente separado para mantener el JSX de la página limpio.
// Recibe `categoria`: si es null = modo crear; si es un objeto = modo editar.
function CategoriaModal({ categoria, onGuardado, onCerrar }) {
  const modoEditar = Boolean(categoria)

  const [form, setForm]       = useState({
    nombre:       categoria?.nombre       ?? '',
    descuento_pct: categoria?.descuento_pct ?? 0,
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError]         = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const pct = Number(form.descuento_pct)
    if (isNaN(pct) || pct < 0 || pct > 100) {
      setError('El descuento debe ser un número entre 0 y 100.')
      return
    }

    setGuardando(true)
    setError(null)
    try {
      const url  = modoEditar ? `/categorias/${categoria.id}` : '/categorias'
      const meth = modoEditar ? 'PUT' : 'POST'
      const res  = await apiFetch(url, {
        method: meth,
        body: JSON.stringify({ nombre: form.nombre.trim(), descuento_pct: pct }),
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
                   p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold text-gray-900 text-base mb-4">
          {modoEditar ? `Editar: ${categoria.nombre}` : 'Nueva categoría'}
        </h2>

        {error && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200
                          rounded-xl px-3 py-2.5">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Nombre</span>
            <input
              required
              value={form.nombre}
              onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              className="mt-1.5 w-full border border-gray-300 rounded-xl px-3 py-2.5
                         text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="Ej. Recámaras"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Descuento de categoría (%)
            </span>
            <span className="block text-xs text-gray-400 mb-1.5">
              Se aplica a todos los productos de esta categoría que no tengan descuento propio
            </span>
            <input
              type="number"
              min="0" max="100" step="0.1"
              value={form.descuento_pct}
              onChange={(e) => setForm((f) => ({ ...f, descuento_pct: e.target.value }))}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5
                         text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
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
              {guardando ? 'Guardando…' : modoEditar ? 'Guardar cambios' : 'Crear categoría'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
