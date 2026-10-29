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
 *   Los rangos (semana ISO lun-dom, mes) se calculan en ../lib/periodos.js,
 *   no aquí — ese módulo tiene su propia prueba (periodos.test.js) porque
 *   ya hubo un bug real ahí: toISO() usaba Date.toISOString(), que corre la
 *   fecha un día en zonas UTC+, sin que la aritmética de "cuál es el lunes"
 *   en sí estuviera mal. Ver el comentario de cabecera de ese archivo.
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
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../api'
import {
  ResponsiveContainer, BarChart, Bar, Rectangle, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import Layout from '../components/Layout'
import { FilaLista, ListaVacia } from '../components/FilaLista'
import {
  toISO, aMesInput, rangoMesActual, rangoMesPasado,
  rangoSemanaActual, rangoSemanaPasada, rangoSemanaDe, lunesDeLaSemana,
  rangoAnterior,
} from '../lib/periodos'
import { COLORES_LOCAL } from '../lib/theme'


// ── Formateadores ──────────────────────────────────────────────────────────
const mxn = (n) =>
  Number(n).toLocaleString('es-MX', {
    style: 'currency', currency: 'MXN',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  })

const formatDiaCorto = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })

// Eje Y de las gráficas: $12k en vez de $12,000
const mxnCorto = (n) =>
  Math.abs(n) >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`

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
  // `periodo` es la fuente de verdad para el fetch, sin importar el tipo.
  // `tipoPeriodo` decide qué picker se muestra ("mes" = input[type=month],
  // "semana" = input[type=date] que se ajusta al lunes de la semana
  // elegida). `mesInput`/`semanaInput` sincronizan cada picker con su
  // propio formato — se guardan por separado para no perder la selección
  // de uno al usar el otro (si el usuario alterna Mes/Semana de un lado a
  // otro, cada picker recuerda su último valor).
  const [tipoPeriodo, setTipoPeriodo] = useState('mes')   // 'mes' | 'semana'
  const [periodo,     setPeriodo]     = useState(rangoMesActual)
  const [mesInput,    setMesInput]    = useState(() => aMesInput(new Date()))
  const [semanaInput, setSemanaInput] = useState(() => toISO(lunesDeLaSemana(new Date())))

  // ── Estado de datos ──────────────────────────────────────────────────────
  const [resumen,   setResumen]   = useState(null)
  const [utilidad,  setUtilidad]  = useState(null)
  // Parte 5 — Inversión en restock (KPI + nota de costos faltantes) y la
  // lista de entradas del periodo para el panel derecho.
  const [gastoRestock, setGastoRestock] = useState(null)
  const [movimientos,  setMovimientos]  = useState(null)
  // Parte B ronda 3 — Cobros del periodo: dinero que entró de verdad,
  // sumado por pagos.fecha (ver dashboard.py). Independiente de Ventas
  // en el periodo (que sigue siendo fecha_pedido) y Entregas (fecha_entrega).
  const [cobros, setCobros] = useState(null)
  // Ventas/cobros día por día (gráficas) — ver /dashboard/historico/serie.
  const [serie, setSerie] = useState(null)
  // Los mismos datos del periodo anterior (rangoAnterior en periodos.js),
  // solo para los ▲▼ % y la línea gris de comparación.
  const [anterior, setAnterior] = useState(null)
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
      const ant = rangoAnterior(periodo)
      const qsAnt = `fecha_desde=${ant.desde}&fecha_hasta=${ant.hasta}`
      const respuestas = await Promise.all([
        apiFetch(`/dashboard/historico/resumen?${qs}`),
        apiFetch(`/dashboard/historico/utilidad?${qs}`),
        apiFetch(`/dashboard/gasto-restock/detalle?${qs}`),
        apiFetch(`/dashboard/movimientos-periodo?${qs}`),
        apiFetch(`/dashboard/cobros-periodo?${qs}`),
        apiFetch(`/dashboard/historico/serie?${qs}`),
        apiFetch(`/dashboard/historico/resumen?${qsAnt}`),
        apiFetch(`/dashboard/historico/utilidad?${qsAnt}`),
        apiFetch(`/dashboard/gasto-restock/detalle?${qsAnt}`),
        apiFetch(`/dashboard/cobros-periodo?${qsAnt}`),
      ])
      if (respuestas.some((r) => r.status === 401)) {
        await logout(); navigate('/login'); return
      }
      if (respuestas.some((r) => !r.ok)) {
        throw new Error('No se pudo cargar el histórico.')
      }
      const [res, util, gasto, mov, cob, ser, resA, utilA, gastoA, cobA] =
        await Promise.all(respuestas.map((r) => r.json()))
      setResumen(res)
      setUtilidad(util)
      setGastoRestock(gasto)
      setMovimientos(mov)
      setCobros(cob)
      setSerie(ser)
      setAnterior({
        rango: ant, resumen: resA, utilidad: utilA, gastoRestock: gastoA,
        cobros: cobA,
      })
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

  // valor = "2026-06-17" desde <input type="date"> — cualquier día de la
  // semana elegida; se ajusta al lunes de esa semana ISO (Parte 4).
  function seleccionarSemana(valor) {
    if (!valor) return
    const lunes = lunesDeLaSemana(new Date(valor + 'T00:00:00'))
    setSemanaInput(toISO(lunes))
    setPeriodo(rangoSemanaDe(lunes))
  }

  function aplicarAtajo(rango, nuevoMesInput = '') {
    setPeriodo(rango)
    setMesInput(nuevoMesInput)
  }

  function aplicarAtajoSemana(rango) {
    setPeriodo(rango)
    setSemanaInput(rango.desde)
  }

  // Alternar Mes/Semana recalcula el periodo al tipo actual (mes actual o
  // semana actual) — evita quedar con un picker mostrando "julio" mientras
  // `periodo` sigue siendo la semana que se había elegido antes de alternar.
  function cambiarTipoPeriodo(tipo) {
    setTipoPeriodo(tipo)
    if (tipo === 'mes') {
      const r = rangoMesActual()
      aplicarAtajo(r, r.desde.slice(0, 7))
    } else {
      aplicarAtajoSemana(rangoSemanaActual())
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Layout>
      {/* ── Encabezado ── */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="font-serif text-4xl font-semibold text-gray-900 leading-none">Histórico</h1>
        <p className="text-sm text-gray-500 mt-2">
          {es_worker
            ? `Tus resultados — ${labelPeriodo(periodo)}`
            : `Resultados del negocio — ${labelPeriodo(periodo)}`}
        </p>
      </div>

      {/* ── Selector de periodo ───────────────────────────────────────────────
          El toggle Mes/Semana decide qué picker se muestra y qué atajos
          aparecen. input[type="month"] da "YYYY-MM"; el input[type="date"]
          de semana acepta cualquier día y seleccionarSemana() lo ajusta al
          lunes de esa semana ISO — el input SIEMPRE refleja ese lunes
          después de elegir, nunca el día que el usuario tocó al azar. */}
      <div className="flex flex-wrap items-center gap-2">

        {/* Toggle Mes / Semana */}
        <div className="flex rounded-full bg-gray-200/60 p-1 shrink-0" role="group" aria-label="Tipo de periodo">
          {[
            { valor: 'mes',    etiqueta: 'Mes' },
            { valor: 'semana', etiqueta: 'Semana' },
          ].map(({ valor, etiqueta }) => (
            <button
              key={valor}
              onClick={() => cambiarTipoPeriodo(valor)}
              aria-pressed={tipoPeriodo === valor}
              className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all ${
                tipoPeriodo === valor
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {etiqueta}
            </button>
          ))}
        </div>

        {tipoPeriodo === 'mes' ? (
          <input
            type="month"
            value={mesInput}
            max={aMesInput(new Date())}
            onChange={(e) => seleccionarMes(e.target.value)}
            className="border border-gray-200 rounded-full px-4 py-2 text-sm bg-white text-gray-800
                       focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        ) : (
          <input
            type="date"
            value={semanaInput}
            max={toISO(new Date())}
            onChange={(e) => seleccionarSemana(e.target.value)}
            title="Elige cualquier día — se ajusta al lunes de esa semana"
            className="border border-gray-200 rounded-full px-4 py-2 text-sm bg-white text-gray-800
                       focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        )}

        <div className="flex gap-2 flex-wrap">
          {(tipoPeriodo === 'mes'
            ? [
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
              ]
            : [
                { label: 'Semana pasada', fn: () => aplicarAtajoSemana(rangoSemanaPasada()) },
                { label: 'Semana actual', fn: () => aplicarAtajoSemana(rangoSemanaActual()) },
              ]
          ).map(({ label, fn }) => (
            <button
              key={label}
              onClick={fn}
              className="text-sm px-4 py-2 rounded-full border border-gray-200 bg-white
                         text-gray-600 hover:border-amber-300 hover:text-amber-700
                         transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
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

      {!cargando && resumen && anterior && (
        <>
          {/* ── Distribución (rediseño oct 2026, estilo "dashboard"):
                1. Franja de KPIs que no tienen gráfica propia
                2. Tres columnas: cada gráfica grande con SU lista debajo
                   (Ventas → Entregas, Cobros → Cobros, Restock → Gasto)
                3. Utilidades, lado a lado, hasta abajo
              Cada número se compara contra el periodo anterior
              (rangoAnterior) — sin esa referencia un "$62,500" no dice si
              el mes fue bueno o malo. "Balance" (ventas − inversión) se
              quitó: confundía, y Utilidad estimada es la cifra útil. ── */}

          {/* ── 1. KPIs ──
              Resta pendiente no lleva comparación: se calcula sobre las
              notas del periodo que SIGUEN abiertas hoy, así que un periodo
              viejo siempre "gana" (ya se cobró) y el % engañaría. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <TarjetaKpi
              etiqueta="Resta pendiente"
              valor={mxn(resumen.resta_pendiente)}
              sub={`${resumen.num_notas_resta} nota${resumen.num_notas_resta !== 1 ? 's' : ''} sin cobrar`}
            />
            <TarjetaKpi
              etiqueta="Entregas completadas"
              valor={`${resumen.entregadas.length}`}
              delta={<Delta actual={resumen.entregadas.length} previo={anterior.resumen.entregadas.length} modo="cantidad" />}
              sub={`Periodo anterior: ${anterior.resumen.entregadas.length}`}
            />
            <TarjetaKpi
              etiqueta="Utilidad estimada"
              valor={mxn(sumaUtilidad(utilidad))}
              delta={<Delta actual={sumaUtilidad(utilidad)} previo={sumaUtilidad(anterior.utilidad)} />}
              sub={`Periodo anterior: ${mxn(sumaUtilidad(anterior.utilidad))}`}
            />
          </div>

          {/* ── 2. Columnas gráfica + lista ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="space-y-4 min-w-0">
              <TarjetaGrafica
                titulo="Ventas"
                actual={resumen.total_ventas}
                previo={anterior.resumen.total_ventas}
                sub={`${resumen.num_notas} nota${resumen.num_notas !== 1 ? 's' : ''}`}
                serie={serie}
                clave="ventas"
                rangoAnterior={anterior.rango}
              />
              <PanelEntregas entregadas={resumen.entregadas} />
            </div>
            <div className="space-y-4 min-w-0">
              <TarjetaGrafica
                titulo="Cobros"
                actual={cobros.cobrado_total}
                previo={anterior.cobros.cobrado_total}
                sub={`${cobros.pagos.length} pago${cobros.pagos.length !== 1 ? 's' : ''}`}
                serie={serie}
                clave="cobros"
                rangoAnterior={anterior.rango}
              />
              <PanelCobros cobros={cobros} />
            </div>
            <div className="space-y-4 min-w-0">
              {/* Restock: subir no es ni bueno ni malo → Δ en gris (neutral). */}
              <TarjetaGrafica
                titulo="Gasto de restock"
                actual={gastoRestock?.gasto_total ?? 0}
                previo={anterior.gastoRestock?.gasto_total ?? 0}
                sub={(() => {
                  const n = (movimientos || []).length
                  return `${n} entrada${n !== 1 ? 's' : ''}`
                })()}
                serie={serie}
                clave="restock"
                rangoAnterior={anterior.rango}
                neutral
                aviso={gastoRestock?.entradas_sin_costo > 0
                  // El total NO es exacto si hay entradas sin costo_unitario
                  // capturado — avisar en vez de aparentar precisión.
                  ? `${gastoRestock.entradas_sin_costo} entrada${gastoRestock.entradas_sin_costo !== 1 ? 's' : ''} sin costo, no incluida${gastoRestock.entradas_sin_costo !== 1 ? 's' : ''}`
                  : null}
              />
              <PanelRestock movimientos={movimientos} />
            </div>
          </div>

          {/* ── 3. Utilidades ── */}
          <SeccionUtilidades utilidad={utilidad} anterior={anterior.utilidad} es_worker={es_worker} />

          <p className="text-xs text-gray-400 text-center mt-6 pb-4">
            Comparación contra {labelPeriodo(anterior.rango)}.
            Las utilidades son estimadas (precio base − costo del catálogo).
          </p>
        </>
      )}
    </Layout>
  )
}


// ── Piezas compartidas del layout ────────────────────────────────────────────

// Todas las secciones son la misma tarjeta blanca con el título adentro
// (no flotando encima) — es lo que da el aspecto de "tablero" ordenado.
function Tarjeta({ titulo, derecha, children, className = '' }) {
  return (
    <section className={`bg-white rounded-2xl border border-gray-200/60 shadow-card overflow-hidden ${className}`}>
      {titulo && (
        <div className="flex items-baseline justify-between gap-2 px-4 pt-3.5 pb-2.5">
          <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.14em]">{titulo}</h2>
          {derecha != null && <span className="text-sm font-bold text-gray-900 shrink-0">{derecha}</span>}
        </div>
      )}
      {children}
    </section>
  )
}

const sumaUtilidad = (u) =>
  (u?.por_categoria || []).reduce((s, d) => s + Number(d.utilidad || 0), 0)

// ▲ 12% / ▼ 8% contra el periodo anterior.
//   modo="cantidad" → diferencia absoluta (▲ 1), para conteos chicos donde
//                     un % (de 2 a 3 = +50%) exagera.
//   neutral         → gris en vez de verde/rojo (gastar más en restock no
//                     es ni bueno ni malo por sí mismo).
// Sin dato anterior (0) no hay % que calcular: se muestra "Nuevo" si hoy
// hay algo, o nada.
function Delta({ actual, previo, modo = 'pct', neutral = false }) {
  const a = Number(actual || 0)
  const p = Number(previo || 0)
  if (a === p) {
    return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">=</span>
  }
  if (p === 0 && modo === 'pct') {
    return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Nuevo</span>
  }
  const sube = a > p
  const texto = modo === 'cantidad'
    ? `${Math.abs(a - p)}`
    : `${Math.round(Math.abs((a - p) / p) * 100)}%`
  const color = neutral
    ? 'bg-gray-100 text-gray-600'
    : sube ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${color}`}>
      <span aria-hidden="true">{sube ? '▲' : '▼'}</span>
      <span className="sr-only">{sube ? 'Sube' : 'Baja'}</span>
      {texto}
    </span>
  )
}


