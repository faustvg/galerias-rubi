/**
 * Productos.jsx — Gestión del catálogo con vista cajas / lista y filtros.
 *
 * ── POR QUÉ LA RUTA RELATIVA FALLABA ───────────────────────────────────────
 *
 * El backend guarda rutas relativas a la carpeta uploads/:
 *   "productos/abc123.webp"
 *
 * El navegador interpreta eso como una URL relativa a la página actual
 * (ej. http://localhost:5173/productos/abc123.webp), no como una ruta
 * al servidor de archivos del backend. No existe ese recurso en Vite,
 * así que la imagen falla en silencio.
 *
 * El helper urlFoto() antepone "/uploads/" para construir la URL real:
 *   "productos/abc123.webp" → "/uploads/productos/abc123.webp"
 *
 * Vite intercepta "/uploads/*" y lo redirige al backend (localhost:8000),
 * que sirve los archivos con FastAPI StaticFiles. En producción, nginx
 * los sirve directamente en esa misma ruta, por lo que el código no cambia.
 *
 * ── ALTERNAR VISTAS ─────────────────────────────────────────────────────────
 *
 * `vista` solo cambia qué componente de presentación se usa. Los datos
 * (productos, filtros) son siempre los mismos. No hay nueva petición al
 * servidor al cambiar de vista.
 *
 * ── MÚLTIPLES FILTROS + BUSCADOR ────────────────────────────────────────────
 *
 * Todos los filtros se aplican en cadena con un solo .filter():
 *
 *   productosFiltrados = productos.filter(p =>
 *     coincide_con_busqueda(p) &&
 *     coincide_categoria(p) &&
 *     coincide_stock(p) &&
 *     coincide_visibilidad(p)
 *   )
 *
 * Cada condición se evalúa solo si su filtro está activo (no en 'todos'/vacío).
 * Agregar un filtro nuevo = agregar una condición más al .filter().
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch, urlFoto } from '../api'
import Layout from '../components/Layout'
import ProductoModal from '../components/ProductoModal'
import ConfirmDialog from '../components/ConfirmDialog'

const mxn = (n) =>
  Number(n).toLocaleString('es-MX', {
    style: 'currency', currency: 'MXN',
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  })

export default function Productos() {
  // ── Estado principal ─────────────────────────────────────────────────────
  const [productos, setProductos]               = useState([])
  const [cargando, setCargando]                 = useState(true)
  const [error, setError]                       = useState(null)
  const [modalAbierto, setModalAbierto]         = useState(false)
  const [productoEditando, setProductoEditando] = useState(null)
  const [confirmando, setConfirmando]           = useState(null)

  // ── Vista y filtros ──────────────────────────────────────────────────────
  const [vista, setVista]       = useState('cajas')
  const [busqueda, setBusqueda] = useState('')
  const [filtros, setFiltros]   = useState({
    categoria:   '',
    stock:       'todos',
    visibilidad: 'todos',
    ubicacion:   '',
  })

  const { usuario, logout } = useAuth()
  const navigate = useNavigate()
  const puedeEscribir = ['superadmin', 'admin', 'worker'].includes(usuario?.rol)

  // ── Carga ────────────────────────────────────────────────────────────────
  const cargarProductos = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    setError(null)
    try {
      const res = await apiFetch('/admin/productos')
      if (res.status === 401) { await logout(); navigate('/login'); return }
      if (!res.ok) throw new Error('No se pudo cargar el catálogo.')
      setProductos(await res.json())
    } catch (err) {
      if (!silencioso) setError(err.message)
    } finally {
      if (!silencioso) setCargando(false)
    }
  }, [logout, navigate])

  useEffect(() => { cargarProductos() }, [cargarProductos])

  // ── Handlers modal ───────────────────────────────────────────────────────
  function abrirNuevo()    { setProductoEditando(null); setModalAbierto(true) }
  function abrirEditar(p)  { setProductoEditando(p);    setModalAbierto(true) }
  function cerrarModal()   { setModalAbierto(false); setProductoEditando(null) }
  function handleCerrarModal() { cerrarModal(); cargarProductos(true) }
  async function handleGuardado() { cerrarModal(); await cargarProductos() }

  // ── Descontinuar ─────────────────────────────────────────────────────────
  async function handleDescontinuar() {
    if (!confirmando) return
    try {
      const res = await apiFetch(`/productos/${confirmando.id}`, { method: 'DELETE' })
      if (res.status === 401) { await logout(); navigate('/login'); return }
      if (res.status === 403) { setError('No tienes permiso para descontinuar.'); return }
      if (!res.ok) { setError('No se pudo descontinuar. Intenta de nuevo.'); return }
      setProductos((prev) =>
        prev.map((p) => p.id === confirmando.id ? { ...p, visible_en_sitio: false } : p)
      )
    } catch {
      setError('Error de conexión. Intenta de nuevo.')
    } finally {
      setConfirmando(null)
    }
  }

  // ── Valores derivados ────────────────────────────────────────────────────
  // Categorías únicas que aparecen en los productos cargados
  const categoriasUnicas = []
  const _seenCats = new Set()
  for (const p of productos) {
    if (p.categoria_id && !_seenCats.has(p.categoria_id)) {
      _seenCats.add(p.categoria_id)
      categoriasUnicas.push({ id: p.categoria_id, nombre: p.categoria })
    }
  }
  categoriasUnicas.sort((a, b) => a.nombre.localeCompare(b.nombre))

  // Lista filtrada — encadena buscador + 3 filtros en un solo .filter()
  const q = busqueda.trim().toLowerCase()
  const productosFiltrados = productos.filter((p) => {
    if (q && !p.nombre.toLowerCase().includes(q))                              return false
    if (filtros.categoria && p.categoria_id !== Number(filtros.categoria))      return false
    if (filtros.stock === 'con_stock'      && p.existencias === 0)              return false
    if (filtros.stock === 'agotado'        && p.existencias > 0)               return false
    if (filtros.visibilidad === 'visibles'       && !p.visible_en_sitio)       return false
    if (filtros.visibilidad === 'discontinuados' &&  p.visible_en_sitio)       return false
    if (filtros.ubicacion && !p.ubicaciones?.includes(filtros.ubicacion))      return false
    return true
  })

  const resumen = {
    total:          productos.length,
    conStock:       productos.filter((p) => p.existencias > 0).length,
    agotados:       productos.filter((p) => p.existencias === 0).length,
    discontinuados: productos.filter((p) => !p.visible_en_sitio).length,
  }

  const hayFiltros =
    busqueda !== '' ||
    filtros.categoria !== '' ||
    filtros.stock !== 'todos' ||
    filtros.visibilidad !== 'todos' ||
    filtros.ubicacion !== ''

  function limpiarFiltros() {
    setBusqueda('')
    setFiltros({ categoria: '', stock: 'todos', visibilidad: 'todos', ubicacion: '' })
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <Layout>
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Catálogo de productos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {hayFiltros
              ? `${productosFiltrados.length} de ${productos.length} productos`
              : `${productos.length} producto${productos.length !== 1 ? 's' : ''} en total`
            }
          </p>
        </div>
        {puedeEscribir && (
          <button
            onClick={abrirNuevo}
            className="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium
                       px-4 py-2.5 rounded-xl transition-colors shrink-0"
          >
            + Nuevo producto
          </button>
        )}
      </div>

      {/* Resumen de inventario */}
      {!cargando && productos.length > 0 && (
        <ResumenStats resumen={resumen} filtros={filtros} setFiltros={setFiltros} />
      )}

      {/* Barra de controles: buscador + filtros + toggle vista */}
      {!cargando && productos.length > 0 && (
        <BarraControles
          busqueda={busqueda}
          setBusqueda={setBusqueda}
          filtros={filtros}
          setFiltros={setFiltros}
          categorias={categoriasUnicas}
          vista={vista}
          setVista={setVista}
          hayFiltros={hayFiltros}
          limpiarFiltros={limpiarFiltros}
        />
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200
                        rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* Cargando */}
      {cargando && (
        <p className="text-center text-gray-400 py-16 text-sm">Cargando catálogo…</p>
      )}

      {/* Sin productos en DB */}
      {!cargando && !error && productos.length === 0 && (
        <div className="text-center py-16">
          <p className="text-gray-400 mb-4">No hay productos todavía.</p>
          {puedeEscribir && (
            <button
              onClick={abrirNuevo}
              className="bg-amber-600 hover:bg-amber-700 text-white text-sm
                         font-medium px-5 py-2.5 rounded-xl"
            >
              Crear el primer producto
            </button>
          )}
        </div>
      )}

      {/* Sin resultados por filtros */}
      {!cargando && productos.length > 0 && productosFiltrados.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-400 mb-3">
            Ningún producto coincide con la búsqueda o filtros activos.
          </p>
          <button
            onClick={limpiarFiltros}
            className="text-sm text-amber-600 hover:text-amber-700 font-medium"
          >
            Limpiar filtros
          </button>
        </div>
      )}

      {/* Vista CAJAS — grid responsive */}
      {!cargando && productosFiltrados.length > 0 && vista === 'cajas' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {productosFiltrados.map((p) => (
            <TarjetaProducto
              key={p.id}
              producto={p}
              puedeEscribir={puedeEscribir}
              onEditar={() => abrirEditar(p)}
              onDescontinuar={() => setConfirmando(p)}
            />
          ))}
        </div>
      )}

      {/* Vista LISTA — tabla compacta */}
      {!cargando && productosFiltrados.length > 0 && vista === 'lista' && (
        <VistaLista
          productos={productosFiltrados}
          puedeEscribir={puedeEscribir}
          onEditar={abrirEditar}
          onDescontinuar={setConfirmando}
        />
      )}

      {/* Modal crear/editar */}
      {modalAbierto && (
        <ProductoModal
          producto={productoEditando}
          onGuardado={handleGuardado}
          onCerrar={handleCerrarModal}
        />
      )}

      {/* Confirmación de descontinuar */}
      {confirmando && (
        <ConfirmDialog
          titulo="¿Quitar del catálogo?"
          mensaje={
            `"${confirmando.nombre}" dejará de aparecer en el sitio web y el catálogo público. ` +
            `El producto NO se borra — queda guardado para el historial de notas. ` +
            `Puedes reactivarlo editando el producto.`
          }
          textoConfirmar="Sí, quitar del catálogo"
          onConfirmar={handleDescontinuar}
          onCancelar={() => setConfirmando(null)}
        />
      )}
    </Layout>
  )
}


