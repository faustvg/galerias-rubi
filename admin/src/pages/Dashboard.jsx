/**
 * Dashboard.jsx — Página de inicio: resumen del negocio de un vistazo.
 *
 * ── ¿CÓMO FUNCIONAN LAS CONSULTAS DE AGREGACIÓN? ──────────────────────────
 *
 *   Las gráficas y los totales NO se calculan en el navegador: los hace la
 *   base de datos con SQL (GROUP BY / SUM). El backend devuelve los resultados
 *   ya resumidos. El frontend solo los muestra.
 *
 *   Ejemplo de lo que le pide el frontend al backend:
 *     GET /dashboard/utilidad
 *
 *   Ejemplo de lo que devuelve el backend:
 *     {
 *       "por_categoria": [
 *         { "nombre": "Salas",    "utilidad": 12500 },
 *         { "nombre": "Comedores","utilidad":  8300 }
 *       ],
 *       "por_proveedor": [ … ],
 *       "por_worker": [ … ]   ← null si eres worker (no ves a tus compañeros)
 *     }
 *
 *   El aislamiento por rol sucede en el SQL del backend: si eres worker,
 *   la consulta agrega WHERE usuario_id = tu_id antes de hacer el GROUP BY.
 *   Tú como frontend ni te enteras — recibes solo tus números.
 *
 * ── DESGLOSES DE UTILIDAD Y TARJETAS DE KPI ───────────────────────────────
 *
 *   Los desgloses de utilidad (categoría/proveedor/sucursal/vendedor) usan
 *   ../components/ListaProporcion.jsx, compartido con Historico.jsx — una
 *   lista simple "nombre — monto" con una barra de proporción sutil, no una
 *   gráfica formal con ejes (ronda 5, #4: el público real de estas
 *   pantallas no lee gráficas seguido). Mismo criterio para las tarjetas
 *   de KPI (../components/KpiTile.jsx) y las filas de lista
 *   (../components/FilaLista.jsx): Inicio y Histórico reusan los mismos
 *   componentes en vez de mantener cada uno su propia versión.
 */

import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../api'
import Layout from '../components/Layout'
import KpiTile from '../components/KpiTile'
import { FilaLista, ListaCard, ListaVacia } from '../components/FilaLista'
import ListaProporcion from '../components/ListaProporcion'

// ── Formateadores de moneda ──────────────────────────────────────────────────
const mxn = (n) =>
  Number(n).toLocaleString('es-MX', {
    style: 'currency', currency: 'MXN',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  })

const formatFecha = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('es-MX', {
    day: 'numeric', month: 'short',
  })

const diasHasta = (iso) => {
  const hoy    = new Date(); hoy.setHours(0, 0, 0, 0)
  const entrega = new Date(iso + 'T00:00:00')
  return Math.round((entrega - hoy) / 86_400_000)
}

// Accesos rápidos (se muestran al tope del dashboard)
const ACCESOS = [
  { href: '/notas',      etiqueta: 'Notas / ventas',  icono: '📋' },
  { href: '/productos',  etiqueta: 'Catálogo',         icono: '🪑' },
  { href: '/categorias', etiqueta: 'Categorías',       icono: '🗂️' },
  { href: '/proveedores',etiqueta: 'Proveedores',      icono: '🏭' },
]

const VENTANAS = [
  { valor: 7,  etiqueta: '1 sem' },
  { valor: 14, etiqueta: '2 sem' },
  { valor: 30, etiqueta: '1 mes' },
]

