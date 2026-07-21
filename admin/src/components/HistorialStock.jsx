/**
 * HistorialStock.jsx — Panel de historial de entradas de inventario (restock).
 *
 * Antes vivía como un bloque fijo dentro de ProductoModal (cantidad/fecha/
 * ubicación + botón, sin nada que mostrara lo ya registrado). Aquí se
 * convierte en lo que en realidad es: una vista del historial
 * (movimientos_inventario) con un formulario para agregar una entrada más,
 * no al revés.
 *
 * Se abre como un panel flotante SOBRE ProductoModal (z-[60] > z-50), no
 * reemplaza el modal de producto — el botón que lo abre vive dentro del
 * formulario de producto.
 *
 * Props:
 *   productoId              — id del producto (siempre existe: este panel
 *                              solo se ofrece al editar, nunca al crear)
 *   onExistenciasActualizadas — se llama con el nuevo total cada vez que se
 *                              registra un movimiento, para que ProductoModal
 *                              refleje el cambio en su propio campo Existencias
 *   onCerrar                — cierra el panel
 */

import { useState, useEffect } from 'react'
import { apiFetch } from '../api'

const UBICACIONES_OPCIONES = ['Local Mexico', 'Local Jose', 'Local Amarillo', 'Almacen']

const hoy = () => new Date().toISOString().slice(0, 10)

const formatFecha = (fecha) =>
  fecha
    ? new Date(fecha + 'T00:00:00').toLocaleDateString('es-MX', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : '—'

export default function HistorialStock({ productoId, onExistenciasActualizadas, onCerrar }) {
  const [historial, setHistorial] = useState([])
  const [cargando, setCargando]   = useState(true)
  const [error, setError]         = useState(null)

  // --- Formulario para agregar un movimiento nuevo ---
  const [cantidad, setCantidad]   = useState('')
  const [fecha, setFecha]         = useState(hoy())
  const [ubicacion, setUbicacion] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [errorForm, setErrorForm] = useState(null)

  async function cargarHistorial() {
    setCargando(true)
    setError(null)
    try {
      const res = await apiFetch(`/productos/${productoId}/movimientos`)
      if (!res.ok) throw new Error('No se pudo cargar el historial de stock.')
      setHistorial(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargarHistorial() }, [productoId])

  async function handleAgregar() {
    const cant = parseInt(cantidad)
    if (isNaN(cant) || cant <= 0) return

    setGuardando(true)
    setErrorForm(null)
    try {
      const res = await apiFetch(`/productos/${productoId}/movimientos`, {
        method: 'POST',
        body: JSON.stringify({
          cantidad: cant,
          fecha: fecha || null,
          ubicacion: ubicacion || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.detail ?? 'No se pudo registrar la entrada de inventario.')
      }
      onExistenciasActualizadas(data.existencias_totales)
      setCantidad('')
      setUbicacion('')
      setFecha(hoy())
      await cargarHistorial()   // refleja el movimiento recién creado en la tabla
    } catch (err) {
      setErrorForm(err.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4"
      onClick={onCerrar}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md
                   max-h-[92dvh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Encabezado ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-semibold text-gray-900">Historial de stock</h2>
          <button
            onClick={onCerrar}
            aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* ── Agregar movimiento ── */}
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 space-y-2">
            <p className="text-xs font-medium text-gray-500">Llegó más stock de este mueble</p>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                min="1"
                step="1"
                placeholder="Cantidad"
                className={inputCls}
              />
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className={inputCls}
              />
            </div>
            <select
              value={ubicacion}
              onChange={(e) => setUbicacion(e.target.value)}
              className={inputCls}
            >
              <option value="">— Sin ubicación —</option>
              {UBICACIONES_OPCIONES.map((ubi) => (
                <option key={ubi} value={ubi}>{ubi}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAgregar}
              disabled={guardando || !cantidad}
              className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-800 disabled:opacity-50
                         text-white rounded-xl text-sm font-medium transition-colors"
            >
              {guardando ? 'Guardando…' : '+ Agregar existencias'}
            </button>
            {errorForm && (
              <p className="text-xs text-red-600">{errorForm}</p>
            )}
          </div>

          {/* ── Tabla de historial ── */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Entradas registradas
            </p>

            {cargando && (
              <p className="text-sm text-gray-400 text-center py-6">Cargando historial…</p>
            )}

            {!cargando && error && (
              <p className="text-sm text-red-600 text-center py-6">{error}</p>
            )}

            {!cargando && !error && historial.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">
                Todavía no hay entradas registradas para este producto.
              </p>
            )}

            {!cargando && !error && historial.length > 0 && (
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs text-gray-400 uppercase tracking-wide">
                      <th className="px-3 py-2 font-medium">Fecha</th>
                      <th className="px-3 py-2 font-medium">Cantidad</th>
                      <th className="px-3 py-2 font-medium">Ubicación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historial.map((m) => (
                      <tr key={m.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-700">{formatFecha(m.fecha)}</td>
                        <td className="px-3 py-2 text-gray-900 font-medium">+{m.cantidad}</td>
                        <td className="px-3 py-2 text-gray-500">
                          {m.ubicacion || '—'}
                          {m.nombre_usuario && (
                            <span className="block text-xs text-gray-400">{m.nombre_usuario}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

const inputCls =
  'w-full border border-gray-300 rounded-xl px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent ' +
  'bg-white'