// ── Foto con placeholder ─────────────────────────────────────────────────────
// `url` ya debe ser una URL completa (ej. "/uploads/productos/abc.webp").
// Si es null o undefined, muestra un placeholder con ícono de cámara.
function FotoThumb({ url, alt = '', className = '' }) {
  if (url) {
    return (
      <img
        src={url}
        alt={alt}
        loading="lazy"
        className={`object-cover ${className}`}
      />
    )
  }
  return (
    <div className={`bg-gray-100 flex items-center justify-center ${className}`}>
      <svg
        width="32" height="32" viewBox="0 0 24 24"
        fill="none" stroke="#d1d5db" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
    </div>
  )
}


// ── Tarjeta de producto (vista cajas) ────────────────────────────────────────
// Cuadrada: foto arriba llenando el ancho, datos abajo.
function TarjetaProducto({ producto: p, puedeEscribir, onEditar, onDescontinuar }) {
  const discontinuado = !p.visible_en_sitio
  // urlFoto convierte "productos/abc.webp" → "/uploads/productos/abc.webp"
  const fotoPrincipal = urlFoto(p.fotos?.[0] ?? null)

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden flex flex-col
                     transition-colors ${
      discontinuado
        ? 'border-gray-200 opacity-70'
        : 'border-gray-200 hover:border-amber-200 hover:shadow-sm'
    }`}>

      {/* Foto principal — aspect ratio 4:3 */}
      <div className="aspect-[4/3] bg-gray-100 relative overflow-hidden">
        <FotoThumb url={fotoPrincipal} alt={p.nombre} className="w-full h-full" />
        {discontinuado && (
          <span className="absolute top-2 right-2 text-xs bg-gray-800/70 text-white
                           px-2 py-0.5 rounded-full">
            Oculto
          </span>
        )}
        {p.existencias === 0 && p.visible_en_sitio && (
          <span className="absolute top-2 left-2 text-xs bg-red-600/90 text-white
                           px-2 py-0.5 rounded-full">
            Agotado
          </span>
        )}
      </div>

      {/* Información */}
      <div className="p-3 flex-1 flex flex-col">
        <h3 className={`font-semibold text-sm leading-tight mb-1 ${
          discontinuado ? 'text-gray-400' : 'text-gray-900'
        }`}>
          {p.nombre}
        </h3>

        <p className="text-amber-700 font-bold text-base">{mxn(p.precio_base)}</p>
        {p.costo > 0 && (
          <p className="text-xs text-gray-400 mt-0.5">
            Margen: {mxn(p.precio_base - p.costo)}
            {' '}
            <span className={p.precio_base >= p.costo ? 'text-green-600' : 'text-red-500'}>
              ({p.precio_base > 0
                ? (((p.precio_base - p.costo) / p.precio_base) * 100).toFixed(1) + '%'
                : '—'
              })
            </span>
          </p>
        )}

        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 mt-1">
          {p.categoria && <span>{p.categoria}</span>}
          {p.color && <span className="text-gray-400">{p.color}</span>}
          <span>{p.existencias} en stock</span>
          {p.descuento_pct > 0 && (
            <span className="text-green-600">↓ {p.descuento_pct}%</span>
          )}
        </div>

        {/* Ubicaciones — etiquetas de dónde está físicamente */}
        {p.ubicaciones?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {p.ubicaciones.map((u) => (
              <span key={u}
                className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-100
                           px-1.5 py-0.5 rounded-md leading-none">
                {u}
              </span>
            ))}
          </div>
        )}

        {/* Botones — empujados al fondo de la tarjeta */}
        {puedeEscribir && (
          <div className="flex gap-2 mt-auto pt-3">
            <button
              onClick={onEditar}
              className="flex-1 text-xs py-1.5 border border-gray-300 rounded-lg
                         text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Editar
            </button>
            {!discontinuado && (
              <button
                onClick={onDescontinuar}
                className="flex-1 text-xs py-1.5 border border-red-200 rounded-lg
                           text-red-600 hover:bg-red-50 transition-colors"
              >
                Quitar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}


// ── Vista de lista (tabla compacta) ─────────────────────────────────────────
function VistaLista({ productos, puedeEscribir, onEditar, onDescontinuar }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200 text-left">
            <th className="px-4 py-3 font-semibold text-gray-600 w-8"></th>
            <th className="px-4 py-3 font-semibold text-gray-600">Producto</th>
            <th className="px-4 py-3 font-semibold text-gray-600">Categoría</th>
            <th className="px-4 py-3 font-semibold text-gray-600">Color / Material</th>
            <th className="px-4 py-3 font-semibold text-gray-600 text-right">Stock</th>
            <th className="px-4 py-3 font-semibold text-gray-600 text-right">Precio</th>
            <th className="px-4 py-3 font-semibold text-gray-600 text-right">Costo / Margen</th>
            <th className="px-4 py-3 font-semibold text-gray-600">Estado</th>
            {puedeEscribir && (
              <th className="px-4 py-3 font-semibold text-gray-600 text-right">Acciones</th>
            )}
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
            <FilaProducto
              key={p.id}
              producto={p}
              puedeEscribir={puedeEscribir}
              onEditar={() => onEditar(p)}
              onDescontinuar={() => onDescontinuar(p)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FilaProducto({ producto: p, puedeEscribir, onEditar, onDescontinuar }) {
  const discontinuado = !p.visible_en_sitio
  const fotoPrincipal = urlFoto(p.fotos?.[0] ?? null)

  return (
    <tr className={`border-b border-gray-100 last:border-0 transition-colors ${
      discontinuado ? 'opacity-60 bg-white' : 'bg-white hover:bg-gray-50'
    }`}>
      {/* Miniatura */}
      <td className="pl-4 py-2.5 w-10">
        <div className="w-9 h-9 rounded-lg overflow-hidden bg-gray-100 shrink-0">
          <FotoThumb url={fotoPrincipal} alt="" className="w-full h-full" />
        </div>
      </td>

      <td className="px-3 py-2.5 max-w-[200px]">
        <p className="font-medium text-gray-900 truncate">{p.nombre}</p>
        {p.descuento_pct > 0 && (
          <p className="text-xs text-green-600">↓ {p.descuento_pct}% desc.</p>
        )}
        {p.ubicaciones?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {p.ubicaciones.map((u) => (
              <span key={u}
                className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-100
                           px-1.5 py-0.5 rounded-md leading-none">
                {u}
              </span>
            ))}
          </div>
        )}
      </td>

      <td className="px-4 py-2.5 text-gray-600">{p.categoria ?? '—'}</td>

      <td className="px-4 py-2.5 text-gray-500 text-xs">
        {[p.color, p.material].filter(Boolean).join(' · ') || '—'}
      </td>

      <td className="px-4 py-2.5 text-right">
        <span className={p.existencias === 0 ? 'text-red-500 font-medium' : 'text-gray-700'}>
          {p.existencias}
        </span>
      </td>

      <td className="px-4 py-2.5 text-right font-medium text-gray-700">
        {mxn(p.precio_base)}
      </td>

      <td className="px-4 py-2.5 text-right text-xs">
        {p.costo > 0 ? (
          <>
            <p className="text-gray-500">{mxn(p.costo)}</p>
            <p className={p.precio_base >= p.costo ? 'text-green-600' : 'text-red-500'}>
              {mxn(p.precio_base - p.costo)}
            </p>
          </>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>

      <td className="px-4 py-2.5">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          p.visible_en_sitio
            ? 'bg-green-100 text-green-700'
            : 'bg-gray-100 text-gray-500'
        }`}>
          {p.visible_en_sitio ? 'Visible' : 'Oculto'}
        </span>
      </td>

      {puedeEscribir && (
        <td className="px-4 py-2.5">
          <div className="flex gap-1.5 justify-end">
            <button
              onClick={onEditar}
              className="text-sm px-2.5 py-1 border border-gray-300 rounded-lg
                         text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Editar
            </button>
            {!discontinuado && (
              <button
                onClick={onDescontinuar}
                className="text-sm px-2.5 py-1 border border-red-200 rounded-lg
                           text-red-600 hover:bg-red-50 transition-colors"
              >
                Quitar
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  )
}


// ── Resumen de inventario (chips clicables) ──────────────────────────────────
function ResumenStats({ resumen, filtros, setFiltros }) {
  function cls(activo) {
    return `flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
            border transition-colors cursor-pointer select-none ${
      activo
        ? 'border-amber-400 bg-amber-50 text-amber-700'
        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
    }`
  }
  return (
    <div className="flex gap-2 flex-wrap mb-4">
      <button onClick={() => setFiltros((f) => ({ ...f, stock: 'todos', visibilidad: 'todos' }))}
              className={cls(false)}>
        <span className="font-bold text-gray-800">{resumen.total}</span> productos
      </button>
      <button onClick={() => setFiltros((f) => ({ ...f, stock: 'con_stock' }))}
              className={cls(filtros.stock === 'con_stock')}>
        <span className="font-bold text-green-700">{resumen.conStock}</span> con stock
      </button>
      <button onClick={() => setFiltros((f) => ({ ...f, stock: 'agotado' }))}
              className={cls(filtros.stock === 'agotado')}>
        <span className="font-bold text-amber-700">{resumen.agotados}</span> agotados
      </button>
      <button onClick={() => setFiltros((f) => ({ ...f, visibilidad: 'discontinuados' }))}
              className={cls(filtros.visibilidad === 'discontinuados')}>
        <span className="font-bold text-red-600">{resumen.discontinuados}</span> discontinuados
      </button>
    </div>
  )
}


// ── Barra de controles: buscador + filtros + toggle vista ────────────────────
function BarraControles({
  busqueda, setBusqueda,
  filtros, setFiltros,
  categorias,
  vista, setVista,
  hayFiltros, limpiarFiltros,
}) {
  const selectCls =
    'border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white ' +
    'focus:outline-none focus:ring-2 focus:ring-amber-400'

  return (
    <div className="space-y-2 mb-5">
      {/* Buscador — fila propia, ancho completo en móvil */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre…"
          className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-xl text-sm
                     focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
        />
      </div>

      {/* Filtros desplegables + toggle de vista */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filtros.categoria}
          onChange={(e) => setFiltros((f) => ({ ...f, categoria: e.target.value }))}
          className={selectCls}
        >
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>

        <select
          value={filtros.stock}
          onChange={(e) => setFiltros((f) => ({ ...f, stock: e.target.value }))}
          className={selectCls}
        >
          <option value="todos">Todo el stock</option>
          <option value="con_stock">Con stock</option>
          <option value="agotado">Agotados</option>
        </select>

        <select
          value={filtros.visibilidad}
          onChange={(e) => setFiltros((f) => ({ ...f, visibilidad: e.target.value }))}
          className={selectCls}
        >
          <option value="todos">Todos</option>
          <option value="visibles">Solo visibles</option>
          <option value="discontinuados">Solo discontinuados</option>
        </select>

        <select
          value={filtros.ubicacion}
          onChange={(e) => setFiltros((f) => ({ ...f, ubicacion: e.target.value }))}
          className={selectCls}
        >
          <option value="">Todas las ubicaciones</option>
          <option value="Local Mexico">Local Mexico</option>
          <option value="Local Jose">Local Jose</option>
          <option value="Local Amarillo">Local Amarillo</option>
          <option value="Almacen">Almacen</option>
        </select>

        {hayFiltros && (
          <button
            onClick={limpiarFiltros}
            className="text-sm text-amber-600 hover:text-amber-700 font-medium px-1"
          >
            Limpiar
          </button>
        )}

        {/* Toggle vista — empujado al extremo derecho */}
        <div className="ml-auto flex border border-gray-300 rounded-xl overflow-hidden shrink-0">
          <button
            onClick={() => setVista('cajas')}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              vista === 'cajas' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Cajas
          </button>
          <button
            onClick={() => setVista('lista')}
            className={`px-3 py-2 text-sm font-medium border-l border-gray-300
                        transition-colors ${
              vista === 'lista' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Lista
          </button>
        </div>
      </div>
    </div>
  )
}
