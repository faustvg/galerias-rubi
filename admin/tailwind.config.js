/** @type {import('tailwindcss').Config} */

// Paleta de la página web (web-publico/index.html, :root) aplicada al panel.
// En vez de cambiar cientos de clases, se redefinen las dos escalas que el
// panel ya usa en todos lados:
//   amber → terracota de los botones del sitio (--btn #A46447 = amber-600,
//           --btn-hover #8c5038 = amber-700)
//   gray  → neutros cálidos: crema (--white #FAF8F5 = gray-50), arena
//           (--bg #E8E2D6 = gray-200) y café (--text #4D362E = gray-800)
// Verde/rojo (emerald/red) se quedan: son semáforo, no marca.
const terracota = {
  50:  '#FAF3EF',
  100: '#F4E4DA',
  200: '#E8C9B6',
  300: '#D9A98D',
  400: '#C68867',
  500: '#B47353',
  600: '#A46447',
  700: '#8C5038',
  800: '#6F3F2D',
  900: '#573225',
  950: '#301B14',
}

const calido = {
  50:  '#FAF8F5',
  100: '#F3EFE8',
  200: '#E8E2D6',
  300: '#D5CCBD',
  400: '#ABA092',
  500: '#857769',
  600: '#67574B',
  700: '#56433A',
  800: '#4D362E',
  900: '#33231D',
  950: '#1F1511',
}

export default {
  // Tailwind escanea estos archivos buscando clases CSS.
  // Solo genera el CSS de las clases que realmente usas (tree-shaking).
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        amber: terracota,
        gray:  calido,
        // Acentos secundarios del sitio (--accent1 / --accent2)
        salvia: '#87937B',
        camel:  '#A98F74',
      },
      // Sombra suave y cálida para las tarjetas (en vez de solo borde).
      boxShadow: {
        card: '0 1px 2px rgba(77, 54, 46, 0.04), 0 8px 24px -12px rgba(77, 54, 46, 0.14)',
      },
      fontFamily: {
        sans:  ['Jost', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
