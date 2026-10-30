/**
 * Tablero.jsx — Piezas visuales compartidas por Inicio (Dashboard.jsx) e
 * Histórico (Historico.jsx): tarjetas, Δ contra el periodo anterior, la
 * gráfica de columnas apiladas por local y la tabla de utilidad. Así las
 * dos pantallas se ven igual y un cambio de estilo se hace una sola vez.
 */

import {
  ResponsiveContainer, BarChart, Bar, Rectangle, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { toISO } from '../lib/periodos'
import { COLORES_LOCAL } from '../lib/theme'

// ── Formateadores ──────────────────────────────────────────────────────────
export const mxn = (n) =>
  Number(n).toLocaleString('es-MX', {
    style: 'currency', currency: 'MXN',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  })

export const formatDiaCorto = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })

// Eje Y de las gráficas: $12k en vez de $12,000
export const mxnCorto = (n) =>
  Math.abs(n) >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`


// Todas las secciones son la misma tarjeta blanca con el título adentro
// (no flotando encima) — es lo que da el aspecto de "tablero" ordenado.
export function Tarjeta({ titulo, derecha, children, className = '' }) {
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

// ▲ 12% / ▼ 8% contra el periodo anterior.
//   modo="cantidad" → diferencia absoluta (▲ 1), para conteos chicos donde
//                     un % (de 2 a 3 = +50%) exagera.
//   neutral         → gris en vez de verde/rojo (gastar más en restock no
//                     es ni bueno ni malo por sí mismo).
// Sin dato anterior (0) no hay % que calcular: se muestra "Nuevo" si hoy
// hay algo, o nada.
export function Delta({ actual, previo, modo = 'pct', neutral = false }) {
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

export function colorLocal(nombre) {
  if (nombre === 'Sin local') return COLOR_SIN_LOCAL
  return COLORES_LOCAL[nombre] ?? COLOR_OTRO
}

// Locales con algún monto en el periodo actual, en orden fijo (los
// conocidos primero, 'Sin local' al final).
export function localesDeSerie(serie, clave) {
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
export function agrupacionDe(dias) {
  if (dias <= 14) return 'dia'
  if (dias <= 92) return 'semana'
  return 'mes'
}

export function claveGrupo(iso, agrupacion) {
  if (agrupacion === 'dia') return iso
  if (agrupacion === 'mes') return iso.slice(0, 7)
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))   // lunes de esa semana
  return toISO(d)
}

export function etiquetaGrupo(grupo, agrupacion) {
  if (agrupacion === 'mes') {
    return new Date(grupo + '-01T00:00:00').toLocaleDateString('es-MX', { month: 'short' })
  }
  return formatDiaCorto(grupo)
}

export function construirColumnas(serie, clave, locales) {
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

export function BarraSegmento({ local, ...props }) {
  const esTope = props.payload?.tope === local
  return <Rectangle {...props} radius={esTope ? [6, 6, 0, 0] : 0} />
}

export function TooltipGrafica({ active, payload, locales }) {
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

export function TarjetaGrafica({ titulo, actual, previo, sub, serie, clave, etiquetaPrevio, neutral = false, aviso = null }) {
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
            {sub} · {etiquetaPrevio}: {mxn(previo)}
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

export function TarjetaKpi({ etiqueta, valor, delta, sub }) {
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



// ── Utilidad — tabla compacta ───────────────────────────────────────────────

// Sin filasAnt (p. ej. en Inicio, que no compara periodos) no hay columna Δ.
export function TablaUtilidad({ titulo, filas, filasAnt }) {
  const conDelta = filasAnt != null
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
            {conDelta && <th className="text-right font-medium px-4 py-1.5 w-16">Δ</th>}
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
              <td className="px-2 pr-4 py-2 text-right font-semibold text-gray-900 whitespace-nowrap">{mxn(d.utilidad)}</td>
              {conDelta && (
                <td className="px-4 py-2 text-right">
                  <Delta actual={d.utilidad} previo={previoPorNombre[d.nombre] ?? 0} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Tarjeta>
  )
}
