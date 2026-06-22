/** @type {import('tailwindcss').Config} */
export default {
  // Tailwind escanea estos archivos buscando clases CSS.
  // Solo genera el CSS de las clases que realmente usas (tree-shaking).
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
