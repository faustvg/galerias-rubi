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
 * ── COLAPSAR/EXPANDIR (solo escritorio) ─────────────────────────────────────
 *
 * `colapsado` es una preferencia PERSONAL de este navegador/dispositivo, no
 * datos del negocio — por eso vive en localStorage y no en el backend (no
 * hay nada que sincronizar entre usuarios o dispositivos). Colapsado reduce
 * el sidebar a solo iconos; por eso cada NAV item ahora trae su propio
 * ícono (antes no existían — el sidebar solo mostraba texto). El botón de
 * colapsar solo aparece en `lg:` — en móvil el sidebar es un cajón que se
 * desliza completo, colapsarlo a iconos ahí no aporta nada y complica el
 * gesto de "tocar fuera para cerrar".
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

import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const LS_KEY_COLAPSADO = 'mr_admin_sidebar_colapsado'

const COLORES_ROL = {
  superadmin: 'bg-purple-100 text-purple-700',
  admin:      'bg-blue-100 text-blue-700',
  viewer:     'bg-gray-100 text-gray-500',
  worker:     'bg-green-100 text-green-700',
}

// Iconos en SVG puro, sin dependencias externas — mismo criterio que la
// hamburguesa de abajo. Trazo simple 24x24, currentColor hereda el color
// de texto del enlace (activo/inactivo) sin necesitar props extra.
function IconoInicio(p) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/></svg>
}
function IconoHistorico(p) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 21V13M10 21V7M16 21V11"/></svg>
}
function IconoCatalogo(p) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3.5 7.5 12 3l8.5 4.5L12 12 3.5 7.5Z"/><path d="M3.5 7.5V16l8.5 4.5 8.5-4.5V7.5"/><path d="M12 12v8.5"/></svg>
}
function IconoNuevosIngresos(p) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="9.5" width="18" height="11" rx="1.5"/><path d="M3 9.5 12 4l9 5.5"/><path d="M12 12.5v5M9.3 15h5.4"/></svg>
}
function IconoNotas(p) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M6 2.5h12v19l-2.5-1.6-2.5 1.6-2.5-1.6-2.5 1.6-2-1.3z"/><path d="M8.5 8h7M8.5 12h7"/></svg>
}
function IconoCategorias(p) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M13 3h6a2 2 0 0 1 2 2v6l-9.5 9.5a1.5 1.5 0 0 1-2.1 0L3 14.1a1.5 1.5 0 0 1 0-2.1L13 3Z"/><circle cx="17" cy="7" r="1.1" fill="currentColor" stroke="none"/></svg>
}
function IconoProveedores(p) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M2.5 6.5h10v9h-10z"/><path d="M12.5 10h4l3 3v2.5h-7z"/><circle cx="6" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/></svg>
}
function IconoSucursales(p) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.3"/></svg>
}
function IconoTestimonios(p) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 5h16v11H8l-4 4V5Z"/><path d="M8 9h8M8 12h5"/></svg>
}
function IconoUsuarios(p) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/></svg>
}

// Tabla de navegación. `soloRol` oculta un enlace para todos excepto ese rol;
// `soloRoles` hace lo mismo con una lista (viewer no tiene acceso de escritura
// en sucursales, pero sí puede editar notas, así que no encajaba en soloRol).
const NAV = [
  { to: '/',            label: 'Inicio',         end: true,  icon: IconoInicio      },
  { to: '/historico',   label: 'Histórico',                  icon: IconoHistorico   },
  { to: '/productos',   label: 'Catálogo',                   icon: IconoCatalogo    },
  { to: '/nuevos-ingresos', label: 'Restock', soloRoles: ['superadmin', 'admin', 'worker'], icon: IconoNuevosIngresos },
  { to: '/notas',       label: 'Notas / Ventas',              icon: IconoNotas       },
  { to: '/categorias',  label: 'Categorías',                 icon: IconoCategorias  },
  { to: '/proveedores', label: 'Proveedores',                icon: IconoProveedores },
  { to: '/sucursales',  label: 'Sucursales',     soloRoles: ['superadmin', 'admin', 'worker'], icon: IconoSucursales },
  { to: '/testimonios', label: 'Testimonios',    soloRoles: ['superadmin', 'admin'],           icon: IconoTestimonios },
  { to: '/usuarios',    label: 'Usuarios',       soloRol: 'superadmin',                        icon: IconoUsuarios },
]

