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
 * ── ¿CÓMO SE USA UNA LIBRERÍA DE GRÁFICAS (RECHARTS)? ───────────────────
 *
 *   Recharts convierte arrays de objetos en SVG.
 *   Regla de oro: tus datos DEBEN ser un array de objetos planos.
 *     [{ nombre: "Salas", utilidad: 12500 }, …]
 *
 *   Componentes clave:
 *
 *   <ResponsiveContainer width="100%" height={220}>
 *     ← Hace que la gráfica se ajuste al ancho del contenedor padre.
 *       SIEMPRE úsalo para que el gráfico sea responsivo.
 *
 *     <BarChart data={datos}>
 *       ← Le dices CUÁLES son los datos. Cada objeto = una barra.
 *
 *       <XAxis dataKey="nombre" />
 *         ← Eje X: qué campo de cada objeto es la etiqueta.
 *
 *       <YAxis tickFormatter={mxnCorto} />
 *         ← Eje Y: número. tickFormatter formatea las marcas (ej. "$12K").
 *
 *       <Tooltip formatter={mxnFormatter} />
 *         ← Tooltip al pasar el mouse. formatter = cómo mostrar el valor.
 *
 *       <Bar dataKey="utilidad" fill="#f59e0b" radius={[4,4,0,0]} />
 *         ← Las barras. dataKey = qué campo es la altura. fill = color.
 *
 *     </BarChart>
 *   </ResponsiveContainer>
 *
 *   Eso es todo. Recharts hace el SVG, tú solo describes el esquema.
 */

import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../api'
import Layout from '../components/Layout'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'

// ── Formateadores de moneda ──────────────────────────────────────────────────
const mxn = (n) =>
  Number(n).toLocaleString('es-MX', {
    style: 'currency', currency: 'MXN',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  })

// Para las marcas del eje Y — número compacto ($12K, $1.2M)
const mxnCorto = (v) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v}`
}

// Para el tooltip de recharts (recibe [valor, nombre])
const mxnTooltip = (value) => [mxn(value), 'Utilidad estimada']

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
            <KpiCard
              etiqueta={`Ventas (${VENTANAS.find((v) => v.valor === ventana)?.etiqueta})`}
              valor={mxn(resumen.total_ventas)}
              sub={`${resumen.num_notas_ventas} nota${resumen.num_notas_ventas !== 1 ? 's' : ''}`}
              color="amber"
            />
            <KpiCard
              etiqueta="Resta pendiente"
              valor={mxn(resumen.resta_total)}
              sub={`${resumen.num_notas_resta} nota${resumen.num_notas_resta !== 1 ? 's' : ''} abiertas`}
              color={resumen.resta_total > 0 ? 'red' : 'green'}
            />
            <KpiCard
              etiqueta="Entregas próximas"
              valor={`${entregas.length}`}
              sub={entregas.length > 0 ? `Próxima: ${formatFecha(entregas[0].fecha_entrega)}` : 'Ninguna en 30 días'}
              color={entregas.length > 0 ? 'blue' : 'gray'}
            />
          </div>

          {/* ── Entregas próximas (lista) ── */}
          {entregas.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Próximas entregas (30 días)
              </h2>
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                {entregas.map((e, i) => {
                  const dias = diasHasta(e.fecha_entrega)
                  return (
                    <Link
                      key={e.folio}
                      to={`/notas/${e.folio}`}
                      className={`flex items-center justify-between gap-3 px-4 py-3
                                  hover:bg-amber-50 transition-colors ${
                        i < entregas.length - 1 ? 'border-b border-gray-100' : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {e.etiqueta}
                        </p>
                        <p className="text-xs text-gray-400 font-mono">{e.folio}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-xs font-semibold ${
                          dias <= 3 ? 'text-red-600' : dias <= 7 ? 'text-amber-600' : 'text-gray-600'
                        }`}>
                          {formatFecha(e.fecha_entrega)}
                          {dias === 0 ? ' (hoy)' : dias === 1 ? ' (mañana)' : ` (${dias}d)`}
                        </p>
                        {e.resta > 0 && (
                          <p className="text-xs text-red-500">
                            Resta {mxn(e.resta)}
                          </p>
                        )}
                      </div>
                    </Link>
                  )
                })}
              </div>
            </section>
          )}

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


// ── Tarjeta de KPI ────────────────────────────────────────────────────────────
const COLOR_MAP = {
  amber: 'bg-amber-50 border-amber-200 text-amber-700',
  red:   'bg-red-50   border-red-200   text-red-700',
  green: 'bg-green-50 border-green-200 text-green-700',
  blue:  'bg-blue-50  border-blue-200  text-blue-700',
  gray:  'bg-gray-50  border-gray-200  text-gray-600',
}

function KpiCard({ etiqueta, valor, sub, color = 'gray' }) {
  const cls = COLOR_MAP[color] ?? COLOR_MAP.gray
  return (
    <div className={`rounded-2xl border px-5 py-4 ${cls}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">
        {etiqueta}
      </p>
      <p className="text-2xl font-bold leading-tight">{valor}</p>
      {sub && <p className="text-xs mt-1 opacity-70">{sub}</p>}
    </div>
  )
}


