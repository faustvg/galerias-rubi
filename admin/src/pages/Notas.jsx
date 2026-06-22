/**
 * Notas.jsx — Lista de notas de venta con etiqueta automática, filtros y búsqueda.
 *
 * ── CÓMO SE ARMA LA ETIQUETA AUTOMÁTICA ────────────────────────────────────
 *
 *   El campo `etiqueta` lo calcula el BACKEND. El frontend solo lo muestra.
 *   Así funciona en el servidor (notas.py):
 *
 *     1. Un subquery SQL busca el mueble más caro de cada nota:
 *          SELECT nombre FROM partidas JOIN productos
 *          ORDER BY precio_unitario DESC LIMIT 1
 *        → devuelve, p.ej., "Sala Michelle"
 *
 *     2. Python combina eso con num_partidas y el mes de fecha_pedido:
 *          "Sala Michelle +2 - Jun"   (3 partidas, solo 1 aparece con nombre)
 *          "Sala Michelle - Jun"       (1 sola partida)
 *          "D-00001"                  (sin partidas → fallback al folio)
 *
 *   No se guarda ninguna columna nueva: el dato vive en las partidas y se
 *   recalcula en cada consulta. Cambiar el precio de una partida = etiqueta
 *   diferente automáticamente.
 *
 * ── CÓMO FUNCIONA LA BÚSQUEDA EN PARTIDAS ──────────────────────────────────
 *
 *   Buscar "modular" llega al backend como el param `busqueda=modular`.
 *   El SQL usa ILIKE (case-insensitive) y un EXISTS para las partidas:
 *
 *     WHERE n.consideraciones ILIKE '%modular%'
 *        OR EXISTS (
 *             SELECT 1 FROM partidas par
 *             JOIN productos pr ON pr.id = par.producto_id
 *             WHERE par.folio_pedido = n.folio
 *               AND (par.modificaciones ILIKE '%modular%'
 *                    OR pr.nombre       ILIKE '%modular%')
 *           )
 *
 *   EXISTS para en la primera fila que coincide — eficiente aunque haya
 *   muchas partidas. El '%modular%' va como parámetro (%s), nunca pegado al
 *   SQL como string — sin riesgo de inyección.
 *
 * ── FILTROS: backend vs frontend ───────────────────────────────────────────
 *
 *   Filtros BACKEND (disparan re-fetch):
 *     vendedor_id, fecha_desde, fecha_hasta, busqueda
 *
 *   Filtros FRONTEND (aplican sobre la lista ya cargada):
 *     filtroEstatus — es rápido y no necesita ir al servidor.
 *
 *   El patrón de debounce para busqueda:
 *     busquedaInput  → state del input (cambia en cada tecla)
 *     filtros.busqueda → solo cambia 400ms después de que el usuario para
 *     El useEffect con return clearTimeout evita disparar la fetch
 *     antes de que el usuario termine de escribir.
 */

import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../api'
import Layout from '../components/Layout'

const COLOR_ESTATUS = {
  'Presupuesto': 'bg-gray-100 text-gray-600',
  'En proceso':  'bg-blue-100 text-blue-700',
  'Entregado':   'bg-green-100 text-green-700',
  'Cancelado':   'bg-red-100  text-red-700',
}

const FILTROS_ESTATUS = ['Todos', 'Presupuesto', 'En proceso', 'Entregado', 'Cancelado']

const mxn = (n) =>
  Number(n).toLocaleString('es-MX', {
    style: 'currency', currency: 'MXN',
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  })