// ── Componente principal ─────────────────────────────────────────────────────
export default function Dashboard() {
  const { usuario, logout } = useAuth()
  const navigate = useNavigate()

  const [ventana,    setVentana]    = useState(7)
  const [resumen,    setResumen]    = useState(null)
  const [entregas,   setEntregas]   = useState([])
  const [utilidad,   setUtilidad]   = useState(null)
  const [cargando,   setCargando]   = useState(true)
  const [error,      setError]      = useState(null)

  const es_worker = usuario?.rol === 'worker'

  // ── Carga de datos ──────────────────────────────────────────────────────────
  // useCallback memoriza la función para que no se re-cree en cada render.
  // Útil cuando se pasa como dependencia de useEffect.
  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [resRes, entRes, utilRes] = await Promise.all([
        apiFetch(`/dashboard/resumen?ventana=${ventana}`),
        apiFetch('/dashboard/entregas-proximas'),
        apiFetch('/dashboard/utilidad'),
      ])

      if (resRes.status === 401 || entRes.status === 401 || utilRes.status === 401) {
        await logout(); navigate('/login'); return
      }
      if (!resRes.ok || !entRes.ok || !utilRes.ok) {
        throw new Error('No se pudo cargar el dashboard.')
      }

      setResumen(await resRes.json())
      setEntregas(await entRes.json())
      setUtilidad(await utilRes.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }, [ventana, logout, navigate])

  useEffect(() => { cargar() }, [cargar])

  return (
    <Layout>
      {/* Encabezado */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Inicio</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {es_worker ? `Tus números, ${usuario.nombre.split(' ')[0]}` : 'Resumen del negocio'}
          </p>
        </div>
      </div>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {ACCESOS.map((a) => (
          <Link
            key={a.href}
            to={a.href}
            className="bg-white border border-gray-200 rounded-2xl px-4 py-3
                       flex items-center gap-3 hover:border-amber-300 hover:shadow-sm
                       transition-all group"
          >
            <span className="text-xl">{a.icono}</span>
            <span className="text-sm font-medium text-gray-700 group-hover:text-amber-700">
              {a.etiqueta}
            </span>
          </Link>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200
                        rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* Cargando */}
      {cargando && (
        <p className="text-center text-gray-400 py-16 text-sm">Cargando dashboard…</p>
      )}

      {!cargando && resumen && (
        <>
          {/* ── Selector de ventana de tiempo ── */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-gray-500 font-medium">Ver ventas de:</span>
            <div className="flex border border-gray-300 rounded-xl overflow-hidden">
              {VENTANAS.map((v) => (
                <button
                  key={v.valor}
                  onClick={() => setVentana(v.valor)}
                  className={`px-3 py-1.5 text-sm font-medium border-l first:border-l-0
                              border-gray-300 transition-colors ${
                    ventana === v.valor
                      ? 'bg-amber-600 text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {v.etiqueta}
                </button>
              ))}
            </div>
          </div>

          {/* ── Tarjetas de KPIs ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <KpiTile
              etiqueta={`Ventas (${VENTANAS.find((v) => v.valor === ventana)?.etiqueta})`}
              valor={mxn(resumen.total_ventas)}
              sub={`${resumen.num_notas_ventas} nota${resumen.num_notas_ventas !== 1 ? 's' : ''}`}
            />
            <KpiTile
              etiqueta="Resta pendiente"
              valor={mxn(resumen.resta_total)}
              sub={`${resumen.num_notas_resta} nota${resumen.num_notas_resta !== 1 ? 's' : ''} abiertas`}
              acento={resumen.resta_total > 0 ? 'rojo' : 'neutral'}
            />
            <KpiTile
              etiqueta="Entregas próximas"
              valor={`${entregas.length}`}
              sub={entregas.length > 0 ? `Próxima: ${formatFecha(entregas[0].fecha_entrega)}` : 'Ninguna en 30 días'}
            />
          </div>

          {/* ── Entregas próximas (lista) ── Misma FilaLista compartida que
              Histórico — antes esta sección se ocultaba por completo si no
              había entregas próximas; ahora muestra el mismo mensaje
              compacto que el resto de listas vacías (Parte A.6). */}
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Próximas entregas (30 días)
            </h2>
            {entregas.length === 0 ? (
              <ListaVacia mensaje="Ninguna entrega programada en los próximos 30 días." />
            ) : (
              <ListaCard>
                {entregas.map((e, i) => {
                  const dias = diasHasta(e.fecha_entrega)
                  const colorFecha = dias <= 3 ? 'text-red-600' : dias <= 7 ? 'text-amber-600' : 'text-gray-600'
                  return (
                    <FilaLista
                      key={e.folio}
                      to={`/notas/${e.folio}`}
                      titulo={e.etiqueta}
                      meta={e.folio}
                      ultima={i === entregas.length - 1}
                      derecha={
                        <span className={colorFecha}>
                          {formatFecha(e.fecha_entrega)}
                          {dias === 0 ? ' (hoy)' : dias === 1 ? ' (mañana)' : ` (${dias}d)`}
                        </span>
                      }
                      derechaSub={e.resta > 0 && (
                        <span className="text-red-500">Resta {mxn(e.resta)}</span>
                      )}
                    />
                  )
                })}
              </ListaCard>
            )}
          </section>

          {/* ── Gráficas de utilidad ── */}
          {utilidad && (
            <GraficasUtilidad utilidad={utilidad} es_worker={es_worker} />
          )}

          {/* Nota de estimación */}
          <p className="text-xs text-gray-400 text-center mt-4 pb-4">
            * Los márgenes son estimados (basados en costos base del catálogo).
          </p>
        </>
      )}
    </Layout>
  )
}


// ── Sección de desgloses ───────────────────────────────────────────────────
// Listas simples, no gráficas (ver ../components/ListaProporcion.jsx —
// ronda 5, #4) — un solo acento sutil en la barra de proporción, en vez de
// un color por desglose.
function GraficasUtilidad({ utilidad, es_worker }) {
  const { por_categoria, por_proveedor, por_sucursal, por_worker } = utilidad

  const hayDatos = (arr) => arr && arr.some((d) => d.utilidad !== 0)
  const hayAlguna = hayDatos(por_categoria) || hayDatos(por_proveedor) || hayDatos(por_sucursal) || (!es_worker && hayDatos(por_worker))

  if (!hayAlguna) {
    return (
      <ListaVacia mensaje="Aún no hay datos de utilidad. Agrega costos a los productos para ver los márgenes." />
    )
  }

  return (
    <div className="space-y-6">
      {hayDatos(por_categoria) && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Utilidad estimada por categoría</h2>
          <ListaProporcion datos={por_categoria} />
        </section>
      )}
      {hayDatos(por_proveedor) && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Utilidad estimada por proveedor</h2>
          <ListaProporcion datos={por_proveedor} />
        </section>
      )}
      {hayDatos(por_sucursal) && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Utilidad estimada por sucursal</h2>
          <ListaProporcion datos={por_sucursal} />
        </section>
      )}
      {/* Solo admin/superadmin/viewer ven comparación entre workers */}
      {!es_worker && hayDatos(por_worker) && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Utilidad estimada por vendedor</h2>
          <ListaProporcion datos={por_worker} />
        </section>
      )}
    </div>
  )
}
