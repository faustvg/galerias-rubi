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
import Layout from '../components/Layout'
import KpiTile from '../components/KpiTile'
import { FilaLista, ListaCard, ListaVacia } from '../components/FilaLista'
import GraficaBarras from '../components/GraficaBarras'
import {
  toISO, aMesInput, rangoMesActual, rangoMesPasado,
  rangoSemanaActual, rangoSemanaPasada, rangoSemanaDe, lunesDeLaSemana,
} from '../lib/periodos'


// ── Formateadores ──────────────────────────────────────────────────────────
const mxn = (n) =>
  Number(n).toLocaleString('es-MX', {
    style: 'currency', currency: 'MXN',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  })

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
      const [resR, utilR, gastoR, movR, cobrosR] = await Promise.all([
        apiFetch(`/dashboard/historico/resumen?${qs}`),
        apiFetch(`/dashboard/historico/utilidad?${qs}`),
        apiFetch(`/dashboard/gasto-restock/detalle?${qs}`),
        apiFetch(`/dashboard/movimientos-periodo?${qs}`),
        apiFetch(`/dashboard/cobros-periodo?${qs}`),
      ])
      if ([resR, utilR, gastoR, movR, cobrosR].some((r) => r.status === 401)) {
        await logout(); navigate('/login'); return
      }
      if (!resR.ok || !utilR.ok || !gastoR.ok || !movR.ok || !cobrosR.ok) {
        throw new Error('No se pudo cargar el histórico.')
      }
      setResumen(await resR.json())
      setUtilidad(await utilR.json())
      setGastoRestock(await gastoR.json())
      setMovimientos(await movR.json())
      setCobros(await cobrosR.json())
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
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Histórico</h1>
        <p className="text-sm text-gray-500 mt-0.5">
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
      <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 mb-5
                      flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0">
          Periodo
        </span>

        {/* Toggle Mes / Semana */}
        <div className="flex rounded-xl border border-gray-200 overflow-hidden shrink-0" role="group" aria-label="Tipo de periodo">
          {[
            { valor: 'mes',    etiqueta: 'Mes' },
            { valor: 'semana', etiqueta: 'Semana' },
          ].map(({ valor, etiqueta }) => (
            <button
              key={valor}
              onClick={() => cambiarTipoPeriodo(valor)}
              aria-pressed={tipoPeriodo === valor}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                tipoPeriodo === valor
                  ? 'bg-amber-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
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
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white
                       focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        ) : (
          <input
            type="date"
            value={semanaInput}
            max={toISO(new Date())}
            onChange={(e) => seleccionarSemana(e.target.value)}
            title="Elige cualquier día — se ajusta al lunes de esa semana"
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white
                       focus:outline-none focus:ring-2 focus:ring-amber-400"
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
          {/* ── 1. Franja de KPIs — 3 existentes + Inversión en restock + Balance ──
              Ronda de legibilidad: tarjetas neutrales, el color vive SOLO en
              el número cuando de verdad importa (Resta pendiente, Balance),
              nunca en la tarjeta entera — ver KpiTile.jsx. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-2">
            <KpiTile
              etiqueta="Ventas en el periodo"
              valor={mxn(resumen.total_ventas)}
              sub={`${resumen.num_notas} nota${resumen.num_notas !== 1 ? 's' : ''}`}
            />
            <KpiTile
              etiqueta="Resta pendiente"
              valor={mxn(resumen.resta_pendiente)}
              sub={`${resumen.num_notas_resta} nota${resumen.num_notas_resta !== 1 ? 's' : ''} sin cobrar`}
              acento={resumen.resta_pendiente > 0 ? 'rojo' : 'neutral'}
            />
            <KpiTile
              etiqueta="Entregas completadas"
              valor={`${resumen.entregadas.length}`}
              sub={resumen.entregadas.length > 0
                ? `Última: ${formatFecha(resumen.entregadas[0].fecha_entrega)}`
                : 'Ninguna en el periodo'}
            />
            <KpiTile
              etiqueta="Inversión en restock"
              valor={mxn(gastoRestock?.gasto_total ?? 0)}
              sub={movimientos ? `${movimientos.filter((m) => m.costo_total != null).length} entrada${movimientos.filter((m) => m.costo_total != null).length !== 1 ? 's' : ''} con costo` : ''}
            />
            <KpiTile
              etiqueta="Balance"
              valor={mxn(resumen.total_ventas - (gastoRestock?.gasto_total ?? 0))}
              sub="Ventas − inversión"
              acento={resumen.total_ventas - (gastoRestock?.gasto_total ?? 0) >= 0 ? 'verde' : 'rojo'}
            />
          </div>

          {/* Costos faltantes: el total de Inversión/Balance NO es exacto si
              hay entradas sin costo_unitario capturado — avisar en vez de
              mostrar un número que parece preciso y no lo es. */}
          {gastoRestock && gastoRestock.entradas_sin_costo > 0 && (
            <p className="text-xs text-gray-400 mb-6">
              {gastoRestock.entradas_sin_costo} entrada{gastoRestock.entradas_sin_costo !== 1 ? 's' : ''} sin costo registrado en este periodo
              — no {gastoRestock.entradas_sin_costo !== 1 ? 'están incluidas' : 'está incluida'} en Inversión ni en Balance.
            </p>
          )}

          {/* ── 2/3. Panel izquierdo (Notas) y derecho (gasto de restock) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <div className="space-y-6">
              <PanelEntregas entregadas={resumen.entregadas} />
              {utilidad && <PanelUtilidadCategoria por_categoria={utilidad.por_categoria} />}
            </div>
            <PanelRestock movimientos={movimientos} gastoTotal={gastoRestock?.gasto_total} />
          </div>

          {/* ── Cobros del periodo (Parte B, ronda 3) — dinero que entró de
              verdad en el periodo, por fecha de pago. Sección propia a lo
              ancho: es un concepto distinto tanto de "Notas" (izquierda)
              como de "Restock" (derecha), no encaja limpio en ninguno de
              los dos paneles. ── */}
          {cobros && <PanelCobros cobros={cobros} />}

          {/* ── Resto de desgloses de utilidad (proveedor/sucursal/vendedor) —
              sin cambios de posición, la Parte 5 solo pidió mover "por
              categoría" al panel izquierdo. ── */}
          {utilidad && <GraficasUtilidadResto utilidad={utilidad} es_worker={es_worker} />}

          {/* Nota de estimación */}
          <p className="text-xs text-gray-400 text-center mt-6 pb-4">
            * Los márgenes son estimados (basados en costos base del catálogo).
          </p>
        </>
      )}
    </Layout>
  )
}


