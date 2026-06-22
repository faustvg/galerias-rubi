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

export default function Proveedores() {
  const [proveedores, setProveedores]       = useState([])
  const [cargando, setCargando]             = useState(true)
  const [error, setError]                   = useState(null)
  const [modalAbierto, setModalAbierto]     = useState(false)
  const [proveedorEditando, setProvEditando] = useState(null)

  const { usuario, logout } = useAuth()
  const navigate = useNavigate()
  const puedeEscribir = ['superadmin', 'admin', 'worker'].includes(usuario?.rol)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const res = await apiFetch('/proveedores')
      if (res.status === 401) { await logout(); navigate('/login'); return }
      if (!res.ok) throw new Error('No se pudo cargar los proveedores.')
      setProveedores(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }, [logout, navigate])

  useEffect(() => { cargar() }, [cargar])

  function abrirNuevo()   { setProvEditando(null); setModalAbierto(true) }
  function abrirEditar(p) { setProvEditando(p);    setModalAbierto(true) }
  function cerrar()        { setModalAbierto(false); setProvEditando(null) }

  async function handleGuardado() { cerrar(); await cargar() }

  return (
    <Layout>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Proveedores</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {proveedores.length} proveedor{proveedores.length !== 1 ? 'es' : ''}
          </p>
        </div>
        {puedeEscribir && (
          <button
            onClick={abrirNuevo}
            className="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium
                       px-4 py-2.5 rounded-xl transition-colors shrink-0"
          >
            + Nuevo proveedor
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
        <p className="text-center text-gray-400 py-16 text-sm">Cargando proveedores…</p>
      )}

      {!cargando && !error && proveedores.length === 0 && (
        <div className="text-center py-16">
          <p className="text-gray-400 mb-4">No hay proveedores todavía.</p>
          {puedeEscribir && (
            <button
              onClick={abrirNuevo}
              className="bg-amber-600 hover:bg-amber-700 text-white text-sm
                         font-medium px-5 py-2.5 rounded-xl"
            >
              Agregar el primer proveedor
            </button>
          )}
        </div>
      )}

      {!cargando && proveedores.length > 0 && (
        <div className="space-y-2">
          {proveedores.map((p) => (
            <div
              key={p.id}
              className="bg-white rounded-2xl border border-gray-200
                         hover:border-amber-200 transition-colors p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-gray-900">{p.proveedor}</p>
                {puedeEscribir && (
                  <button
                    onClick={() => abrirEditar(p)}
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
        <ProveedorModal
          proveedor={proveedorEditando}
          onGuardado={handleGuardado}
          onCerrar={cerrar}
        />
      )}
    </Layout>
  )
}


function ProveedorModal({ proveedor, onGuardado, onCerrar }) {
  const modoEditar = Boolean(proveedor)
  const [nombre, setNombre]           = useState(proveedor?.proveedor ?? '')
  const [guardando, setGuardando]     = useState(false)
  const [error, setError]             = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = nombre.trim()
    if (!trimmed) { setError('El nombre no puede estar vacío.'); return }

    setGuardando(true)
    setError(null)
    try {
      const url  = modoEditar ? `/proveedores/${proveedor.id}` : '/proveedores'
      const meth = modoEditar ? 'PUT' : 'POST'
      const res  = await apiFetch(url, {
        method: meth,
        body: JSON.stringify({ proveedor: trimmed }),
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
          {modoEditar ? `Editar: ${proveedor.proveedor}` : 'Nuevo proveedor'}
        </h2>

        {error && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200
                          rounded-xl px-3 py-2.5">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Nombre del proveedor</span>
            <input
              required
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="mt-1.5 w-full border border-gray-300 rounded-xl px-3 py-2.5
                         text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="Ej. Maderas del Valle"
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
              {guardando ? 'Guardando…' : modoEditar ? 'Guardar cambios' : 'Agregar proveedor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