// ── 1. Tarjeta grande con gráfica (Ventas / Cobros / Restock) ─────────────
// Columnas apiladas por local: cada columna es un día, una semana o un mes
// (según el largo del periodo, ver agrupacionDe) y cada color un local. La
// comparación contra el periodo anterior vive en el número grande y su Δ.

// Colores por local: ver COLORES_LOCAL en lib/theme.js.
const COLOR_OTRO = '#A98F74'        // camel (--accent2 del sitio)
const COLOR_SIN_LOCAL = '#D5CCBD'   // gray-300
const ORDEN_LOCALES = Object.keys(COLORES_LOCAL)

function colorLocal(nombre) {
  if (nombre === 'Sin local') return COLOR_SIN_LOCAL
  return COLORES_LOCAL[nombre] ?? COLOR_OTRO
}

// Locales con algún monto en el periodo actual, en orden fijo (los
// conocidos primero, 'Sin local' al final).
function localesDeSerie(serie, clave) {
  const vistos = new Set()
  for (const d of serie) {
    for (const [local, monto] of Object.entries(d[`${clave}_local`] || {})) {
      if (monto) vistos.add(local)
    }
  }
  const rango = (n) => n === 'Sin local' ? 999 : (ORDEN_LOCALES.indexOf(n) + 1 || 500)
  return [...vistos].sort((a, b) => rango(a) - rango(b) || a.localeCompare(b))
}