// ── Sección de gráficas ───────────────────────────────────────────────────────
function GraficasUtilidad({ utilidad, es_worker }) {
  const { por_categoria, por_proveedor, por_worker } = utilidad

  const hayDatos = (arr) => arr && arr.some((d) => d.utilidad !== 0)

  return (
    <div className="space-y-6">
      {hayDatos(por_categoria) && (
        <GraficarBarras
          titulo="Utilidad estimada por categoría"
          datos={por_categoria}
          color="#f59e0b"
        />
      )}
      {hayDatos(por_proveedor) && (
        <GraficarBarras
          titulo="Utilidad estimada por proveedor"
          datos={por_proveedor}
          color="#6366f1"
        />
      )}
      {/* Solo admin/superadmin/viewer ven comparación entre workers */}
      {!es_worker && hayDatos(por_worker) && (
        <GraficarBarras
          titulo="Utilidad estimada por vendedor"
          datos={por_worker}
          color="#10b981"
        />
      )}
      {!hayDatos(por_categoria) && !hayDatos(por_proveedor) && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl px-5 py-8 text-center">
          <p className="text-sm text-gray-400">
            Aún no hay datos de utilidad.
            Agrega costos a los productos para ver los márgenes.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Gráfica de barras (wrapper de recharts) ───────────────────────────────────
// datos = [{ nombre: string, utilidad: number }]
function GraficarBarras({ titulo, datos, color }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
        {titulo}
      </h2>
      <div className="bg-white border border-gray-200 rounded-2xl p-4">
        {/*
          ResponsiveContainer hace que la gráfica mida el ancho del div padre
          automáticamente y se ajuste al hacer resize. Sin él, la gráfica tendría
          ancho fijo y rompería en móvil. height sí se pone fijo en píxeles.
        */}
        <ResponsiveContainer width="100%" height={datos.length > 5 ? 280 : 200}>
          <BarChart
            data={datos}
            layout="vertical"
            margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
            <XAxis
              type="number"
              tickFormatter={mxnCorto}
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="nombre"
              width={110}
              tick={{ fontSize: 12, fill: '#374151' }}
              axisLine={false}
              tickLine={false}
            />
            {/*
              Tooltip: formatter recibe (valor, nombre_del_campo).
              Devuelve [etiquetaFormateada, nombreSerie].
            */}
            <Tooltip
              formatter={mxnTooltip}
              contentStyle={{
                borderRadius: '12px',
                border: '1px solid #e5e7eb',
                fontSize: '13px',
              }}
              cursor={{ fill: '#fef3c7' }}
            />
            <Bar
              dataKey="utilidad"
              fill={color}
              radius={[0, 4, 4, 0]}
              maxBarSize={28}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
