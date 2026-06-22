// PostCSS procesa el CSS antes de que llegue al navegador.
// Tailwind es un plugin de PostCSS que genera las clases utilitarias.
// Autoprefixer agrega prefijos de vendor (-webkit-, etc.) automáticamente.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
