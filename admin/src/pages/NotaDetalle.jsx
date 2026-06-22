/**
 * NotaDetalle.jsx — Vista completa de una nota de venta.
 *
 * ── PATRÓN NUEVO: useParams ────────────────────────────────────────────────
 *
 *   React Router guarda los segmentos dinámicos de la URL en un objeto que
 *   puedes leer con useParams(). Si la ruta está declarada como:
 *
 *       <Route path="/notas/:folio" element={<NotaDetalle />} />
 *
 *   entonces:
 *
 *       const { folio } = useParams()
 *       // folio === "D-00001"  (lo que aparece en la barra de URL)
 *
 *   No tienes que pasar el folio como prop ni guardarlo en un estado. React
 *   Router lo mantiene sincronizado con la URL automáticamente. Si el usuario
 *   copia el enlace y lo abre en otra pestaña, useParams() lo lee igual.
 *
 * ── PATRÓN RECORDADO: datos distintos según el rol ─────────────────────────
 *
 *   puedeEscribir controla qué botones se muestran.
 *   El DATO en sí (la nota) es el mismo para todos — el backend filtra qué
 *   notas puede ver cada rol, pero el formato de la vista es idéntico.
 *   Un worker ve sus propias notas igual que un admin ve las de todos.
 */

import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch, urlFoto } from '../api'
import Layout from '../components/Layout'

const COLOR_ESTATUS = {
  'Presupuesto': 'bg-gray-100 text-gray-600',
  'En proceso':  'bg-blue-100 text-blue-700',
  'Entregado':   'bg-green-100 text-green-700',
  'Cancelado':   'bg-red-100  text-red-700',
}

const mxn = (n) =>
  Number(n).toLocaleString('es-MX', {
    style: 'currency', currency: 'MXN',
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  })

const formatFecha = (fecha) =>
  fecha
    ? new Date(fecha + 'T00:00:00').toLocaleDateString('es-MX', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : '—'


export default function NotaDetalle() {
  // useParams extrae el ":folio" de la URL, por ej. "D-00001"
  const { folio } = useParams()
  const navigate  = useNavigate()
  const { usuario, logout } = useAuth()

  const [nota, setNota]       = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError]     = useState(null)

  // Un viewer nunca puede editar.
  // Un worker solo puede editar sus propias notas — pero no sabemos la nota
  // hasta que cargue. Lo resolvemos en ContenidoNota pasando usuario.
  const puedeEscribir = ['superadmin', 'admin', 'worker'].includes(usuario?.rol)

  // ── Cargar la nota al montar el componente ─────────────────────────────────
  // La dependencia [folio] significa: si la URL cambia de /notas/D-00001 a
  // /notas/D-00002 (sin desmontar el componente), el efecto vuelve a correr
  // y carga la nota correcta.
  useEffect(() => {
    let cancelado = false

    async function cargar() {
      setCargando(true)
      setError(null)
      try {
        const res = await apiFetch(`/notas/${folio}`)
        if (res.status === 401) { await logout(); navigate('/login'); return }
        if (res.status === 404) { setError('Esta nota no existe o no tienes acceso.'); return }
        if (!res.ok) throw new Error('No se pudo cargar la nota.')
        const datos = await res.json()
        if (!cancelado) setNota(datos)
      } catch (err) {
        if (!cancelado) setError(err.message)
      } finally {
        if (!cancelado) setCargando(false)
      }
    }

    cargar()

    // Función de limpieza: si el componente se desmonta antes de que
    // termine la petición, ignoramos el resultado (evita actualizar
    // estado en un componente ya desmontado).
    return () => { cancelado = true }
  }, [folio, logout, navigate])


  return (
    <Layout>
      {/* ── Botón de regreso ── */}
      <div className="mb-5">
        <Link
          to="/notas"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500
                     hover:text-amber-700 transition-colors font-medium"
        >
          ← Volver a notas
        </Link>
      </div>

      {/* ── Estado de carga ── */}
      {cargando && (
        <p className="text-center text-gray-400 py-20 text-sm">Cargando nota…</p>
      )}

      {/* ── Error ── */}
      {!cargando && error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-6 text-center">
          <p className="text-red-700 font-medium mb-3">{error}</p>
          <Link to="/notas" className="text-sm text-amber-600 hover:text-amber-700 font-medium">
            Ver todas las notas
          </Link>
        </div>
      )}

      {/* ── Contenido principal ── */}
      {!cargando && nota && <ContenidoNota nota={nota} usuario={usuario} puedeEscribir={puedeEscribir} />}
    </Layout>
  )
}


