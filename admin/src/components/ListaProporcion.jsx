/**
 * ListaProporcion.jsx — Desglose "nombre — monto" con una barra de
 * proporción sutil detrás del texto, en vez de una gráfica de barras
 * formal (ejes, grid, tooltip). Reemplaza a GraficaBarras para los
 * desgloses de utilidad (Histórico + Inicio) — ronda 5, #4.
 *
 * Por qué: el público real de estas pantallas (los papás de Faust) no
 * lee gráficas seguido, y con listas cortas (2-5 categorías, lo típico
 * aquí) un eje numerado con grid y tooltip no ayuda a leer más rápido
 * que una lista ordenada de mayor a menor — solo agrega "chrome" visual
 * que hay que aprender a ignorar.
 *
 * Filas con valor 0 se descartan aquí mismo, no solo a nivel de "mostrar
 * la sección completa o no": antes una categoría en $0 dentro de una
 * lista con datos SÍ se renderizaba, como una barra de longitud cero o
 * ausente — que se lee como un glitch, no como "sin datos en esa
 * categoría". El componente devuelve null si no queda ninguna fila.
 */
const mxn = (n) =>
  Number(n).toLocaleString('es-MX', {
    style: 'currency', currency: 'MXN',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  })

export default function ListaProporcion({ datos, valorKey = 'utilidad' }) {
  const filas = (datos || []).filter((d) => d[valorKey] !== 0 && d[valorKey] != null)
  if (filas.length === 0) return null

  const max = Math.max(...filas.map((d) => Math.abs(d[valorKey])))

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-2 space-y-1">
      {filas.map((d) => (
        <div key={d.nombre} className="relative overflow-hidden rounded-lg">
          <div
            className="absolute inset-y-0 left-0 bg-amber-50"
            style={{ width: `${Math.max(4, (Math.abs(d[valorKey]) / max) * 100)}%` }}
            aria-hidden="true"
          />
          <div className="relative flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="text-gray-700 truncate">{d.nombre}</span>
            <span className="font-semibold text-gray-900 shrink-0">{mxn(d[valorKey])}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
