/**
 * AuthContext.jsx — Estado global de autenticación.
 *
 * CONCEPTOS DE REACT QUE USAMOS AQUÍ:
 *
 * createContext()
 *   Crea una "caja" que puede compartir datos con cualquier componente
 *   descendiente sin pasar props manualmente por cada nivel.
 *
 * useState(valorInicial)
 *   Guarda un dato dentro de un componente. Devuelve [valorActual, setter].
 *   Cuando llamas al setter, React re-renderiza el componente y todos
 *   los que consumen ese valor.
 *
 * useEffect(fn, [deps])
 *   Ejecuta `fn` después de que el componente se monta en el DOM.
 *   El array `deps` controla cuándo se vuelve a ejecutar:
 *     []    = solo una vez al montar (lo que usamos aquí)
 *     [x]   = cada vez que cambia x
 *     (nada)= en cada re-render (casi nunca quieres esto)
 *
 * useContext(Context)
 *   Lee el valor actual de un Context desde cualquier componente hijo.
 */

import { createContext, useContext, useState, useEffect } from 'react'
import { apiFetch } from '../api'

// 1. Crear el contexto. El null es solo el valor por defecto antes
//    de que el Provider lo sobreescriba — nunca debería verse.
const AuthContext = createContext(null)

/**
 * AuthProvider — Componente que envuelve la app y comparte el estado
 * de autenticación con todos sus descendientes.
 *
 * `children` es lo que esté dentro de <AuthProvider>...</AuthProvider>.
 */
export function AuthProvider({ children }) {
  // null = no logueado (aún no sabemos), objeto = usuario logueado
  const [usuario, setUsuario] = useState(null)

  // true mientras esperamos respuesta de GET /yo al arrancar la app.
  // Evita que la pantalla de login destelle antes de saber si hay sesión.
  const [cargando, setCargando] = useState(true)

  // Al montar el Provider (una sola vez), verificar si ya existe una
  // sesión activa en el servidor (cookie de visitas anteriores).
  useEffect(() => {
    apiFetch('/yo')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setUsuario(data) // null si no hay sesión, { id, username, nombre, rol } si sí
        setCargando(false)
      })
      .catch(() => {
        // Error de red u otro problema — tratar como no autenticado
        setUsuario(null)
        setCargando(false)
      })
  }, []) // [] = solo al montar

  /**
   * login(username, password)
   * Llama a POST /login y luego a GET /yo para obtener el perfil completo.
   * Lanza un Error con el mensaje del servidor si las credenciales fallan.
   */
  async function login(username, password) {
    const res = await apiFetch('/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.detail ?? 'Error al iniciar sesión')
    }

    // Obtener el perfil completo del usuario recién autenticado
    const perfil = await apiFetch('/yo').then((r) => r.json())
    setUsuario(perfil)
  }

  /**
   * logout()
   * Llama a POST /logout para que el servidor borre la sesión,
   * y limpia el estado local.
   */
  async function logout() {
    await apiFetch('/logout', { method: 'POST' })
    setUsuario(null)
  }

  // 2. El Provider "envuelve" a sus hijos y les pasa el valor actual.
  //    Cualquier componente descendiente puede leer { usuario, cargando,
  //    login, logout } con el hook useAuth().
  return (
    <AuthContext.Provider value={{ usuario, cargando, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

/**
 * useAuth — Hook personalizado para leer el contexto de autenticación.
 *
 * Un "custom hook" es solo una función que empieza con "use" y llama
 * a otros hooks de React. Lo creamos para no tener que escribir
 * useContext(AuthContext) en cada componente.
 *
 * Uso:
 *   const { usuario, login, logout } = useAuth()
 */
export function useAuth() {
  return useContext(AuthContext)
}
