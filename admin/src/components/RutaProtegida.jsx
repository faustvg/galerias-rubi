/**
 * RutaProtegida.jsx — Componente guardián de rutas privadas.
 *
 * CÓMO FUNCIONA:
 * Envuelves cualquier página que requiera sesión así:
 *   <RutaProtegida><Panel /></RutaProtegida>
 *
 * Este componente decide qué renderizar según el estado de auth:
 *   - Mientras verifica la sesión → spinner (evita el destello de /login)
 *   - Sin sesión → redirige a /login (usando <Navigate> de React Router)
 *   - Con sesión → renderiza los hijos (la página real)
 *
 * <Navigate replace to="/login" />
 *   `replace` significa que la URL de login reemplaza la entrada actual
 *   en el historial del navegador. Sin `replace`, el usuario quedaría
 *   atrapado en un bucle si presiona el botón "atrás".
 */

import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function RutaProtegida({ children }) {
  const { usuario, cargando } = useAuth()

  if (cargando) {
    // Esperando respuesta de GET /yo — no mostrar nada todavía
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400 text-sm">Verificando sesión…</p>
      </div>
    )
  }

  if (!usuario) {
    // No hay sesión activa → ir al login
    return <Navigate to="/login" replace />
  }

  // Hay sesión → mostrar la página protegida
  return children
}
