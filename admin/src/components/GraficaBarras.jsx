/**
 * GraficaBarras.jsx — Envoltorio de recharts compartido (Inicio +
 * Histórico). SIEMPRE usa el acento único de marca (ver ../lib/theme.js).
 *
 * Antes, cada desglose de utilidad (categoría/proveedor/sucursal/vendedor)
 * tenía su propio color -- naranja, índigo, rosa, verde -- así que las 4
 * gráficas de una misma sección leían como widgets de apps distintas en
 * vez de una sola vista coherente. Faust lo pidió explícito: un solo
 * acento en toda la app, no un color por gráfica.
 */
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { ACENTO_HEX } from '../lib/theme'

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

// datos = [{ nombre: string, [valorKey]: number }]
export default function GraficaBarras({ titulo, datos, valorKey = 'utilidad', etiquetaTooltip = 'Utilidad estimada' }) {
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
              formatter={(v) => [mxn(v), etiquetaTooltip]}
              contentStyle={{
                borderRadius: '12px',
                border: '1px solid #e5e7eb',
                fontSize: '13px',
              }}
              cursor={{ fill: '#fef3c7' }}
            />
            <Bar
              dataKey={valorKey}
              fill={ACENTO_HEX}
              radius={[0, 4, 4, 0]}
              maxBarSize={28}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