// Periodo corto → columnas por día; un mes → por semana; más → por mes.
function agrupacionDe(dias) {
  if (dias <= 14) return 'dia'
  if (dias <= 92) return 'semana'
  return 'mes'
}

function claveGrupo(iso, agrupacion) {
  if (agrupacion === 'dia') return iso
  if (agrupacion === 'mes') return iso.slice(0, 7)
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))   // lunes de esa semana
  return toISO(d)
}

function etiquetaGrupo(grupo, agrupacion) {
  if (agrupacion === 'mes') {
    return new Date(grupo + '-01T00:00:00').toLocaleDateString('es-MX', { month: 'short' })
  }
  return formatDiaCorto(grupo)
}

function construirColumnas(serie, clave, locales) {
  const agrupacion = agrupacionDe(serie.length)
  const columnas = []
  const porGrupo = {}
  for (const d of serie) {
    const g = claveGrupo(d.fecha, agrupacion)
    let col = porGrupo[g]
    if (!col) {
      col = { etiqueta: etiquetaGrupo(g, agrupacion), desde: d.fecha, hasta: d.fecha, total: 0, agrupacion }
      for (const l of locales) col[`local:${l}`] = 0
      porGrupo[g] = col
      columnas.push(col)
    }
    col.hasta = d.fecha
    col.total += d[clave]
    for (const l of locales) col[`local:${l}`] += d[`${clave}_local`]?.[l] || 0
  }
  // El segmento de hasta arriba de cada columna es el que lleva las
  // esquinas redondeadas (ver BarraSegmento).
  for (const col of columnas) {
    col.tope = [...locales].reverse().find((l) => col[`local:${l}`] > 0) ?? null
  }
  return columnas
}

