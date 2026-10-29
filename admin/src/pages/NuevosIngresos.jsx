/**
 * NuevosIngresos.jsx — Front door rápido para registrar restock, más un
 * vistazo de cuánto se ha invertido por semana.
 *
 * ── REUSO, NO DUPLICACIÓN ────────────────────────────────────────────────────
 *
 * El alta de stock YA existía: HistorialStock.jsx, el panel "Editar stock"
 * que se abre desde la ficha de un producto (ProductoModal.jsx). Esta
 * página NO reimplementa ese formulario ni su POST a
 * /productos/{id}/movimientos — reusa el componente HistorialStock tal
 * cual, solo que se llega a él desde un buscador de productos en vez de
 * desde "Editar producto". Es el mismo modal, el mismo endpoint, el mismo
 * trigger de base de datos recalculando existencias — un atajo hacia la
 * misma acción, no una segunda implementación. La entrada existente desde
 * la ficha del producto se queda intacta, sin cambios.
 *
 * ── EL GRÁFICO Y EL DRILL-DOWN ───────────────────────────────────────────────
 *
 * GET /dashboard/gasto-restock?agrupacion=semana devuelve filas por
 * (semana, proveedor, ubicación) — aquí se suman client-side a un total
 * por semana para la barra. Al tocar una barra, se pide el detalle de ESA
 * semana con GET /dashboard/gasto-restock/detalle (mismo endpoint que
 * alimenta el KPI "Inversión en restock" de Histórico), que trae los 4
 * desgloses (proveedor/categoría/sucursal/ubicación) para esa semana
 * puntual.
 */

import { useState, useEffect, useCallback } from 'react'
import Layout from '../components/Layout'
import { apiFetch } from '../api'
import { useAuth } from '../context/AuthContext'
import HistorialStock from '../components/HistorialStock'
import { toISO } from '../lib/periodos'
import { ACENTO_HEX } from '../lib/theme'

// Mismo criterio que Sucursales.jsx: el nav item ya está oculto para viewer
// (ver Layout.jsx), pero si alguien llega por URL directa, esta página es
// enteramente una acción de escritura (agregar stock) — sin permiso, no
// tiene sentido mostrar el buscador/formulario. El gráfico de inversión sí
// se deja visible a cualquier rol autenticado (es informativo, mismo
// criterio que el KPI "Inversión en restock" de Histórico).
const ROLES_ESCRITURA_STOCK = ['superadmin', 'admin', 'worker']
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'

const mxn = (n) =>
  Number(n).toLocaleString('es-MX', {
    style: 'currency', currency: 'MXN',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  })

