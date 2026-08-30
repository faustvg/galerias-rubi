/**
 * periodos.js — Cálculo de rangos de fecha (mes/semana) para Histórico.
 *
 * Extraído de Historico.jsx para poder probarlo sin renderizar React
 * (ver periodos.test.js) — el bug que motivó esta extracción (Parte 3,
 * ronda de admin/) era precisamente en esta aritmética de fechas, el tipo
 * de off-by-one fácil de reintroducir en silencio sin una prueba.
 *
 * ── EL BUG Y SU CAUSA RAÍZ ──────────────────────────────────────────────────
 *
 *   La función `toISO` original usaba `Date.prototype.toISOString()`, que
 *   SIEMPRE convierte a UTC antes de formatear. Un Date construido con
 *   `new Date(año, mes, día)` representa medianoche en la zona horaria
 *   LOCAL del navegador — en cualquier zona con offset UTC positivo (al
 *   este de Greenwich), esa medianoche local cae en el día UTC ANTERIOR,
 *   así que toISOString() recorta la fecha un día hacia atrás. El cálculo
 *   de "lunes a domingo" en sí (con getDay()/setDate(), aritmética 100%
 *   local) siempre fue correcto — el corrimiento pasaba solo al convertir
 *   a texto para mandarlo a la API.
 *
 *   Arreglo: formatear directamente desde los getters LOCALES
 *   (getFullYear/getMonth/getDate), sin pasar nunca por UTC. Esto corrige
 *   TODOS los cálculos de este módulo a la vez (semana, mes, y cualquier
 *   rango futuro), no solo "semana pasada".
 *
 * ── CONVENCIÓN DE SEMANA — ISO 8601 (lunes a domingo) ────────────────────────
 *
 *   getDay(): 0=Dom, 1=Lun, ..., 6=Sáb. Para llegar al lunes de la semana
 *   que contiene `fecha`, retrocedemos (getDay() === 0 ? 6 : getDay() - 1)
 *   días. El domingo de esa misma semana es lunes + 6.
 */

// Fecha → "YYYY-MM-DD" usando SIEMPRE los componentes locales del Date,
// nunca toISOString() (ver comentario de cabecera — esa es la causa raíz
// del bug de "semana pasada" corrida un día).
export const toISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// "YYYY-MM" para <input type="month">
export const aMesInput = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

// Lunes de la semana ISO que contiene `fecha` (no muta `fecha`).
export function lunesDeLaSemana(fecha) {
  const d = new Date(fecha)
  d.setHours(0, 0, 0, 0)
  const diasDesdeLunes = d.getDay() === 0 ? 6 : d.getDay() - 1
  d.setDate(d.getDate() - diasDesdeLunes)
  return d
}

// { desde, hasta } de la semana ISO (lunes-domingo) que contiene `fecha`.
export function rangoSemanaDe(fecha) {
  const lunes = lunesDeLaSemana(fecha)
  const domingo = new Date(lunes)
  domingo.setDate(lunes.getDate() + 6)
  return { desde: toISO(lunes), hasta: toISO(domingo) }
}

export function rangoSemanaActual() {
  return rangoSemanaDe(new Date())
}

export function rangoSemanaPasada() {
  const hoy = new Date()
  const lunesActual = lunesDeLaSemana(hoy)
  const domingoPasado = new Date(lunesActual)
  domingoPasado.setDate(lunesActual.getDate() - 1)   // domingo justo antes de esta semana
  return rangoSemanaDe(domingoPasado)
}

export function rangoMesActual() {
  const hoy = new Date()
  return {
    desde: toISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
    hasta: toISO(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)),
  }
}

export function rangoMesPasado() {
  const hoy = new Date()
  const ultimo  = new Date(hoy.getFullYear(), hoy.getMonth(), 0)   // último día del mes anterior
  const primero = new Date(ultimo.getFullYear(), ultimo.getMonth(), 1)
  return { desde: toISO(primero), hasta: toISO(ultimo) }
}
