/**
 * KpiTile.jsx — Tarjeta de KPI compartida (Inicio + Histórico).
 *
 * Antes cada página tenía su propia versión (KpiCard), y cada una teñía
 * TODA la tarjeta según un color por tarjeta (bg-amber-50/border-amber-200
 * para Ventas, bg-red-50 para Resta pendiente, etc.) — con 5-6 tarjetas
 * pastel de colores distintos una junto a otra, ninguna se leía como "la
 * importante". Ahora: fondo blanco neutral SIEMPRE, número grande y
 * oscuro (alto contraste) SIEMPRE — `acento` tiñe SOLO el número, nunca
 * la tarjeta entera, y solo para el caso que de verdad lo necesita (ej.
 * Balance en rojo cuando es negativo, Resta pendiente en rojo si > 0).
 */
const COLOR_VALOR = {
  neutral: 'text-gray-900',
  verde:   'text-green-700',
  rojo:    'text-red-700',
}

export default function KpiTile({ etiqueta, valor, sub, acento = 'neutral' }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
        {etiqueta}
      </p>
      <p className={`text-2xl font-bold leading-tight ${COLOR_VALOR[acento] ?? COLOR_VALOR.neutral}`}>
        {valor}
      </p>
      {sub && <p className="text-xs mt-1 text-gray-400">{sub}</p>}
    </div>
  )
}