const formatFecha = (fecha) =>
  fecha
    ? new Date(fecha + 'T00:00:00').toLocaleDateString('es-MX', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : '—'


export default function Notas() {
  // ── Estado ──────────────────────────────────────────────────────────────────
  const [notas,       setNotas]       = useState([])
  const [vendedores,  setVendedores]  = useState([])
  const [cargando,    setCargando]    = useState(true)
  const [error,       setError]       = useState(null)

  // Filtro de estatus — frontend (aplica sobre la lista ya cargada)
  const [filtroEstatus, setFiltroEstatus] = useState('Todos')

  // Input del buscador — cambia en cada tecla
  const [busquedaInput, setBusquedaInput] = useState('')

  // Filtros backend — un re-fetch ocurre cuando cualquiera cambia
  const [filtros, setFiltros] = useState({
    vendedor_id: '',
    fecha_desde:  '',
    fecha_hasta:  '',
    busqueda:     '',
  })

  const { usuario, logout } = useAuth()
  const navigate = useNavigate()

  const esWorker       = usuario?.rol === 'worker'
  const puedeEscribir  = ['superadmin', 'admin', 'worker'].includes(usuario?.rol)
  const hayFiltrosBE   = filtros.vendedor_id || filtros.fecha_desde ||
                         filtros.fecha_hasta  || filtros.busqueda

  // ── Debounce de busqueda: aplica 400ms después de que el usuario para ─────
  // useEffect devuelve una función de limpieza. React la llama cuando el
  // efecto vuelve a correr (porque busquedaInput cambió), cancelando el
  // timeout anterior. Así solo dispara el fetch cuando el usuario para 400ms.
  useEffect(() => {
    const t = setTimeout(
      () => setFiltros((f) => ({ ...f, busqueda: busquedaInput.trim() })),
      400,
    )
    return () => clearTimeout(t)
  }, [busquedaInput])

  // ── Cargar opciones del menú de vendedores (solo admin/superadmin/viewer) ─
  useEffect(() => {
    if (esWorker || !usuario) return
    apiFetch('/usuarios/vendedores')
      .then((r) => (r.ok ? r.json() : []))
      .then(setVendedores)
      .catch(() => {})
  }, [esWorker, usuario])

  // ── cargarNotas: incluye los filtros backend en la URL ───────────────────
  // useCallback recuerda la función hasta que cambien sus dependencias.
  // filtros es una dependencia: cuando cambia, se re-crea cargarNotas,
  // lo que dispara el useEffect de abajo, lo que llama cargarNotas() nueva.
  const cargarNotas = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filtros.vendedor_id) params.set('vendedor_id', filtros.vendedor_id)
      if (filtros.fecha_desde)  params.set('fecha_desde',  filtros.fecha_desde)
      if (filtros.fecha_hasta)  params.set('fecha_hasta',  filtros.fecha_hasta)
      if (filtros.busqueda)     params.set('busqueda',     filtros.busqueda)
      const qs  = params.toString()
      const url = `/notas${qs ? '?' + qs : ''}`

      const res = await apiFetch(url)
      if (res.status === 401) { await logout(); navigate('/login'); return }
      if (!res.ok) throw new Error('No se pudo cargar las notas.')
      setNotas(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }, [filtros, logout, navigate])

  useEffect(() => { cargarNotas() }, [cargarNotas])

  // ── Valores derivados ─────────────────────────────────────────────────────
  const notasFiltradas = filtroEstatus === 'Todos'
    ? notas
    : notas.filter((n) => n.estatus === filtroEstatus)

  const conteo = notas.reduce((acc, n) => {
    acc[n.estatus] = (acc[n.estatus] ?? 0) + 1
    return acc
  }, {})

  const hayFiltros = hayFiltrosBE || filtroEstatus !== 'Todos'

  function limpiarFiltros() {
    setBusquedaInput('')
    setFiltros({ vendedor_id: '', fecha_desde: '', fecha_hasta: '', busqueda: '' })
    setFiltroEstatus('Todos')
  }

  const selectCls =
    'border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white ' +
    'focus:outline-none focus:ring-2 focus:ring-amber-400'

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Layout>
      {/* ── Encabezado ── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Notas de venta</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {hayFiltros
              ? `${notasFiltradas.length} de ${notas.length} nota${notas.length !== 1 ? 's' : ''}`
              : `${notas.length} nota${notas.length !== 1 ? 's' : ''} en total`
            }
          </p>
        </div>
        {puedeEscribir && (
          <Link
            to="/notas/nueva"
            className="bg-amber-600 text-white text-sm font-medium px-4 py-2.5
                       rounded-xl hover:bg-amber-700 transition-colors shrink-0"
          >
            + Nueva nota
          </Link>
        )}
      </div>

      {/* ── Buscador ── */}
      <div className="relative mb-3">
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
          value={busquedaInput}
          onChange={(e) => setBusquedaInput(e.target.value)}
          placeholder="Buscar en muebles, modificaciones o consideraciones…"
          className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-xl text-sm
                     focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
        />
      </div>

      {/* ── Filtros backend: vendedor + fechas ─────────────────────────────────
          El filtro de vendedor solo es útil para quien puede ver más de un
          vendedor (admin / superadmin / viewer). Workers solo ven las suyas. */}
      {!esWorker && (
        <div className="flex flex-wrap gap-2 mb-3">
          {vendedores.length > 0 && (
            <select
              value={filtros.vendedor_id}
              onChange={(e) =>
                setFiltros((f) => ({ ...f, vendedor_id: e.target.value }))
              }
              className={selectCls}
            >
              <option value="">Todos los vendedores</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>{v.nombre}</option>
              ))}
            </select>
          )}

          <input
            type="date"
            value={filtros.fecha_desde}
            onChange={(e) =>
              setFiltros((f) => ({ ...f, fecha_desde: e.target.value }))
            }
            className={selectCls}
            title="Fecha de pedido desde"
          />
          <input
            type="date"
            value={filtros.fecha_hasta}
            onChange={(e) =>
              setFiltros((f) => ({ ...f, fecha_hasta: e.target.value }))
            }
            className={selectCls}
            title="Fecha de pedido hasta"
          />

          {(filtros.vendedor_id || filtros.fecha_desde || filtros.fecha_hasta) && (
            <button
              onClick={() =>
                setFiltros((f) => ({ ...f, vendedor_id: '', fecha_desde: '', fecha_hasta: '' }))
              }
              className="text-sm text-amber-600 hover:text-amber-700 font-medium px-1"
            >
              Limpiar fechas
            </button>
          )}
        </div>
      )}

      {/* ── Filtros de estatus (frontend) ───────────────────────────────────── */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {FILTROS_ESTATUS.map((f) => {
          const cantidad = f === 'Todos' ? notas.length : (conteo[f] ?? 0)
          return (
            <button
              key={f}
              onClick={() => setFiltroEstatus(f)}
              className={`whitespace-nowrap text-sm px-3 py-1.5 rounded-lg font-medium
                          transition-colors shrink-0 ${
                filtroEstatus === f
                  ? 'bg-amber-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:border-amber-300'
              }`}
            >
              {f}
              {cantidad > 0 && (
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                  filtroEstatus === f ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
                }`}>
                  {cantidad}
                </span>
              )}
            </button>
          )
        })}

        {hayFiltros && (
          <button
            onClick={limpiarFiltros}
            className="whitespace-nowrap text-sm px-3 py-1.5 rounded-lg font-medium
                       text-amber-600 hover:text-amber-700 shrink-0"
          >
            Limpiar todo
          </button>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200
                        rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* ── Cargando ── */}
      {cargando && (
        <p className="text-center text-gray-400 py-16 text-sm">Cargando notas…</p>
      )}

      {/* ── Lista vacía ── */}
      {!cargando && !error && notasFiltradas.length === 0 && (
        <div className="text-center py-16">
          <p className="text-gray-400 mb-1">
            {hayFiltros
              ? 'Ninguna nota coincide con los filtros activos.'
              : 'Todavía no hay notas de venta.'}
          </p>
          {hayFiltros && (
            <button
              onClick={limpiarFiltros}
              className="text-sm text-amber-600 hover:text-amber-700 font-medium mt-2"
            >
              Quitar todos los filtros
            </button>
          )}
        </div>
      )}

      {/* ── Lista de notas ── */}
      {!cargando && notasFiltradas.length > 0 && (
        <div className="space-y-3">
          {notasFiltradas.map((nota) => (
            <TarjetaNota key={nota.folio} nota={nota} />
          ))}
        </div>
      )}
    </Layout>
  )
}


// ── Tarjeta de nota ──────────────────────────────────────────────────────────
// `etiqueta` es el título principal — describe QUÉ se vendió.
// El nombre del cliente pasa a ser dato secundario.
function TarjetaNota({ nota }) {
  const colorEstatus = COLOR_ESTATUS[nota.estatus] ?? 'bg-gray-100 text-gray-600'

  return (
    <Link
      to={`/notas/${nota.folio}`}
      className="block bg-white rounded-2xl border border-gray-200
                 hover:border-amber-200 hover:shadow-sm transition-all p-4"
    >
      {/* Folio + estatus */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs text-gray-400 font-mono">{nota.folio}</span>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${colorEstatus}`}>
          {nota.estatus}
        </span>
      </div>

      {/* Etiqueta — título principal: QUÉ se vendió */}
      <p className="font-semibold text-gray-900 text-base leading-snug">
        {nota.etiqueta}
      </p>

      {/* Cliente y vendedor — secundario */}
      {(nota.nombre_cliente || nota.vendedor) && (
        <p className="text-xs text-gray-400 mt-0.5 truncate">
          {[nota.nombre_cliente, nota.vendedor].filter(Boolean).join(' · ')}
        </p>
      )}

      {/* Fecha de entrega */}
      <p className="text-xs text-gray-400 mt-0.5 mb-3">
        {nota.fecha_entrega
          ? <>Entrega: <span className="text-gray-600">{formatFecha(nota.fecha_entrega)}</span></>
          : formatFecha(nota.fecha_pedido)}
      </p>

      {/* Montos */}
      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-gray-100">
        <Monto etiqueta="Total"    valor={nota.total}    />
        <Monto etiqueta="Pagado"   valor={nota.anticipo} />
        <Monto etiqueta="Resta"    valor={nota.resta}    destaca />
      </div>
    </Link>
  )
}

function Monto({ etiqueta, valor, destaca = false }) {
  const hayPendiente = destaca && Number(valor) > 0
  return (
    <div>
      <p className={`text-sm font-semibold ${hayPendiente ? 'text-amber-700' : 'text-gray-800'}`}>
        {mxn(valor)}
      </p>
      <p className="text-xs text-gray-400">{etiqueta}</p>
    </div>
  )
}