// ── Contenido de la nota ─────────────────────────────────────────────────────
// Separado en su propio componente para que el JSX sea legible.
function ContenidoNota({ nota, usuario, puedeEscribir }) {
  const colorEstatus = COLOR_ESTATUS[nota.estatus] ?? 'bg-gray-100 text-gray-600'
  const hayResta = Number(nota.resta) > 0

  // Un worker solo puede editar sus propias notas.
  // Admin y superadmin pueden editar cualquiera.
  const puedeEditar = puedeEscribir && (
    usuario?.rol !== 'worker' || nota.usuario_id === usuario?.id
  )

  // ── Descarga de PDF ────────────────────────────────────────────────────────
  const [descargando, setDescargando] = useState(false)
  const [errorPDF,    setErrorPDF]    = useState(null)

  async function handleDescargarPDF() {
    setDescargando(true)
    setErrorPDF(null)
    try {
      const res = await apiFetch(`/notas/${nota.folio}/pdf`)
      if (!res.ok) throw new Error('No se pudo generar el PDF.')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `nota-${nota.folio}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // Dar tiempo al navegador para iniciar la descarga antes de revocar el URL temporal.
      // Si se revoca inmediatamente, el navegador no puede leer el blob y la descarga falla.
      setTimeout(() => URL.revokeObjectURL(url), 1500)
    } catch (err) {
      setErrorPDF(err.message)
    } finally {
      setDescargando(false)
    }
  }

  return (
    <div className="space-y-4">

      {/* ── Encabezado: folio + estatus ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-gray-400 font-mono mb-1">{nota.folio}</p>
            <h1 className="text-xl font-bold text-gray-900">
              {nota.nombre_cliente || <span className="text-gray-400 italic font-normal">Sin nombre de cliente</span>}
            </h1>
            {nota.telefono && (
              <a
                href={`tel:${nota.telefono}`}
                className="text-sm text-amber-700 hover:underline mt-0.5 block"
              >
                {nota.telefono}
              </a>
            )}
          </div>
          <span className={`text-sm font-medium px-3 py-1 rounded-full shrink-0 ${colorEstatus}`}>
            {nota.estatus}
          </span>
        </div>

        {/* Fechas */}
        <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-100">
          <Campo etiqueta="Pedido"   valor={formatFecha(nota.fecha_pedido)} />
          <Campo etiqueta="Entrega"  valor={formatFecha(nota.fecha_entrega)} />
          {nota.vendedor && <Campo etiqueta="Vendedor" valor={nota.vendedor} />}
        </div>
      </div>

      {/* ── Montos — lo más importante, destacado ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Resumen financiero
        </p>
        <div className="grid grid-cols-3 gap-3">
          <CeldaMonto etiqueta="Total"    valor={nota.total}    grande />
          <CeldaMonto etiqueta="Cantidad Pagada" valor={nota.anticipo} />
          <CeldaMonto etiqueta="Resta"    valor={nota.resta}    pendiente={hayResta} />
        </div>
      </div>

      {/* ── Partidas ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Artículos ({nota.partidas.length})
        </p>

        {nota.partidas.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">
            No hay artículos en esta nota.
          </p>
        ) : (
          <div className="space-y-2">
            {nota.partidas.map((p) => (
              <FilaPartida key={p.id} partida={p} />
            ))}

            {/* Total de partidas */}
            <div className="flex justify-between items-center pt-3 border-t border-gray-200 mt-1">
              <span className="text-sm text-gray-500">
                {nota.partidas.length} artículo{nota.partidas.length !== 1 ? 's' : ''}
              </span>
              <span className="font-bold text-gray-900">{mxn(nota.total)}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Consideraciones ── */}
      {nota.consideraciones && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">
            Consideraciones
          </p>
          <p className="text-sm text-amber-900 whitespace-pre-wrap">{nota.consideraciones}</p>
        </div>
      )}

      {/* ── Foto de la nota física ── */}
      {nota.foto_nota && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Foto del talonario
          </p>
          <img
            src={urlFoto(nota.foto_nota)}
            alt="Foto de la nota física"
            className="w-full max-w-sm rounded-xl border border-gray-200"
          />
        </div>
      )}

      {/* ── Botones de acción ── */}
      <div className="pt-1 pb-6 space-y-2">
        {/* PDF — disponible para todos (incluyendo viewers) */}
        {errorPDF && (
          <p className="text-xs text-red-600 text-center">{errorPDF}</p>
        )}
        <button
          onClick={handleDescargarPDF}
          disabled={descargando}
          className="block w-full border border-gray-200 text-gray-700 text-sm font-medium
                     py-3 rounded-xl hover:bg-gray-50 disabled:opacity-50
                     disabled:cursor-not-allowed transition-colors text-center"
        >
          {descargando ? 'Generando PDF…' : 'Descargar PDF / Imprimir nota'}
        </button>

        {puedeEditar && (
          <Link
            to={`/notas/${nota.folio}/editar`}
            className="block w-full bg-amber-600 text-white text-sm font-semibold
                       py-3 rounded-xl hover:bg-amber-700 transition-colors text-center"
          >
            Editar nota
          </Link>
        )}
      </div>

    </div>
  )
}


// ── Componentes auxiliares ───────────────────────────────────────────────────

function Campo({ etiqueta, valor }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{etiqueta}</p>
      <p className="text-sm font-medium text-gray-800 mt-0.5">{valor}</p>
    </div>
  )
}

function CeldaMonto({ etiqueta, valor, grande = false, pendiente = false }) {
  return (
    <div className={`rounded-xl p-3 ${pendiente ? 'bg-amber-50' : 'bg-gray-50'}`}>
      <p className={`font-bold ${grande ? 'text-xl' : 'text-base'} ${
        pendiente ? 'text-amber-700' : 'text-gray-900'
      }`}>
        {mxn(valor)}
      </p>
      <p className={`text-xs mt-0.5 ${pendiente ? 'text-amber-500' : 'text-gray-400'}`}>
        {etiqueta}
      </p>
    </div>
  )
}

function FilaPartida({ partida }) {
  const nombreProducto = partida.nombre_producto || 'Producto sin catálogo'

  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-gray-100
                    last:border-0">
      {/* Descripción */}
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 leading-snug">
          {nombreProducto}
        </p>
        {partida.modificaciones && (
          <p className="text-xs text-gray-400 mt-0.5 italic">{partida.modificaciones}</p>
        )}
        <p className="text-xs text-gray-400 mt-0.5">
          {partida.cantidad} × {mxn(partida.precio_unitario)}
        </p>
      </div>

      {/* Importe */}
      <p className="text-sm font-semibold text-gray-900 shrink-0">
        {mxn(partida.importe)}
      </p>
    </div>
  )
}
