/**
 * HistorialStock.jsx — Panel "Editar stock": historial de entradas de
 * inventario (movimientos_inventario) con alta, edición y borrado.
 *
 * Antes este panel solo permitía AGREGAR movimientos. Ahora cada renglón
 * también se puede editar o borrar — por eso productos.existencias y
 * fecha_ingreso dejaron de escribirse a mano en cualquier endpoint: los
 * mantiene un trigger en la base de datos (migración 010), recalculando
 * desde cero cada vez que este historial cambia. Este componente nunca
 * calcula esos totales — siempre los LEE de la respuesta del servidor
 * después de un POST/PUT/DELETE.
 *
 * ── AGREGAR vs EDITAR usan el MISMO formulario ──────────────────────────────
 *
 *   En vez de un formulario para agregar y otro (por renglón) para editar,
 *   hay uno solo: `editandoId`.
 *     - null            → el formulario está en modo "agregar"
 *     - id de movimiento → el formulario quedó pre-llenado con esos valores;
 *                          "Guardar cambios" hace PUT en vez de POST
 *
 *   Al hacer clic en "Editar" en un renglón de la tabla, sus valores se
 *   copian al formulario de arriba y aparece "Cancelar edición".
 *
 * Props:
 *   productoId              — id del producto (siempre existe: este panel
 *                              solo se ofrece al editar, nunca al crear)
 *   proveedores              — lista ya cargada por ProductoModal, para no
 *                              repetir el fetch aquí
 *   onProductoActualizado    — se llama con { existencias, fecha_ingreso,
 *                              ubicaciones } cada vez que un alta/edición/
 *                              borrado cambia esos campos derivados
 *   onCerrar                 — cierra el panel
 */

import { useState, useEffect } from 'react'
import { apiFetch } from '../api'
import ConfirmDialog from './ConfirmDialog'

const UBICACIONES_OPCIONES = ['Local Mexico', 'Local Jose', 'Local Amarillo', 'Almacen']

const hoy = () => new Date().toISOString().slice(0, 10)

const FORM_VACÍO = { cantidad: '', fecha: hoy(), ubicacion: '', proveedorId: '', costoUnitario: '' }

