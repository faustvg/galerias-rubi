/**
 * FilaLista.jsx — Fila compacta de una sola línea, compartida por todas
 * las listas de Inicio e Histórico (entregas completadas, entregas
 * próximas, gasto de restock).
 *
 * Antes de esta ronda, "Entregas completadas" ya era una fila de una sola
 * línea, pero "Gasto de restock en el periodo" usaba dos líneas (nombre
 * en negrita, luego una segunda línea con fecha/cantidad/proveedor) — el
 * mismo TIPO de contenido (una entrada con fecha + monto) con dos
 * densidades visuales distintas según qué panel la mostrara. Esta fila es
 * ahora el único punto de verdad de ese estilo.
 *
 * `to` es opcional: con él la fila es un <Link> (entregas, que llevan a
 * la nota); sin él es un <div> no clicable (restock, que no tiene una
 * página de detalle propia a la que ir).
 *
 * `derecha`/`derechaSub` aceptan cualquier ReactNode, no solo texto plano
 * — así una fila puede colorear su propio valor (ej. la fecha de entrega
 * próxima en rojo si es urgente) sin que eso rompa el layout compartido.
 */
import { Link } from 'react-router-dom'

export function FilaLista({ to, titulo, meta, derecha, derechaSub, ultima = false }) {
  const clase = `flex items-center justify-between gap-3 px-3.5 py-2 text-sm ${
    to ? 'hover:bg-amber-50 transition-colors' : ''
  } ${!ultima ? 'border-b border-gray-100' : ''}`

  const cuerpo = (
    <>
      <div className="min-w-0 flex items-baseline gap-2">
        <p className="font-medium text-gray-900 truncate">{titulo}</p>
        {meta && <span className="text-xs text-gray-400 shrink-0 truncate">{meta}</span>}
      </div>
      <div className="text-right shrink-0">
        <p className="font-semibold text-gray-900">{derecha}</p>
        {derechaSub && <div className="text-xs">{derechaSub}</div>}
      </div>
    </>
  )

  return to
    ? <Link to={to} className={clase}>{cuerpo}</Link>
    : <div className={clase}>{cuerpo}</div>
}

// Contenedor blanco con borde para envolver una lista de <FilaLista>.
export function ListaCard({ children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      {children}
    </div>
  )
}

// Estado vacío compacto (Parte A.6) — antes cada lista tenía su propio
// bloque de py-6/py-8 centrado, que es justo lo que dejaba tanto espacio
// en blanco en un periodo con poco movimiento. Una sola línea, sin el
// padding de "contenedor vacío destacado".
export function ListaVacia({ mensaje }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5">
      <p className="text-xs text-gray-400 text-center">{mensaje}</p>
    </div>
  )
}