export default function Layout({ children }) {
  const { usuario, logout } = useAuth()
  const navigate = useNavigate()
  const [menuAbierto, setMenuAbierto] = useState(false)

  // Preferencia personal de este navegador — ver comentario arriba.
  const [colapsado, setColapsado] = useState(() => {
    try { return localStorage.getItem(LS_KEY_COLAPSADO) === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_COLAPSADO, colapsado ? '1' : '0') } catch { /* localStorage no disponible (modo privado) — no es crítico */ }
  }, [colapsado])

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  const colorRol   = COLORES_ROL[usuario?.rol] ?? 'bg-gray-100 text-gray-500'
  const inicial    = usuario?.nombre?.charAt(0)?.toUpperCase() ?? '?'

  // Ocultar enlaces restringidos por rol
  const enlacesVisibles = NAV.filter((item) => {
    if (item.soloRol) return usuario?.rol === item.soloRol
    if (item.soloRoles) return item.soloRoles.includes(usuario?.rol)
    return true
  })

  // NavLink espera una función para className cuando queremos estilos dinámicos
  function claseEnlace({ isActive }) {
    return `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
      colapsado ? 'lg:justify-center lg:px-2' : ''
    } ${
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
          El ancho colapsado (lg:w-[76px]) solo aplica en escritorio — en
          móvil el sidebar siempre es w-64 completo (ver comentario arriba). */}
      <aside
        className={`
          fixed inset-y-0 left-0 w-64 z-30
          bg-white border-r border-gray-200
          flex flex-col
          transition-[transform,width] duration-200 ease-in-out
          ${menuAbierto ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
          ${colapsado ? 'lg:w-[76px]' : 'lg:w-64'}
        `}
      >
        {/* Marca + botón de colapsar (solo escritorio) */}
        <div className={`px-5 py-4 border-b border-gray-100 shrink-0 flex items-center justify-between gap-2 ${colapsado ? 'lg:px-3' : ''}`}>
          <div className={`min-w-0 ${colapsado ? 'lg:hidden' : ''}`}>
            <p className="font-bold text-amber-700 text-lg leading-tight truncate">Muebles Rubí</p>
            <p className="text-xs text-gray-400 mt-0.5">Panel de gestión</p>
          </div>
          <button
            onClick={() => setColapsado((v) => !v)}
            aria-label={colapsado ? 'Expandir menú' : 'Colapsar menú'}
            title={colapsado ? 'Expandir menú' : 'Colapsar menú'}
            className="hidden lg:flex items-center justify-center w-7 h-7 rounded-lg
                       text-gray-400 hover:text-amber-700 hover:bg-amber-50 transition-colors shrink-0"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                 className={`transition-transform ${colapsado ? 'rotate-180' : ''}`}>
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
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
              title={item.label}
            >
              <item.icon width="19" height="19" className="shrink-0" />
              <span className={colapsado ? 'lg:hidden' : ''}>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Usuario y cierre de sesión — anclado al fondo */}
        <div className={`px-4 py-4 border-t border-gray-100 shrink-0 ${colapsado ? 'lg:px-2' : ''}`}>
          <div className={`flex items-center gap-3 mb-3 ${colapsado ? 'lg:justify-center' : ''}`}>
            <div
              className="w-8 h-8 rounded-full bg-amber-100 text-amber-700
                         flex items-center justify-center text-sm font-bold shrink-0"
              aria-hidden="true"
              title={colapsado ? usuario?.nombre : undefined}
            >
              {inicial}
            </div>
            <div className={`min-w-0 ${colapsado ? 'lg:hidden' : ''}`}>
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
            title="Cerrar sesión"
            className={`text-sm text-gray-400 hover:text-red-600 transition-colors ${
              colapsado ? 'lg:flex lg:justify-center lg:w-full' : ''
            }`}
          >
            <span className={colapsado ? 'lg:hidden' : ''}>Cerrar sesión</span>
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
                 strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                 className={`hidden ${colapsado ? 'lg:block' : ''}`}>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </button>
        </div>
      </aside>

      {/* ── ÁREA DE CONTENIDO ───────────────────────────────────────────────
          lg:ml-64 / lg:ml-[76px] deja el espacio del sidebar en pantallas
          grandes según esté colapsado o no. min-w-0 evita que el flex
          desborde horizontalmente en móvil. */}
      <div className={`flex-1 flex flex-col min-h-screen min-w-0 transition-[margin] duration-200 ${
        colapsado ? 'lg:ml-[76px]' : 'lg:ml-64'
      }`}>

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
            <span className="font-bold text-amber-700">Muebles Rubí</span>
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