function BarraSegmento({ local, ...props }) {
  const esTope = props.payload?.tope === local
  return <Rectangle {...props} radius={esTope ? [6, 6, 0, 0] : 0} />
}

function TooltipGrafica({ active, payload, locales }) {
  if (!active || !payload?.length) return null
  const c = payload[0].payload
  const titulo = c.agrupacion === 'dia' || c.desde === c.hasta
    ? formatDiaCorto(c.desde)
    : `${formatDiaCorto(c.desde)} – ${formatDiaCorto(c.hasta)}`
  const conMonto = [...locales].reverse().filter((l) => c[`local:${l}`] > 0)
  return (
    <div className="bg-white/95 backdrop-blur border border-gray-200/70 rounded-xl px-3 py-2.5 text-xs shadow-card min-w-40">
      <p className="text-gray-400">{titulo}</p>
      <p className="text-gray-900 font-semibold text-sm">{mxn(c.total)}</p>
      {conMonto.length > 1 && conMonto.map((l) => (
        <p key={l} className="flex items-center gap-1.5 text-gray-600 mt-0.5">
          <span className="w-2 h-2 rounded-sm" style={{ background: colorLocal(l) }} aria-hidden="true" />
          <span className="flex-1">{l}</span>
          <span className="font-medium text-gray-900 tabular-nums">{mxn(c[`local:${l}`])}</span>
        </p>
      ))}
      {conMonto.length === 1 && <p className="text-gray-500 mt-0.5">{conMonto[0]}</p>}
    </div>
  )
}

