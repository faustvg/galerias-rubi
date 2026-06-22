/**
 * Usuarios.jsx — Gestión de cuentas del panel (solo superadmin).
 *
 * ── GUARDAS ANTI-BLOQUEO ─────────────────────────────────────────────────────
 *
 * El backend rechaza con 422 si el superadmin intenta:
 *   (a) cambiar su propio rol
 *   (b) desactivar su propia cuenta
 *   (c) dejar al sistema sin ningún superadmin activo
 *
 * El frontend NO intenta replicar esa lógica: simplemente muestra el mensaje
 * de error que devuelve el backend. Duplicar las guardas en el frontend
 * crearía inconsistencias si la lógica de backend cambia.
 *
 * ── CONTRASEÑAS ────────────────────────────────────────────────────────────
 *
 * La contraseña solo aparece en dos lugares:
 *   1. Formulario de CREAR usuario (campo requerido, mínimo 8 caracteres)
 *   2. Formulario de RESETEAR contraseña de un usuario existente
 *
 * El formulario de EDITAR (nombre, rol, activo) NO tiene campo de contraseña.
 * Nunca se muestra ni se maneja el password_hash.
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../api'
import Layout from '../components/Layout'

const COLORES_ROL = {
  superadmin: 'bg-purple-100 text-purple-700',
  admin:      'bg-blue-100 text-blue-700',
  viewer:     'bg-gray-100 text-gray-600',
  worker:     'bg-green-100 text-green-700',
}

const ROLES = ['superadmin', 'admin', 'viewer', 'worker']

async function leerError(res) {
  try {
    const data = await res.json()
    if (typeof data.detail === 'string') return data.detail
    if (Array.isArray(data.detail))
      return data.detail.map((e) => e.msg ?? String(e)).join('; ')
    return `Error ${res.status}`
  } catch {
    return `Error ${res.status}`
  }
}

function formatFecha(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-MX', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export default function Usuarios() {
  const { usuario, logout } = useAuth()
  const navigate = useNavigate()

  // Guardia de acceso: redirige si el usuario logueado no es superadmin
  useEffect(() => {
    if (usuario && usuario.rol !== 'superadmin') {
      navigate('/', { replace: true })
    }
  }, [usuario, navigate])

  const [usuarios, setUsuarios]               = useState([])
  const [cargando, setCargando]               = useState(true)
  const [error, setError]                     = useState(null)

  // Panel principal (crear / editar): null = cerrado, null dentro = crear, obj = editar
  const [panelAbierto, setPanelAbierto]       = useState(false)
  const [usuarioEditando, setUsuEditando]     = useState(null) // null=crear, obj=editar

  // Panel de resetear contraseña
  const [resetUsuario, setResetUsuario]       = useState(null) // null=cerrado, obj=usuario

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const res = await apiFetch('/usuarios')
      if (res.status === 401) { await logout(); navigate('/login'); return }
      if (res.status === 403) { navigate('/'); return }
      if (!res.ok) throw new Error('No se pudo cargar los usuarios.')
      setUsuarios(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }, [logout, navigate])

  useEffect(() => { cargar() }, [cargar])

  // No renderizar nada hasta saber que el usuario es superadmin
  if (!usuario || usuario.rol !== 'superadmin') return null

  function abrirNuevo()    { setUsuEditando(null); setPanelAbierto(true) }
  function abrirEditar(u)  { setUsuEditando(u);    setPanelAbierto(true) }
  function cerrarPanel()   { setPanelAbierto(false); setUsuEditando(null) }

  async function handleGuardado() { cerrarPanel(); await cargar() }

  return (
    <Layout>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Usuarios</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {usuarios.length} cuenta{usuarios.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={abrirNuevo}
          className="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium
                     px-4 py-2.5 rounded-xl transition-colors shrink-0"
        >
          + Nuevo usuario
        </button>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200
                        rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {cargando && (
        <p className="text-center text-gray-400 py-16 text-sm">Cargando usuarios…</p>
      )}

      {!cargando && usuarios.length > 0 && (
        <div className="space-y-2">
          {usuarios.map((u) => (
            <TarjetaUsuario
              key={u.id}
              u={u}
              esSelf={u.id === usuario.id}
              onEditar={() => abrirEditar(u)}
              onResetearPassword={() => setResetUsuario(u)}
            />
          ))}
        </div>
      )}

      {/* Modal crear / editar */}
      {panelAbierto && (
        <UsuarioModal
          usuarioEditando={usuarioEditando}
          yo={usuario}
          onGuardado={handleGuardado}
          onCerrar={cerrarPanel}
        />
      )}

      {/* Modal resetear contraseña */}
      {resetUsuario && (
        <ResetPasswordModal
          u={resetUsuario}
          onListo={() => { setResetUsuario(null) }}
          onCerrar={() => setResetUsuario(null)}
        />
      )}
    </Layout>
  )
}