const mxnCorto = (v) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v}`
}

const formatFecha = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('es-MX', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

export default function NuevosIngresos() {
  const { usuario } = useAuth()
  const puedeEscribir = ROLES_ESCRITURA_STOCK.includes(usuario?.rol)

  // ── Izquierda: buscador de producto → HistorialStock (modal reusado) ──────
  const [productos, setProductos]     = useState([])
  const [proveedores, setProveedores] = useState([])
  const [busqueda, setBusqueda]       = useState('')
  const [productoSel, setProductoSel] = useState(null)

  useEffect(() => {
    apiFetch('/admin/productos').then((r) => (r.ok ? r.json() : [])).then(setProductos).catch(() => setProductos([]))
    apiFetch('/proveedores').then((r) => (r.ok ? r.json() : [])).then(setProveedores).catch(() => setProveedores([]))
  }, [])

  const productosFiltrados = busqueda.trim()
    ? productos.filter((p) => p.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()))
    : productos

  // ── Derecha: gráfico semanal + drill-down ──────────────────────────────────
  const [semanas, setSemanas]                 = useState([])
  const [cargandoSemanas, setCargandoSemanas] = useState(true)
  const [semanaSel, setSemanaSel]             = useState(null)   // { desde, hasta, etiqueta }
  const [detalle, setDetalle]                 = useState(null)
  const [cargandoDetalle, setCargandoDetalle] = useState(false)

  const cargarSemanas = useCallback(async () => {
    setCargandoSemanas(true)
    try {
      const res = await apiFetch('/dashboard/gasto-restock?agrupacion=semana')
      if (!res.ok) throw new Error()
      const filas = await res.json()
      // Filas vienen por (periodo, proveedor, ubicacion) -- se agregan a un
      // total por semana, que es todo lo que necesita la barra.
      const porSemana = new Map()
      for (const f of filas) {
        const acc = porSemana.get(f.periodo) ?? { periodo: f.periodo, etiqueta: f.etiqueta, gasto_total: 0 }
        acc.gasto_total += f.gasto_total
        porSemana.set(f.periodo, acc)
      }
      setSemanas([...porSemana.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)))
    } catch {
      setSemanas([])
    } finally {
      setCargandoSemanas(false)
    }
  }, [])

  useEffect(() => { cargarSemanas() }, [cargarSemanas])

  async function seleccionarSemana(periodoLunes, etiqueta) {
    // date_trunc('week', ...) de Postgres ya da el LUNES de esa semana ISO
    // (ver comentario en dashboard.py) -- domingo es lunes + 6 días.
    const lunes = new Date(periodoLunes + 'T00:00:00')
    const domingo = new Date(lunes)
    domingo.setDate(lunes.getDate() + 6)
    const rango = { desde: periodoLunes, hasta: toISO(domingo), etiqueta }
    setSemanaSel(rango)
    setCargandoDetalle(true)
    setDetalle(null)
    try {
      const res = await apiFetch(`/dashboard/gasto-restock/detalle?fecha_desde=${rango.desde}&fecha_hasta=${rango.hasta}`)
      if (!res.ok) throw new Error()
      setDetalle(await res.json())
    } catch {
      setDetalle(null)
    } finally {
      setCargandoDetalle(false)
    }
  }

  function alGuardarMovimiento(cambios) {
    // Refleja el nuevo stock en la lista local sin re-pedir todo el catálogo.
    setProductos((prev) =>
      prev.map((p) => (p.id === productoSel.id ? { ...p, existencias: cambios.existencias } : p))
    )
    // Una alta nueva puede cambiar el gasto de la semana en curso.
    cargarSemanas()
  }

  return (
    <Layout>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Restock</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Agrega stock a cualquier producto y revisa cuánto se ha invertido por semana.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* ── Izquierda: buscador de producto ── */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Agregar stock
          </h2>
          {!puedeEscribir ? (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl px-5 py-8 text-center">
              <p className="text-sm text-gray-400">Tu rol no tiene permiso para registrar stock.</p>
            </div>
          ) : (
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <input
              type="text"
              placeholder="Buscar producto por nombre…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm mb-3
                         focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
            <div className="max-h-[440px] overflow-y-auto space-y-0.5">
              {productosFiltrados.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-6">Sin resultados.</p>
              )}
              {productosFiltrados.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProductoSel(p)}
                  className="w-full text-left flex items-center justify-between gap-3 px-3 py-2.5
                             rounded-xl hover:bg-amber-50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{p.nombre}</p>
                    <p className="text-xs text-gray-400 truncate">{p.categoria || 'Sin categoría'}</p>
                  </div>
                  <span className="text-xs font-medium text-gray-500 shrink-0">
                    {p.existencias} en stock
                  </span>
                </button>
              ))}
            </div>
          </div>
          )}
        </section>

        {/* ── Derecha: inversión por semana + drill-down ── */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Inversión por semana
          </h2>
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            {cargandoSemanas ? (
              <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>
            ) : semanas.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">
                Todavía no hay entradas de inventario con costo registrado.
              </p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={semanas} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3EFE8" />
                    <XAxis dataKey="etiqueta" tick={{ fontSize: 10, fill: '#ABA092' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={mxnCorto} tick={{ fontSize: 11, fill: '#ABA092' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(v) => [mxn(v), 'Gasto']}
                      cursor={{ fill: '#F4E4DA' }}
                      contentStyle={{ borderRadius: '12px', border: '1px solid #E8E2D6', fontSize: '13px' }}
                    />
                    {/* onClick en <Bar>, no en <BarChart> -- entrega directo el
                        punto de datos (data, index) en vez de depender de
                        activePayload del evento sintético del contenedor. */}
                    <Bar
                      dataKey="gasto_total"
                      fill={ACENTO_HEX}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                      cursor="pointer"
                      onClick={(data) => seleccionarSemana(data.periodo, data.etiqueta)}
                    />
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-400 mt-2 text-center">
                  Toca una barra para ver el desglose de esa semana.
                </p>
              </>
            )}
          </div>

          {semanaSel && (
            <div className="mt-4 bg-white border border-gray-200 rounded-2xl p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">
                    Semana del {formatFecha(semanaSel.desde)}
                  </h3>
                  <p className="text-xs text-gray-400">
                    {formatFecha(semanaSel.desde)} — {formatFecha(semanaSel.hasta)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setSemanaSel(null); setDetalle(null) }}
                  className="text-xs font-medium text-gray-400 hover:text-gray-700 transition-colors shrink-0"
                >
                  Cerrar
                </button>
              </div>
              {cargandoDetalle && (
                <p className="text-sm text-gray-400 text-center py-6">Cargando…</p>
              )}
              {!cargandoDetalle && detalle && <DesgloseSemana detalle={detalle} />}
            </div>
          )}
        </section>
      </div>

      {/* HistorialStock reusado tal cual (modal) — se abre al elegir un
          producto de la lista de arriba, se cierra devolviendo a la lista. */}
      {productoSel && (
        <HistorialStock
          productoId={productoSel.id}
          proveedores={proveedores}
          onProductoActualizado={alGuardarMovimiento}
          onCerrar={() => setProductoSel(null)}
        />
      )}
    </Layout>
  )
}


// ── Desglose de una semana (4 dimensiones) ───────────────────────────────────
// Listas simples en vez de mini-gráficas: con 2-5 valores distintos por
// dimensión (el volumen real hoy: 2 sucursales, un puñado de proveedores/
// categorías/bodegas), una gráfica de barras no añade lectura extra sobre
// una lista ordenada — y evita meter 4 colores nuevos solo por variedad.

function DesgloseSemana({ detalle }) {
  const secciones = [
    { titulo: 'Por proveedor', datos: detalle.por_proveedor },
    { titulo: 'Por categoría', datos: detalle.por_categoria },
    { titulo: 'Por sucursal',  datos: detalle.por_sucursal },
    { titulo: 'Por ubicación', datos: detalle.por_ubicacion },
  ]
  return (
    <div>
      <p className="text-2xl font-bold text-gray-900 mb-1">{mxn(detalle.gasto_total)}</p>
      {detalle.entradas_sin_costo > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-4 inline-block">
          {detalle.entradas_sin_costo} entrada{detalle.entradas_sin_costo !== 1 ? 's' : ''} sin costo registrado, no incluida{detalle.entradas_sin_costo !== 1 ? 's' : ''} arriba.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4 mt-2">
        {secciones.map(({ titulo, datos }) => (
          <div key={titulo}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{titulo}</p>
            {datos.length === 0 ? (
              <p className="text-xs text-gray-300">Sin datos.</p>
            ) : (
              <ul className="space-y-1">
                {datos.map((d) => (
                  <li key={d.nombre} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-gray-600 truncate">{d.nombre}</span>
                    <span className="font-medium text-gray-800 shrink-0">{mxn(d.gasto)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