function TarjetaGrafica({ titulo, actual, previo, sub, serie, clave, rangoAnterior, neutral = false, aviso = null }) {
  const locales = localesDeSerie(serie || [], clave)
  const columnas = construirColumnas(serie || [], clave, locales)
  const hayDatos = columnas.some((c) => c.total)

  return (
    <section className="bg-white rounded-2xl border border-gray-200/60 shadow-card px-5 pt-4 pb-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.14em]">{titulo}</h2>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-[2rem] font-semibold tracking-tight tabular-nums text-gray-900 leading-tight">{mxn(actual)}</p>
            <Delta actual={actual} previo={previo} neutral={neutral} />
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {sub} · {labelPeriodo(rangoAnterior)}: {mxn(previo)}
          </p>
          {aviso && <p className="text-xs text-amber-700 mt-0.5">{aviso}</p>}
        </div>
      </div>

      <div className="h-44 mt-3 -ml-2">
        {hayDatos ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={columnas} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="#F3EFE8" strokeDasharray="2 4" />
              <XAxis
                dataKey="etiqueta"
                tick={{ fontSize: 10, fill: '#ABA092' }}
                axisLine={false} tickLine={false}
                interval="preserveStartEnd" minTickGap={8}
              />
              <YAxis
                tickFormatter={mxnCorto}
                tick={{ fontSize: 10, fill: '#ABA092' }}
                axisLine={false} tickLine={false} width={44}
              />
              <Tooltip
                content={<TooltipGrafica locales={locales} />}
                cursor={{ fill: '#F3EFE8', radius: 8 }}
              />
              {locales.map((l) => (
                <Bar
                  key={l}
                  dataKey={`local:${l}`} stackId="locales"
                  fill={colorLocal(l)} maxBarSize={28}
                  shape={<BarraSegmento local={l} />}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-gray-400">
            Sin movimientos en este periodo.
          </div>
        )}
      </div>

      {locales.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-gray-500 mt-1">
          {locales.map((l) => (
            <span key={l} className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colorLocal(l) }} aria-hidden="true" />
              {l}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}


// ── 2. KPI secundario ────────────────────────────────────────────────────────

function TarjetaKpi({ etiqueta, valor, delta, sub }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200/60 shadow-card px-5 py-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 mb-1.5">{etiqueta}</p>
      <div className="flex items-center gap-2">
        <p className="text-[1.75rem] font-semibold tracking-tight tabular-nums text-gray-900 leading-tight">{valor}</p>
        {delta}
      </div>
      {sub && <p className="text-xs mt-1 text-gray-400">{sub}</p>}
    </div>
  )
}


// ── 3. Listas de detalle ─────────────────────────────────────────────────────
// Filas de una sola línea vía FilaLista (compartida con Inicio) + "Ver
// todas" cuando hay más de LIMITE_VISIBLE.

const LIMITE_VISIBLE = 5

function BotonVerTodas({ total, expandido, onClick }) {
  if (total <= LIMITE_VISIBLE) return null
  return (
    <button
      onClick={onClick}
      className="w-full text-center text-xs font-medium text-amber-700
                 hover:bg-amber-50 py-2 border-t border-gray-100 transition-colors"
    >
      {expandido ? 'Ver menos' : `Ver todas (${total})`}
    </button>
  )
}

function SinFilas({ mensaje }) {
  return <p className="text-xs text-gray-400 px-4 pb-4">{mensaje}</p>
}

function PanelEntregas({ entregadas }) {
  const [expandido, setExpandido] = useState(false)
  const visibles = expandido ? entregadas : entregadas.slice(0, LIMITE_VISIBLE)
  const total = entregadas.reduce((s, e) => s + Number(e.total || 0), 0)

  return (
    <Tarjeta titulo="Entregas completadas" derecha={entregadas.length ? mxn(total) : null}>
      {entregadas.length === 0 ? (
        <SinFilas mensaje="Ninguna entrega completada en este periodo." />
      ) : (
        <div className="border-t border-gray-100">
          {visibles.map((e, i) => (
            <FilaLista
              key={e.folio}
              to={`/notas/${e.folio}`}
              titulo={e.etiqueta}
              derecha={mxn(e.total)}
              derechaSub={<span className="text-gray-400">{formatDiaCorto(e.fecha_entrega)}</span>}
              ultima={i === visibles.length - 1}
            />
          ))}
          <BotonVerTodas total={entregadas.length} expandido={expandido} onClick={() => setExpandido((v) => !v)} />
        </div>
      )}
    </Tarjeta>
  )
}

// Entradas sin costo se muestran con "—" en gris (nunca como $0).
function PanelRestock({ movimientos }) {
  const [expandido, setExpandido] = useState(false)
  const lista = movimientos || []
  const visibles = expandido ? lista : lista.slice(0, LIMITE_VISIBLE)

  return (
    <Tarjeta titulo="Entradas de inventario">
      {lista.length === 0 ? (
        <SinFilas mensaje="Sin entradas de inventario en este periodo." />
      ) : (
        <div className="border-t border-gray-100">
          {visibles.map((m, i) => (
            <FilaLista
              key={m.id}
              titulo={m.nombre_producto}
              derecha={m.costo_total != null
                ? mxn(m.costo_total)
                : <span className="text-gray-300">—</span>}
              derechaSub={<span className="text-gray-400">{formatDiaCorto(m.fecha)} · +{m.cantidad}</span>}
              ultima={i === visibles.length - 1}
            />
          ))}
          <BotonVerTodas total={lista.length} expandido={expandido} onClick={() => setExpandido((v) => !v)} />
        </div>
      )}
    </Tarjeta>
  )
}

// Un renglón por PAGO (no por nota) — la misma nota puede aparecer más de
// una vez si recibió más de un abono en el periodo. "Pedido abierto"
// (fecha_entrega IS NULL y no cancelada) se marca junto al nombre — ver
// dashboard.py para la lógica.
//
// tipo es texto libre y opcional en la tabla pagos (ver TIPOS_PAGO en
// NotaFormulario.jsx) — un pago sin tipo cae en "sin_tipo", no se descarta.
// Colores muteados y DISTINTOS del acento de marca (amber, ya usado por
// "Pedido abierto") a propósito: es diferenciación categórica real.
const TIPO_INFO = {
  anticipo:    { etiqueta: 'Anticipos',     singular: 'Anticipo',     dot: 'bg-blue-400',    badge: 'text-blue-700 bg-blue-50' },
  abono:       { etiqueta: 'Abonos',        singular: 'Abono',        dot: 'bg-purple-400',  badge: 'text-purple-700 bg-purple-50' },
  liquidacion: { etiqueta: 'Liquidaciones', singular: 'Liquidación',  dot: 'bg-emerald-400', badge: 'text-emerald-700 bg-emerald-50' },
  sin_tipo:    { etiqueta: 'Sin tipo',      singular: 'Sin tipo',     dot: 'bg-gray-300',    badge: 'text-gray-500 bg-gray-100' },
}
const ORDEN_TIPOS = ['anticipo', 'abono', 'liquidacion', 'sin_tipo']

function PanelCobros({ cobros }) {
  const [expandido, setExpandido] = useState(false)
  const { pagos } = cobros
  const visibles = expandido ? pagos : pagos.slice(0, LIMITE_VISIBLE)

  // Subtotal por tipo, calculado desde `pagos` (el endpoint ya trae el
  // tipo de cada pago). Solo los tipos que de verdad tienen algo.
  const sumaPorTipo = {}
  for (const p of pagos) {
    const clave = p.tipo || 'sin_tipo'
    sumaPorTipo[clave] = (sumaPorTipo[clave] || 0) + Number(p.monto)
  }
  const subtotales = ORDEN_TIPOS
    .filter((t) => sumaPorTipo[t])
    .map((t) => ({ tipo: t, monto: sumaPorTipo[t], ...TIPO_INFO[t] }))

  return (
    <Tarjeta titulo="Pagos recibidos">
      {subtotales.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 px-4 -mt-1 pb-2.5">
          {subtotales.map((s) => (
            <span key={s.tipo} className="inline-flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
              {s.etiqueta}: <span className="font-semibold text-gray-700">{mxn(s.monto)}</span>
            </span>
          ))}
        </div>
      )}

      {pagos.length === 0 ? (
        <SinFilas mensaje="Sin cobros registrados en este periodo." />
      ) : (
        <div className="border-t border-gray-100">
          {visibles.map((p, i) => {
            const info = TIPO_INFO[p.tipo || 'sin_tipo']
            return (
              <FilaLista
                key={p.id}
                to={`/notas/${p.folio}`}
                titulo={p.etiqueta}
                badge={
                  <span className="inline-flex items-center gap-1.5 shrink-0">
                    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${info.badge}`}>
                      {info.singular}
                    </span>
                    {p.pedido_abierto && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide
                                        text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full">
                        Pedido abierto
                      </span>
                    )}
                  </span>
                }
                derecha={mxn(p.monto)}
                derechaSub={<span className="text-gray-400">{formatDiaCorto(p.fecha)} · {p.metodo}</span>}
                ultima={i === visibles.length - 1}
              />
            )
          })}
          <BotonVerTodas total={pagos.length} expandido={expandido} onClick={() => setExpandido((v) => !v)} />
        </div>
      )}
    </Tarjeta>
  )
}


// ── 4. Utilidades — tablas compactas lado a lado ─────────────────────────────
// Nombre | Utilidad | Δ contra el periodo anterior (emparejado por nombre).
// Filas en $0 en ambos periodos se descartan; una tabla sin filas no se
// muestra. Por vendedor solo para admin+ (el endpoint ya no la manda a
// workers).

function TablaUtilidad({ titulo, filas, filasAnt }) {
  const previoPorNombre = Object.fromEntries((filasAnt || []).map((d) => [d.nombre, d.utilidad]))
  const lista = (filas || []).filter((d) => d.utilidad !== 0)
  if (lista.length === 0) return null
  const total = lista.reduce((s, d) => s + d.utilidad, 0)

  return (
    <Tarjeta titulo={titulo}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] text-gray-400 border-t border-gray-100">
            <th className="text-left font-medium px-4 py-1.5">Nombre</th>
            <th className="text-right font-medium px-2 py-1.5">Utilidad</th>
            <th className="text-right font-medium px-4 py-1.5 w-16">Δ</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((d) => (
            <tr key={d.nombre} className="border-t border-gray-100">
              <td className="px-4 py-2 text-gray-700">
                <span className="block truncate max-w-[12rem]">{d.nombre}</span>
                {total > 0 && (
                  <span className="text-[11px] text-gray-400">{Math.round((d.utilidad / total) * 100)}% del total</span>
                )}
              </td>
              <td className="px-2 py-2 text-right font-semibold text-gray-900 whitespace-nowrap">{mxn(d.utilidad)}</td>
              <td className="px-4 py-2 text-right">
                <Delta actual={d.utilidad} previo={previoPorNombre[d.nombre] ?? 0} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Tarjeta>
  )
}

function SeccionUtilidades({ utilidad, anterior, es_worker }) {
  const tablas = [
    { titulo: 'Utilidad por categoría', clave: 'por_categoria' },
    { titulo: 'Utilidad por proveedor', clave: 'por_proveedor' },
    { titulo: 'Utilidad por local',     clave: 'por_local' },
    ...(!es_worker ? [{ titulo: 'Utilidad por vendedor', clave: 'por_worker' }] : []),
  ].filter((t) => (utilidad?.[t.clave] || []).some((d) => d.utilidad !== 0))

  if (tablas.length === 0) {
    return (
      <div className="mt-4">
        <ListaVacia mensaje="Sin datos de utilidad en este periodo." />
      </div>
    )
  }

  return (
    <>
    <h2 className="font-serif text-2xl font-semibold text-gray-900 mt-10 mb-3">Rentabilidad</h2>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
      {tablas.map((t) => (
        <TablaUtilidad
          key={t.clave}
          titulo={t.titulo}
          filas={utilidad[t.clave]}
          filasAnt={anterior?.[t.clave]}
        />
      ))}
    </div>
    </>
  )
}
