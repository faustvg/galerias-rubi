/**
 * Layout.jsx — Sidebar compartido para todo el panel admin.
 *
 * ── PATRÓN: LAYOUT COMPARTIDO EN REACT ROUTER ──────────────────────────────
 *
 * Cada página hace <Layout><ContenidoDeLaPagina /></Layout>.
 * React renderiza Layout en cada navegación, pero como el sidebar siempre
 * tiene la misma estructura, el DOM permanece estable y el usuario ve la
 * transición sin parpadeos.
 *
 * Una alternativa más avanzada (React Router "layout routes") permite que
 * el sidebar se monte UNA sola vez y solo cambie el <Outlet /> interior.
 * Para este proyecto, el patrón de children es suficiente y más sencillo.
 *
 * ── NAVLINK Y EL ENLACE ACTIVO ─────────────────────────────────────────────
 *
 * React Router provee <NavLink> además de <Link>. La diferencia clave:
 * NavLink detecta si la ruta actual coincide con su `to`, y te pasa
 * un booleano `isActive` para que puedas aplicar estilos:
 *
 *     <NavLink to="/notas" className={({ isActive }) => isActive ? 'activo' : ''}>
 *
 * El prop `end` en el link de "/" significa "solo activo si la ruta es
 * EXACTAMENTE /". Sin `end`, "/" estaría activo en todas las rutas porque
 * todas empiezan con "/".
 *
 * ── RESPONSIVE: SIDEBAR EN MÓVIL ───────────────────────────────────────────
 *
 * El sidebar siempre existe en el DOM — lo que cambia es su posición CSS:
 *
 *   - Pantallas grandes (lg: = 1024px+): translate-x-0  → visible a la izquierda
 *   - Móvil, menú cerrado:               -translate-x-full → fuera de pantalla
 *   - Móvil, menú abierto:               translate-x-0   → desliza al frente
 *
 * `transition-transform` anima el deslizamiento. Un overlay oscuro cubre el
 * contenido cuando el menú está abierto; cerrarlo al tocarlo es UX estándar.
 *
 * ── VISIBILIDAD POR ROL ─────────────────────────────────────────────────────
 *
 *   const enlacesVisibles = NAV.filter(
 *     item => !item.soloRol || usuario?.rol === item.soloRol
 *   )
 *
 * Si un item no tiene `soloRol`, lo ven todos. Si lo tiene, solo lo ve
 * el rol especificado. La seguridad real está en el backend — el sidebar
 * es solo conveniencia visual.
 */

import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const COLORES_ROL = {
  superadmin: 'bg-purple-100 text-purple-700',
  admin:      'bg-blue-100 text-blue-700',
  viewer:     'bg-gray-100 text-gray-500',
  worker:     'bg-green-100 text-green-700',
}

// Tabla de navegación. `soloRol` oculta un enlace para todos excepto ese rol.
const NAV = [
  { to: '/',            label: 'Inicio',         end: true               },
  { to: '/historico',   label: 'Histórico'                               },
  { to: '/productos',   label: 'Catálogo'                                },
  { to: '/notas',       label: 'Notas / Ventas'                          },
  { to: '/categorias',  label: 'Categorías'                              },
  { to: '/proveedores', label: 'Proveedores'                             },
  { to: '/usuarios',    label: 'Usuarios',       soloRol: 'superadmin'   },
]

export default function Layout({ children }) {
  const { usuario, logout } = useAuth()
  const navigate = useNavigate()
  const [menuAbierto, setMenuAbierto] = useState(false)

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  const colorRol   = COLORES_ROL[usuario?.rol] ?? 'bg-gray-100 text-gray-500'
  const inicial    = usuario?.nombre?.charAt(0)?.toUpperCase() ?? '?'

  // Ocultar enlaces restringidos por rol
  const enlacesVisibles = NAV.filter(
    (item) => !item.soloRol || usuario?.rol === item.soloRol
  )

  // NavLink espera una función para className cuando queremos estilos dinámicos
  function claseEnlace({ isActive }) {
    return `block px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
      isActive
        ? 'bg-amber-50 text-amber-700 font-semibold'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    }`
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">

      {/* ── Overlay oscuro (móvil) ───────────────────────────────────────────
          Solo aparece en móvil cuando el menú está abierto. Tocar fuera cierra
          el sidebar sin necesitar un botón "X". aria-hidden porque es decorativo. */}
      {menuAbierto && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={() => setMenuAbierto(false)}
          aria-hidden="true"
        />
      )}

      {/* ── SIDEBAR ─────────────────────────────────────────────────────────
          fixed: siempre pegado al borde izquierdo aunque se haga scroll.
          inset-y-0: ocupa toda la altura de la ventana.
          z-30: por encima del overlay (z-20) y del contenido.
          La clase de translate cambia según el estado del menú y el breakpoint. */}
      <aside
        className={`
          fixed inset-y-0 left-0 w-64 z-30
          bg-white border-r border-gray-200
          flex flex-col
          transition-transform duration-200 ease-in-out
          ${menuAbierto ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
        `}
      >
        {/* Marca */}
        <div className="px-5 py-4 border-b border-gray-100 shrink-0">
          <p className="font-bold text-amber-700 text-lg leading-tight">Galerías Rubí</p>
          <p className="text-xs text-gray-400 mt-0.5">Panel de gestión</p>
        </div>

        {/* Navegación — flex-1 hace que ocupe el espacio sobrante */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {enlacesVisibles.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={claseEnlace}
              onClick={() => setMenuAbierto(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Usuario y cierre de sesión — anclado al fondo */}
        <div className="px-4 py-4 border-t border-gray-100 shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-8 h-8 rounded-full bg-amber-100 text-amber-700
                         flex items-center justify-center text-sm font-bold shrink-0"
              aria-hidden="true"
            >
              {inicial}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate leading-tight">
                {usuario?.nombre}
              </p>
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${colorRol}`}>
                {usuario?.rol}
              </span>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="text-sm text-gray-400 hover:text-red-600 transition-colors"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* ── ÁREA DE CONTENIDO ───────────────────────────────────────────────
          lg:ml-64 deja el espacio del sidebar en pantallas grandes.
          min-w-0 evita que el flex desborde horizontalmente en móvil. */}
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen min-w-0">

        {/* Header móvil — solo se ve cuando el sidebar está oculto (< lg) */}
        <header className="lg:hidden sticky top-0 z-10 bg-white border-b border-gray-200">
          <div className="flex items-center gap-3 px-4 py-3">
            <button
              onClick={() => setMenuAbierto(true)}
              className="text-gray-500 hover:text-gray-800 transition-colors p-1 -ml-1"
              aria-label="Abrir menú"
            >
              {/* Hamburguesa en SVG puro — sin dependencias externas */}
              <svg
                width="22" height="22" viewBox="0 0 22 22"
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                aria-hidden="true"
              >
                <line x1="3" y1="6"  x2="19" y2="6"  />
                <line x1="3" y1="11" x2="19" y2="11" />
                <line x1="3" y1="16" x2="19" y2="16" />
              </svg>
            </button>
            <span className="font-bold text-amber-700">Galerías Rubí</span>
          </div>
        </header>

        {/* Contenido de cada página */}
        <main className="flex-1 px-4 py-6 max-w-5xl w-full mx-auto">
          {children}
        </main>

      </div>
    </div>
  )
}