// ── Panel izquierdo: entregas (Parte 5) ─────────────────────────────────────
// Filas de una sola línea vía FilaLista (compartida con Inicio y con el
// panel de restock, ver ../components/FilaLista.jsx) + "Ver todas" cuando
// hay más de LIMITE_VISIBLE — el pedido explícito de Faust de "apretar"
// esta lista, sin perder el detalle completo a un clic de distancia.

const LIMITE_VISIBLE_ENTREGAS = 5

function PanelEntregas({ entregadas }) {
  const [expandido, setExpandido] = useState(false)
  const visibles = expandido ? entregadas : entregadas.slice(0, LIMITE_VISIBLE_ENTREGAS)

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
        Entregas completadas en el periodo
      </h2>
      {entregadas.length === 0 ? (
        <ListaVacia mensaje="Ninguna entrega completada en este periodo." />
      ) : (
        <ListaCard>
          {visibles.map((e, i) => (
            <FilaLista
              key={e.folio}
              to={`/notas/${e.folio}`}
              titulo={e.etiqueta}
              meta={formatFecha(e.fecha_entrega)}
              derecha={mxn(e.total)}
              ultima={i === visibles.length - 1}
            />
          ))}
          {entregadas.length > LIMITE_VISIBLE_ENTREGAS && (
            <button
              onClick={() => setExpandido((v) => !v)}
              className="w-full text-center text-xs font-medium text-amber-700
                         hover:bg-amber-50 py-2 border-t border-gray-100 transition-colors"
            >
              {expandido ? 'Ver menos' : `Ver todas (${entregadas.length})`}
            </button>
          )}
        </ListaCard>
      )}
    </section>
  )
}

// ── Panel izquierdo: utilidad por categoría (Parte 5 — la única gráfica de
// utilidad que el brief pidió mover a este panel; el resto se queda donde
// estaba, ver GraficasUtilidadResto más abajo). ─────────────────────────────

