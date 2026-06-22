/**
 * main.jsx — Punto de entrada de la aplicación.
 *
 * Este es el único archivo que toca el DOM directamente.
 * createRoot() le dice a React "toma control de este div"
 * y desde ahí React maneja todo el HTML de la app.
 *
 * StrictMode no cambia el comportamiento en producción.
 * En desarrollo, monta los componentes dos veces para
 * ayudarte a detectar efectos secundarios no intencionados.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'  // Tailwind entra aquí
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
