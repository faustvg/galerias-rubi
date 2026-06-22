/**
 * Historico.jsx — Análisis de periodos pasados del negocio.
 *
 * ── CÓMO FUNCIONA EL SELECTOR DE PERIODO ────────────────────────────────────
 *
 *   Un "periodo" es simplemente un par de fechas: { desde, hasta }.
 *   La UI (un input[type="month"] + botones rápidos) tiene UNA sola responsabilidad:
 *   calcular ese par y guardarlo en el estado `periodo`.
 *
 *   El flujo completo:
 *
 *     1. Usuario cambia el mes en el input  →  seleccionarMes("2026-05")
 *     2. seleccionarMes() computa { desde: "2026-05-01", hasta: "2026-05-31" }
 *     3. setPeriodo({ desde, hasta })  →  React actualiza el estado
 *     4. `cargar` está definido con useCallback([periodo, ...])
 *        Cuando `periodo` cambia, React descarta la función anterior
 *        y crea una nueva versión de `cargar` con el periodo nuevo.
 *     5. useEffect([cargar]) ve que `cargar` es un objeto nuevo
 *        → llama cargar() → fetch al backend con las nuevas fechas.
 *
 *   El resultado: cambiar el periodo AUTOMÁTICAMENTE dispara el re-fetch.
 *   No hay que llamar nada manualmente.
 *
 * ── input[type="month"] ──────────────────────────────────────────────────────
 *
 *   El navegador muestra un picker de mes+año nativo.
 *   Su value es el string "YYYY-MM" (ej. "2026-06").
 *
 *   Para convertir ese string a un rango de fechas:
 *
 *     const [anio, mes] = "2026-06".split('-').map(Number)  // [2026, 6]
 *     const primero = new Date(anio, mes - 1, 1)            // 1 jun 2026
 *     const ultimo  = new Date(anio, mes, 0)                // día 0 del mes sig.
 *                                                           // = 30 jun 2026
 *
 *   El truco "día 0": new Date(2026, 7, 0) es el último día de junio (julio es mes 7,
 *   su día 0 = día anterior al 1 de julio = 30 de junio). Funciona en todos los
 *   meses, incluyendo febrero en año bisiesto.
 *
 * ── BOTONES RÁPIDOS ──────────────────────────────────────────────────────────
 *
 *   Cada botón calcula el rango con aritmética de Date() y llama setPeriodo().
 *
 *   "Semana pasada": busca el domingo más reciente (fin de semana), retrocede 6
 *   días para el lunes (inicio de semana). Semana = lun-dom.
 *
 *   "Mes pasado": new Date(año, mes, 0) da el último día del mes anterior.
 *   Desde ahí, new Date(año, mes-1, 1) da el primer día de ese mes.
 *
 *   "Mes actual": primer y último día del mes en curso.
 *
 * ── CÓMO LOS ENDPOINTS RECIBEN EL RANGO ──────────────────────────────────────
 *
 *   Los params van en la query string, igual que cualquier filtro:
 *
 *     /dashboard/historico/resumen?fecha_desde=2026-05-01&fecha_hasta=2026-05-31
 *
 *   FastAPI los lee con:
 *     fecha_desde: date = Query(...)
 *     fecha_hasta: date = Query(...)
 *
 *   El tipo `date` de Python valida automáticamente que el string sea
 *   "YYYY-MM-DD" y lo convierte. Si el cliente manda algo inválido, FastAPI
 *   responde 422 antes de ejecutar el handler.
 */

import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../api'
import Layout from '../components/Layout'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'


// ── Helpers de fecha ──────────────────────────────────────────────────────────

const toISO = (d) => d.toISOString().slice(0, 10)

// "YYYY-MM" para <input type="month">
const aMesInput = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

function rangoMesActual() {
  const hoy = new Date()
  return {
    desde: toISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
    hasta: toISO(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)),
  }
}