function PanelUtilidadCategoria({ por_categoria }) {
  const hayDatos = por_categoria && por_categoria.some((d) => d.utilidad !== 0)
  if (hayDatos) {
    return <GraficaBarras titulo="Utilidad por categoría" datos={por_categoria} />
  }
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
        Utilidad por categoría
      </h2>
      <ListaVacia mensaje="Sin datos de utilidad por categoría en este periodo." />
    </section>
  )
}

// ── Panel derecho: gasto de restock del periodo (Parte 5) ───────────────────
// Misma fila compacta que "Entregas completadas" (FilaLista) — antes esta
// lista usaba dos líneas por entrada (nombre en negrita + fecha/cantidad/
// proveedor debajo), la única lista de la página con esa densidad distinta.
// Entradas sin costo se muestran con "—" en gris (nunca como $0).

function PanelRestock({ movimientos, gastoTotal }) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Gasto de restock en el periodo
        </h2>
        {gastoTotal != null && (
          <span className="text-sm font-bold text-gray-900 shrink-0">{mxn(gastoTotal)}</span>
        )}
      </div>
      {!movimientos || movimientos.length === 0 ? (
        <ListaVacia mensaje="Sin entradas de inventario en este periodo." />
      ) : (
        <div className="max-h-[420px] overflow-y-auto rounded-2xl">
          <ListaCard>
            {movimientos.map((m, i) => (
              <FilaLista
                key={m.id}
                titulo={m.nombre_producto}
                meta={`${formatFecha(m.fecha)} · +${m.cantidad} · ${m.nombre_proveedor || 'Sin proveedor'}`}
                derecha={m.costo_total != null
                  ? mxn(m.costo_total)
                  : <span className="text-gray-300">—</span>}
                ultima={i === movimientos.length - 1}
              />
            ))}
          </ListaCard>
        </div>
      )}
    </section>
  )
}

// ── Cobros del periodo (Parte B, ronda 3) ────────────────────────────────────
// Un renglón por PAGO (no por nota) — la misma nota puede aparecer más de
// una vez si recibió más de un abono en el periodo. "Pedido abierto"
// (fecha_entrega IS NULL y no cancelada) se marca con una etiqueta junto
// al nombre, para distinguir a simple vista un cobro de un pedido que ya
// se entregó de uno que sigue abierto — ver dashboard.py para la lógica.

function PanelCobros({ cobros }) {
  const { cobrado_total, pagos } = cobros
  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Cobros del periodo
        </h2>
        <span className="text-sm font-bold text-gray-900 shrink-0">{mxn(cobrado_total)}</span>
      </div>
      {pagos.length === 0 ? (
        <ListaVacia mensaje="Sin cobros registrados en este periodo." />
      ) : (
        <ListaCard>
          {pagos.map((p, i) => (
            <FilaLista
              key={p.id}
              to={`/notas/${p.folio}`}
              titulo={p.etiqueta}
              badge={p.pedido_abierto && (
                <span className="text-[10px] font-semibold uppercase tracking-wide
                                  text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full shrink-0">
                  Pedido abierto
                </span>
              )}
              meta={`${formatFecha(p.fecha)} · ${p.metodo}${p.tipo ? ` · ${p.tipo}` : ''}`}
              derecha={mxn(p.monto)}
              ultima={i === pagos.length - 1}
            />
          ))}
        </ListaCard>
      )}
    </section>
  )
}

// ── Resto de gráficas de utilidad (proveedor / sucursal / vendedor) ─────────
// Posición sin cambios respecto a antes de la Parte 5 — solo "por categoría"
// se movió al panel izquierdo (ver PanelUtilidadCategoria arriba).

function GraficasUtilidadResto({ utilidad, es_worker }) {
  const { por_proveedor, por_sucursal, por_worker } = utilidad
  const hayDatos = (arr) => arr && arr.some((d) => d.utilidad !== 0)
  const hayAlguna = hayDatos(por_proveedor) || hayDatos(por_sucursal) || (!es_worker && hayDatos(por_worker))
  if (!hayAlguna) return null

  return (
    <div className="space-y-6 mt-6">
      {hayDatos(por_proveedor) && (
        <GraficaBarras titulo="Utilidad por proveedor" datos={por_proveedor} />
      )}
      {hayDatos(por_sucursal) && (
        <GraficaBarras titulo="Utilidad por sucursal" datos={por_sucursal} />
      )}
      {!es_worker && hayDatos(por_worker) && (
        <GraficaBarras titulo="Utilidad por vendedor" datos={por_worker} />
      )}
    </div>
  )
}