const formatFecha = (fecha) =>
  fecha
    ? new Date(fecha + 'T00:00:00').toLocaleDateString('es-MX', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : '—'

const mxn = (n) =>
  Number(n).toLocaleString('es-MX', {
    style: 'currency', currency: 'MXN',
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  })

export default function HistorialStock({ productoId, proveedores, onProductoActualizado, onCerrar }) {
  const [historial, setHistorial] = useState([])
  const [cargando, setCargando]   = useState(true)
  const [error, setError]         = useState(null)

  // --- Formulario compartido: agregar (editandoId === null) o editar ---
  const [form, setForm]           = useState(FORM_VACÍO)
  const [editandoId, setEditandoId] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [errorForm, setErrorForm] = useState(null)

  // --- Borrar ---
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(null)   // movimiento o null
  const [eliminando, setEliminando] = useState(false)
  const [errorEliminar, setErrorEliminar] = useState(null)

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

  function cambiar(campo) {
    return (e) => setForm((prev) => ({ ...prev, [campo]: e.target.value }))
  }

  function iniciarEdicion(mov) {
    setEditandoId(mov.id)
    setForm({
      cantidad:      String(mov.cantidad),
      fecha:         mov.fecha,
      ubicacion:     mov.ubicacion ?? '',
      proveedorId:   mov.proveedor_id?.toString() ?? '',
      costoUnitario: mov.costo_unitario?.toString() ?? '',
    })
    setErrorForm(null)
  }

  function cancelarEdicion() {
    setEditandoId(null)
    setForm(FORM_VACÍO)
    setErrorForm(null)
  }

  async function handleGuardar() {
    const cantidad = parseInt(form.cantidad)
    if (isNaN(cantidad) || cantidad <= 0) return

    setGuardando(true)
    setErrorForm(null)
    try {
      const payload = {
        cantidad,
        fecha:          form.fecha || null,
        ubicacion:      form.ubicacion || null,
        proveedor_id:   form.proveedorId ? parseInt(form.proveedorId) : null,
        costo_unitario: form.costoUnitario !== '' ? parseFloat(form.costoUnitario) : null,
      }
      const url    = editandoId
        ? `/productos/${productoId}/movimientos/${editandoId}`
        : `/productos/${productoId}/movimientos`
      const method = editandoId ? 'PUT' : 'POST'

      const res = await apiFetch(url, { method, body: JSON.stringify(payload) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.detail ?? 'No se pudo guardar el movimiento.')
      }
      onProductoActualizado({
        existencias:   data.existencias_totales,
        fecha_ingreso: data.fecha_ingreso_producto,
        ubicaciones:   data.ubicaciones_producto,
      })
      cancelarEdicion()
      await cargarHistorial()
    } catch (err) {
      setErrorForm(err.message)
    } finally {
      setGuardando(false)
    }
  }

  async function handleEliminar() {
    if (!confirmandoEliminar) return
    setEliminando(true)
    setErrorEliminar(null)
    try {
      const res = await apiFetch(
        `/productos/${productoId}/movimientos/${confirmandoEliminar.id}`,
        { method: 'DELETE' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail ?? 'No se pudo borrar el movimiento.')

      onProductoActualizado({
        existencias:   data.existencias_totales,
        fecha_ingreso: data.fecha_ingreso_producto,
        ubicaciones:   data.ubicaciones_producto,
      })
      // Si se estaba editando justo el renglón que se borró, regresa al modo agregar.
      if (editandoId === confirmandoEliminar.id) cancelarEdicion()
      setConfirmandoEliminar(null)
      await cargarHistorial()
    } catch (err) {
      setErrorEliminar(err.message)
      setConfirmandoEliminar(null)
    } finally {
      setEliminando(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4"
      onClick={onCerrar}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg
                   max-h-[92dvh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Encabezado ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-semibold text-gray-900">Editar stock</h2>
          <button
            onClick={onCerrar}
            aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* ── Formulario: agregar o editar (según editandoId) ── */}
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 space-y-2">
            <p className="text-xs font-medium text-gray-500">
              {editandoId ? 'Editando movimiento' : 'Llegó más stock de este mueble'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                value={form.cantidad}
                onChange={cambiar('cantidad')}
                min="1"
                step="1"
                placeholder="Cantidad"
                className={inputCls}
              />
              <input
                type="date"
                value={form.fecha}
                onChange={cambiar('fecha')}
                className={inputCls}
              />
            </div>
            <select value={form.ubicacion} onChange={cambiar('ubicacion')} className={inputCls}>
              <option value="">— Sin ubicación —</option>
              {UBICACIONES_OPCIONES.map((ubi) => (
                <option key={ubi} value={ubi}>{ubi}</option>
              ))}
            </select>
            <select value={form.proveedorId} onChange={cambiar('proveedorId')} className={inputCls}>
              <option value="">— Sin proveedor —</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>{p.proveedor}</option>
              ))}
            </select>
            <input
              type="number"
              value={form.costoUnitario}
              onChange={cambiar('costoUnitario')}
              min="0"
              step="0.01"
              placeholder="Costo por pieza (opcional)"
              className={inputCls}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleGuardar}
                disabled={guardando || !form.cantidad}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-800 disabled:opacity-50
                           text-white rounded-xl text-sm font-medium transition-colors"
              >
                {guardando ? 'Guardando…' : editandoId ? 'Guardar cambios' : '+ Agregar existencias'}
              </button>
              {editandoId && (
                <button
                  type="button"
                  onClick={cancelarEdicion}
                  disabled={guardando}
                  className="px-4 py-2 border border-gray-300 rounded-xl text-sm
                             font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  Cancelar
                </button>
              )}
            </div>
            {errorForm && (
              <p className="text-xs text-red-600">{errorForm}</p>
            )}
          </div>

          {/* ── Tabla de historial ── */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Entradas registradas
            </p>

            {errorEliminar && (
              <p className="text-xs text-red-600 mb-2">{errorEliminar}</p>
            )}

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
              <div className="border border-gray-100 rounded-xl overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs text-gray-400 uppercase tracking-wide">
                      <th className="px-3 py-2 font-medium whitespace-nowrap">Fecha</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">Cantidad</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">Ubicación</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">Proveedor</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">Costo</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {historial.map((m) => (
                      <tr key={m.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatFecha(m.fecha)}</td>
                        <td className="px-3 py-2 text-gray-900 font-medium whitespace-nowrap">+{m.cantidad}</td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                          {m.ubicacion || '—'}
                          {m.nombre_usuario && (
                            <span className="block text-xs text-gray-400">{m.nombre_usuario}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{m.nombre_proveedor || '—'}</td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                          {m.costo_total != null ? mxn(m.costo_total) : '—'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex gap-2 justify-end">
                            <button
                              type="button"
                              onClick={() => iniciarEdicion(m)}
                              className="text-xs font-medium text-amber-700 hover:underline"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmandoEliminar(m)}
                              className="text-xs font-medium text-red-600 hover:underline"
                            >
                              Eliminar
                            </button>
                          </div>
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

      {confirmandoEliminar && (
        <ConfirmDialog
          titulo="¿Borrar este movimiento?"
          mensaje={`Se borrará la entrada de ${confirmandoEliminar.cantidad} pieza(s) del ${formatFecha(confirmandoEliminar.fecha)}. Las existencias del producto se recalculan automáticamente.`}
          textoConfirmar={eliminando ? 'Borrando…' : 'Borrar'}
          onConfirmar={handleEliminar}
          onCancelar={() => setConfirmandoEliminar(null)}
        />
      )}
    </div>
  )
}

const inputCls =
  'w-full border border-gray-300 rounded-xl px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent ' +
  'bg-white'