function rangoMesPasado() {
  const hoy = new Date()
  const ultimo  = new Date(hoy.getFullYear(), hoy.getMonth(), 0)   // último día del mes anterior
  const primero = new Date(ultimo.getFullYear(), ultimo.getMonth(), 1)
  return { desde: toISO(primero), hasta: toISO(ultimo) }
}

function rangoSemanaPassada() {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  // getDay(): 0=Dom, 1=Lun, ..., 6=Sáb
  // Días hasta el domingo más reciente que ya pasó (excluyendo hoy si es domingo):
  //   dow=0 → 7, dow=1 → 1, dow=2 → 2, ..., dow=6 → 6
  const diasHastaDom = hoy.getDay() === 0 ? 7 : hoy.getDay()
  const domingo = new Date(hoy)
  domingo.setDate(hoy.getDate() - diasHastaDom)   // domingo fin de semana pasada
  const lunes = new Date(domingo)
  lunes.setDate(domingo.getDate() - 6)             // lunes inicio de semana pasada
  return { desde: toISO(lunes), hasta: toISO(domingo) }
}

// Formateadores
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

const mxnTooltip = (value) => [mxn(value), 'Utilidad estimada']

const formatFecha = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('es-MX', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

function labelPeriodo(periodo) {
  const d = new Date(periodo.desde + 'T00:00:00')
  const h = new Date(periodo.hasta + 'T00:00:00')
  const opts = { day: 'numeric', month: 'short', year: 'numeric' }
  if (periodo.desde === periodo.hasta) return d.toLocaleDateString('es-MX', opts)
  // Si cubre un mes completo: mostrar "Junio 2026"
  const primeroDeMes = new Date(d.getFullYear(), d.getMonth(), 1)
  const ultimoDeMes  = new Date(h.getFullYear(), h.getMonth() + 1, 0)
  if (
    d.getTime() === primeroDeMes.getTime() &&
    h.getTime() === ultimoDeMes.getTime() &&
    d.getMonth() === h.getMonth() && d.getFullYear() === h.getFullYear()
  ) {
    return d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
  }
  return `${d.toLocaleDateString('es-MX', opts)} — ${h.toLocaleDateString('es-MX', opts)}`
}


// ── Componente principal ──────────────────────────────────────────────────────

export default function Historico() {
  const { usuario, logout } = useAuth()
  const navigate = useNavigate()
  const es_worker = usuario?.rol === 'worker'

  // ── Estado del periodo ───────────────────────────────────────────────────
  // `periodo` es la fuente de verdad para el fetch.
  // `mesInput` sincroniza el valor del <input type="month">.
  const [periodo,   setPeriodo]   = useState(rangoMesActual)
  const [mesInput,  setMesInput]  = useState(() => aMesInput(new Date()))

  // ── Estado de datos ──────────────────────────────────────────────────────
  const [resumen,   setResumen]   = useState(null)
  const [utilidad,  setUtilidad]  = useState(null)
  const [cargando,  setCargando]  = useState(true)
  const [error,     setError]     = useState(null)

  // ── Fetch — se re-crea al cambiar `periodo` ──────────────────────────────
  // useCallback memorizará esta función hasta que cambie alguna de sus
  // dependencias. Como `periodo` es una dependencia, cada vez que el usuario
  // cambia el mes o pulsa un botón rápido, React crea una nueva versión de
  // `cargar`, lo que dispara el useEffect de abajo.
  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const qs = `fecha_desde=${periodo.desde}&fecha_hasta=${periodo.hasta}`
      const [resR, utilR] = await Promise.all([
        apiFetch(`/dashboard/historico/resumen?${qs}`),
        apiFetch(`/dashboard/historico/utilidad?${qs}`),
      ])
      if (resR.status === 401 || utilR.status === 401) {
        await logout(); navigate('/login'); return
      }
      if (!resR.ok || !utilR.ok) throw new Error('No se pudo cargar el histórico.')
      setResumen(await resR.json())
      setUtilidad(await utilR.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }, [periodo, logout, navigate])

  useEffect(() => { cargar() }, [cargar])

  // ── Manejadores del selector de periodo ──────────────────────────────────

  function seleccionarMes(valor) {
    // valor = "2026-06" desde <input type="month">
    setMesInput(valor)
    if (!valor) return
    const [anio, mes] = valor.split('-').map(Number)
    setPeriodo({
      desde: toISO(new Date(anio, mes - 1, 1)),  // primer día del mes
      hasta: toISO(new Date(anio, mes, 0)),        // último día del mes (día 0 del sig.)
    })
  }

  function aplicarAtajo(rango, nuevoMesInput = '') {
    setPeriodo(rango)
    setMesInput(nuevoMesInput)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Layout>
      {/* ── Encabezado ── */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Histórico</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {es_worker
            ? `Tus resultados — ${labelPeriodo(periodo)}`
            : `Resultados del negocio — ${labelPeriodo(periodo)}`}
        </p>
      </div>

      {/* ── Selector de periodo ───────────────────────────────────────────────
          input[type="month"] renderiza un picker nativo de mes+año.
          Su valor es "YYYY-MM"; nosotros lo convertimos a { desde, hasta }.
          Los botones rápidos llaman a aplicarAtajo() directamente con el rango
          precomputado y limpian / actualizan el input según corresponda. */}
      <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 mb-5
                      flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0">
          Periodo
        </span>

        <input
          type="month"
          value={mesInput}
          max={aMesInput(new Date())}
          onChange={(e) => seleccionarMes(e.target.value)}
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white
                     focus:outline-none focus:ring-2 focus:ring-amber-400"
        />

        <div className="flex gap-2 flex-wrap">
          {[
            {
              label: 'Semana pasada',
              fn: () => aplicarAtajo(rangoSemanaPassada()),
            },
            {
              label: 'Mes pasado',
              fn: () => {
                const r = rangoMesPasado()
                aplicarAtajo(r, r.desde.slice(0, 7))
              },
            },
            {
              label: 'Mes actual',
              fn: () => {
                const r = rangoMesActual()
                aplicarAtajo(r, r.desde.slice(0, 7))
              },
            },
          ].map(({ label, fn }) => (
            <button
              key={label}
              onClick={fn}
              className="text-sm px-3 py-2 rounded-xl border border-gray-200
                         text-gray-600 hover:border-amber-300 hover:text-amber-700
                         transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200
                        rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* ── Cargando ── */}
      {cargando && (
        <p className="text-center text-gray-400 py-16 text-sm">Cargando…</p>
      )}

      {!cargando && resumen && (
        <>
          {/* ── Tarjetas KPI ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <KpiCard
              etiqueta="Ventas en el periodo"
              valor={mxn(resumen.total_ventas)}
              sub={`${resumen.num_notas} nota${resumen.num_notas !== 1 ? 's' : ''}`}
              color="amber"
            />
            <KpiCard
              etiqueta="Resta pendiente"
              valor={mxn(resumen.resta_pendiente)}
              sub={`${resumen.num_notas_resta} nota${resumen.num_notas_resta !== 1 ? 's' : ''} sin cobrar`}
              color={resumen.resta_pendiente > 0 ? 'red' : 'green'}
            />
            <KpiCard
              etiqueta="Entregas completadas"
              valor={`${resumen.entregadas.length}`}
              sub={resumen.entregadas.length > 0
                ? `Última: ${formatFecha(resumen.entregadas[0].fecha_entrega)}`
                : 'Ninguna en el periodo'}
              color={resumen.entregadas.length > 0 ? 'green' : 'gray'}
            />
          </div>

          {/* ── Lista de entregas completadas ── */}
          {resumen.entregadas.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Entregas completadas en el periodo
              </h2>
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                {resumen.entregadas.map((e, i) => (
                  <Link
                    key={e.folio}
                    to={`/notas/${e.folio}`}
                    className={`flex items-center justify-between gap-3 px-4 py-3
                                hover:bg-amber-50 transition-colors ${
                      i < resumen.entregadas.length - 1 ? 'border-b border-gray-100' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {e.etiqueta}
                      </p>
                      <p className="text-xs text-gray-400 font-mono">{e.folio}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-semibold text-green-600">
                        {formatFecha(e.fecha_entrega)}
                      </p>
                      <p className="text-sm font-semibold text-gray-700">
                        {mxn(e.total)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* ── Gráficas de utilidad ── */}
          {utilidad && (
            <GraficasUtilidad utilidad={utilidad} es_worker={es_worker} />
          )}

          {/* Nota de estimación */}
          <p className="text-xs text-gray-400 text-center mt-4 pb-4">
            * Los márgenes son estimados (basados en costos base del catálogo).
          </p>
        </>
      )}
    </Layout>
  )
}


// ── Tarjeta de KPI ────────────────────────────────────────────────────────────

const COLOR_MAP = {
  amber: 'bg-amber-50 border-amber-200 text-amber-700',
  red:   'bg-red-50   border-red-200   text-red-700',
  green: 'bg-green-50 border-green-200 text-green-700',
  blue:  'bg-blue-50  border-blue-200  text-blue-700',
  gray:  'bg-gray-50  border-gray-200  text-gray-600',
}

function KpiCard({ etiqueta, valor, sub, color = 'gray' }) {
  const cls = COLOR_MAP[color] ?? COLOR_MAP.gray
  return (
    <div className={`rounded-2xl border px-5 py-4 ${cls}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">
        {etiqueta}
      </p>
      <p className="text-2xl font-bold leading-tight">{valor}</p>
      {sub && <p className="text-xs mt-1 opacity-70">{sub}</p>}
    </div>
  )
}


// ── Gráficas de utilidad ──────────────────────────────────────────────────────

function GraficasUtilidad({ utilidad, es_worker }) {
  const { por_categoria, por_proveedor, por_worker } = utilidad
  const hayDatos = (arr) => arr && arr.some((d) => d.utilidad !== 0)

  return (
    <div className="space-y-6">
      {hayDatos(por_categoria) && (
        <GraficarBarras titulo="Utilidad por categoría"  datos={por_categoria} color="#f59e0b" />
      )}
      {hayDatos(por_proveedor) && (
        <GraficarBarras titulo="Utilidad por proveedor"  datos={por_proveedor} color="#6366f1" />
      )}
      {!es_worker && hayDatos(por_worker) && (
        <GraficarBarras titulo="Utilidad por vendedor"   datos={por_worker}    color="#10b981" />
      )}
      {!hayDatos(por_categoria) && !hayDatos(por_proveedor) && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl px-5 py-8 text-center">
          <p className="text-sm text-gray-400">
            No hay datos de utilidad para este periodo.
            Revisa que los productos tengan costos registrados.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Gráfica de barras horizontal (wrapper de recharts) ────────────────────────

function GraficarBarras({ titulo, datos, color }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
        {titulo}
      </h2>
      <div className="bg-white border border-gray-200 rounded-2xl p-4">
        <ResponsiveContainer width="100%" height={datos.length > 5 ? 280 : 200}>
          <BarChart
            data={datos}
            layout="vertical"
            margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
            <XAxis
              type="number"
              tickFormatter={mxnCorto}
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="nombre"
              width={110}
              tick={{ fontSize: 12, fill: '#374151' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={mxnTooltip}
              contentStyle={{
                borderRadius: '12px',
                border: '1px solid #e5e7eb',
                fontSize: '13px',
              }}
              cursor={{ fill: '#fef3c7' }}
            />
            <Bar
              dataKey="utilidad"
              fill={color}
              radius={[0, 4, 4, 0]}
              maxBarSize={28}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
