/**
 * theme.js — Un solo lugar para el acento de marca que usan las gráficas.
 *
 * El acento YA existe como token de Tailwind (la paleta `amber` incluida
 * de fábrica) — se usa en el logo, el nav activo, y los botones primarios
 * (bg-amber-600/text-amber-700 en className). Recharts no puede leer
 * clases de Tailwind (sus props `fill`/`stroke` piden un color CSS
 * literal), así que este archivo existe solo para no repetir el hex a
 * mano en cada gráfica — se reusa el mismo valor que ya usaba el chart de
 * "Utilidad por categoría" antes de esta ronda, no se inventa uno nuevo.
 */
export const ACENTO_HEX = '#f59e0b'   // Tailwind amber-500