// ── Tarjeta de usuario ───────────────────────────────────────────────────────
function TarjetaUsuario({ u, esSelf, onEditar, onResetearPassword }) {
  const colorRol = COLORES_ROL[u.rol] ?? 'bg-gray-100 text-gray-600'

  return (
    <div className={`bg-white rounded-2xl border transition-colors p-4 ${
      u.activo
        ? 'border-gray-200 hover:border-amber-200'
        : 'border-gray-200 opacity-60'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Fila superior: username + badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-gray-500">{u.username}</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colorRol}`}>
              {u.rol}
            </span>
            {!u.activo && (
              <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                Inactivo
              </span>
            )}
            {esSelf && (
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                Tú
              </span>
            )}
          </div>
          {/* Nombre + fecha de creación */}
          <p className="font-semibold text-gray-900 mt-0.5">{u.nombre}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Cuenta creada: {formatFecha(u.creado_en)}
          </p>
        </div>

        {/* Acciones */}
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <button
            onClick={onEditar}
            className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg
                       text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Editar
          </button>
          <button
            onClick={onResetearPassword}
            className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg
                       text-gray-500 hover:bg-gray-50 transition-colors"
          >
            Contraseña
          </button>
        </div>
      </div>
    </div>
  )
}


// ── Modal crear / editar usuario ─────────────────────────────────────────────
// `usuarioEditando` null = modo crear; objeto = modo editar.
// `yo` es el usuario logueado — se usa para mostrar el aviso de "Tu propio usuario".
function UsuarioModal({ usuarioEditando, yo, onGuardado, onCerrar }) {
  const modoEditar = Boolean(usuarioEditando)

  // Campo username: requerido en crear, editable en editar
  const [username, setUsername]   = useState(usuarioEditando?.username ?? '')
  const [password, setPassword]   = useState('')

  // Campos compartidos (crear y editar)
  const [nombre, setNombre]       = useState(usuarioEditando?.nombre ?? '')
  const [rol, setRol]             = useState(usuarioEditando?.rol    ?? 'worker')
  const [activo, setActivo]       = useState(usuarioEditando?.activo ?? true)

  const [guardando, setGuardando] = useState(false)
  const [error, setError]         = useState(null)

  const esSelf = modoEditar && usuarioEditando.id === yo.id

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (username.trim().length < 3) {
      setError('El username debe tener al menos 3 caracteres.')
      return
    }
    if (!modoEditar && password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }

    setGuardando(true)
    try {
      let res
      if (modoEditar) {
        // PUT — incluye username para permitir cambiarlo
        res = await apiFetch(`/usuarios/${usuarioEditando.id}`, {
          method: 'PUT',
          body: JSON.stringify({ username: username.trim(), nombre: nombre.trim(), rol, activo }),
        })
      } else {
        // POST — crear usuario nuevo
        res = await apiFetch('/usuarios', {
          method: 'POST',
          body: JSON.stringify({
            username: username.trim(),
            nombre:   nombre.trim(),
            rol,
            password,
          }),
        })
      }

      if (!res.ok) {
        // Aquí pueden llegar los errores de las guardas anti-bloqueo (422).
        // leerError() extrae el mensaje de { detail: "..." } y lo mostramos tal cual.
        setError(await leerError(res))
        return
      }

      await onGuardado()
    } catch {
      setError('Error de conexión. Intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center
                 justify-center z-50 p-4"
      onClick={onCerrar}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md
                   p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold text-gray-900 text-base mb-1">
          {modoEditar ? `Editar usuario: ${usuarioEditando.username}` : 'Nuevo usuario'}
        </h2>

        {/* Aviso cuando el superadmin está editando su propia cuenta */}
        {esSelf && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200
                        rounded-lg px-3 py-2 mb-4">
            Estás editando tu propia cuenta. No puedes cambiar tu rol ni desactivarte.
          </p>
        )}

        {error && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200
                          rounded-xl px-3 py-2.5">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Username</span>
            <span className="block text-xs text-gray-400 mb-1.5">
              Con esto inicia sesión
            </span>
            <input
              required
              minLength={3}
              maxLength={50}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5
                         text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="Ej. ana.garcia"
              autoComplete="off"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Nombre completo</span>
            <input
              required
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="mt-1.5 w-full border border-gray-300 rounded-xl px-3 py-2.5
                         text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="Ej. Ana García"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Rol</span>
            <select
              value={rol}
              onChange={(e) => setRol(e.target.value)}
              className="mt-1.5 w-full border border-gray-300 rounded-xl px-3 py-2.5
                         text-sm focus:outline-none focus:ring-2 focus:ring-amber-400
                         bg-white"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <span className="block text-xs text-gray-400 mt-1">
              superadmin · admin · viewer (solo lectura) · worker (solo sus notas)
            </span>
          </label>

          {/* Toggle activo/inactivo — solo en modo editar */}
          {modoEditar && (
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Cuenta activa</span>
                <p className="text-xs text-gray-400 mt-0.5">
                  Un usuario inactivo no puede iniciar sesión
                </p>
              </div>
              {/* Toggle switch accesible */}
              <button
                type="button"
                role="switch"
                aria-checked={activo}
                onClick={() => setActivo((a) => !a)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full
                            transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400
                            ${activo ? 'bg-amber-500' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white
                                  transition-transform shadow
                                  ${activo ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          )}

          {/* Contraseña inicial — solo en modo crear */}
          {!modoEditar && (
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Contraseña inicial</span>
              <span className="block text-xs text-gray-400 mb-1.5">Mínimo 8 caracteres</span>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5
                           text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                autoComplete="new-password"
              />
            </label>
          )}

          <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
            <button
              type="button"
              onClick={onCerrar}
              className="flex-1 py-2.5 border border-gray-300 rounded-xl text-sm
                         font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white
                         rounded-xl text-sm font-medium transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {guardando
                ? 'Guardando…'
                : modoEditar ? 'Guardar cambios' : 'Crear usuario'
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


// ── Modal de resetear contraseña ─────────────────────────────────────────────
function ResetPasswordModal({ u, onListo, onCerrar }) {
  const [nuevaPassword, setNuevaPassword] = useState('')
  const [guardando, setGuardando]         = useState(false)
  const [error, setError]                 = useState(null)
  const [exito, setExito]                 = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (nuevaPassword.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }

    setGuardando(true)
    setError(null)
    try {
      const res = await apiFetch(`/usuarios/${u.id}/password`, {
        method: 'POST',
        body: JSON.stringify({ nueva_password: nuevaPassword }),
      })
      if (!res.ok) { setError(await leerError(res)); return }
      setExito(true)
    } catch {
      setError('Error de conexión. Intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center
                 justify-center z-50 p-4"
      onClick={onCerrar}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm
                   p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {exito ? (
          /* Estado de éxito */
          <div className="text-center py-4">
            <p className="text-green-600 font-semibold mb-1">Contraseña cambiada</p>
            <p className="text-sm text-gray-500 mb-5">
              La contraseña de <strong>{u.nombre}</strong> fue actualizada.
            </p>
            <button
              onClick={onListo}
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white
                         rounded-xl text-sm font-medium transition-colors"
            >
              Listo
            </button>
          </div>
        ) : (
          <>
            <h2 className="font-semibold text-gray-900 text-base mb-1">
              Resetear contraseña
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Nueva contraseña para <strong>{u.nombre}</strong>{' '}
              (<span className="font-mono">{u.username}</span>)
            </p>

            {error && (
              <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200
                              rounded-xl px-3 py-2.5">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">
                  Nueva contraseña
                </span>
                <span className="block text-xs text-gray-400 mb-1.5">
                  Mínimo 8 caracteres
                </span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={nuevaPassword}
                  onChange={(e) => setNuevaPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5
                             text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  autoComplete="new-password"
                />
              </label>

              <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
                <button
                  type="button"
                  onClick={onCerrar}
                  className="flex-1 py-2.5 border border-gray-300 rounded-xl text-sm
                             font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardando}
                  className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white
                             rounded-xl text-sm font-medium transition-colors
                             disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {guardando ? 'Cambiando…' : 'Cambiar contraseña'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
