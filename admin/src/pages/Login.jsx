/**
 * Login.jsx — Pantalla de inicio de sesión.
 *
 * HOOKS USADOS AQUÍ:
 *
 * useState
 *   Cada campo del formulario tiene su propio estado local.
 *   "Controlado" significa que el valor del <input> siempre refleja
 *   el estado de React, y cada tecla dispara onChange → setXxx.
 *   React es la fuente de verdad, no el DOM.
 *
 * useNavigate (React Router)
 *   Devuelve una función navigate('/ruta') para cambiar de página
 *   sin recargar el navegador (SPA = Single Page Application).
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  // Estado local del formulario
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState(null)   // mensaje de error del servidor
  const [enviando, setEnviando] = useState(false)   // desactiva el botón mientras espera

  const { login } = useAuth()
  const navigate  = useNavigate()

  async function handleSubmit(e) {
    // Evitar que el formulario recargue la página (comportamiento HTML por defecto)
    e.preventDefault()
    setError(null)
    setEnviando(true)

    try {
      await login(username, password)
      // Si login() no lanzó error, hay sesión activa → ir al panel
      navigate('/')
    } catch (err) {
      // login() lanza un Error con el mensaje del servidor (ej. "Credenciales incorrectas")
      setError(err.message)
    } finally {
      // finally siempre corre, tanto si tuvo éxito como si falló
      setEnviando(false)
    }
  }

  return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-md w-full max-w-sm p-8">

        {/* Encabezado */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Galerías Rubí</h1>
          <p className="text-sm text-gray-500 mt-1">Panel de administración</p>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="space-y-4">

          <div>
            <label
              htmlFor="username"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Usuario
            </label>
            {/*
              Input controlado: value viene de React, onChange actualiza React.
              Cada vez que el usuario escribe, setUsername guarda el valor
              y React re-renderiza el input con el nuevo value.
            */}
            <input
              id="username"
              type="text"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>

          {/* Mensaje de error — solo se renderiza si hay un error */}
          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300
                       text-white font-medium py-2 rounded-lg text-sm transition-colors"
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>

        </form>
      </div>
    </div>
  )
}
