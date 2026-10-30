/**
 * Dashboard.jsx — Página de inicio: cómo va el negocio en los últimos días.
 *
 * Mismo lenguaje visual que Histórico (piezas compartidas en
 * ../components/Tablero.jsx), pero con otra pregunta: Histórico revisa un
 * mes o semana cerrados; Inicio mira la ventana reciente (1 sem / 2 sem /
 * 1 mes hasta hoy) y lo que viene (entregas próximas, resta por cobrar).
 *
 *   - Ventas y Cobros: GET /dashboard/historico/serie de la ventana y de la
 *     ventana anterior del mismo largo (Δ), columnas apiladas por local.
 *   - Resta pendiente: GET /dashboard/resumen (todas las notas abiertas,
 *     no solo las de la ventana).
 *   - Próximas entregas: GET /dashboard/entregas-proximas (30 días).
 *   - Rentabilidad: GET /dashboard/historico/utilidad de la misma ventana
 *     y de la anterior (Δ), igual que en Histórico.
 *
 * El aislamiento por rol lo hace el backend: un worker recibe solo sus notas.
 */

import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../api'
import Layout from '../components/Layout'
import { FilaLista, ListaVacia } from '../components/FilaLista'
import { toISO, rangoAnterior } from '../lib/periodos'
import {
  mxn, formatDiaCorto, Tarjeta, TarjetaGrafica, TarjetaKpi, TablaUtilidad,
} from '../components/Tablero'

const diasHasta = (iso) => {
  const hoy     = new Date(); hoy.setHours(0, 0, 0, 0)
  const entrega = new Date(iso + 'T00:00:00')
  return Math.round((entrega - hoy) / 86_400_000)
}

const ACCESOS = [
  { href: '/notas',       etiqueta: 'Notas' },
  { href: '/productos',   etiqueta: 'Catálogo' },
  { href: '/categorias',  etiqueta: 'Categorías' },
  { href: '/proveedores', etiqueta: 'Proveedores' },
]

const VENTANAS = [
  { valor: 7,  etiqueta: '1 sem',  previo: 'Semana anterior' },
  { valor: 14, etiqueta: '2 sem',  previo: '2 semanas anteriores' },
  { valor: 30, etiqueta: '1 mes',  previo: 'Mes anterior' },
]

// Últimos N días contando hoy.
function rangoVentana(dias) {
  const desde = new Date()
  desde.setDate(desde.getDate() - (dias - 1))
  return { desde: toISO(desde), hasta: toISO(new Date()) }
}

const suma = (serie, clave) => (serie || []).reduce((s, d) => s + d[clave], 0)

function saludo() {
  const h = new Date().getHours()
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function Dashboard() {
  const { usuario, logout } = useAuth()
  const navigate = useNavigate()

  const [ventana,  setVentana]  = useState(7)
  const [resumen,  setResumen]  = useState(null)
  const [entregas, setEntregas] = useState([])
  const [utilidad, setUtilidad] = useState(null)
  const [utilidadAnt, setUtilidadAnt] = useState(null)
  const [serie,    setSerie]    = useState(null)
  const [serieAnt, setSerieAnt] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error,    setError]    = useState(null)

  const es_worker = usuario?.rol === 'worker'
  const infoVentana = VENTANAS.find((v) => v.valor === ventana)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const actual = rangoVentana(ventana)
      const previo = rangoAnterior(actual)
      const qs = (r) => `fecha_desde=${r.desde}&fecha_hasta=${r.hasta}`
      const respuestas = await Promise.all([
        apiFetch(`/dashboard/resumen?ventana=${ventana}`),
        apiFetch('/dashboard/entregas-proximas'),
        apiFetch(`/dashboard/historico/utilidad?${qs(actual)}`),
        apiFetch(`/dashboard/historico/serie?${qs(actual)}`),
        apiFetch(`/dashboard/historico/serie?${qs(previo)}`),
        apiFetch(`/dashboard/historico/utilidad?${qs(previo)}`),
      ])
      if (respuestas.some((r) => r.status === 401)) {
        await logout(); navigate('/login'); return
      }
      if (respuestas.some((r) => !r.ok)) {
        throw new Error('No se pudo cargar el inicio.')
      }
      const [res, ent, util, ser, serA, utilA] = await Promise.all(respuestas.map((r) => r.json()))
      setResumen(res)
      setEntregas(ent)
      setUtilidad(util)
      setUtilidadAnt(utilA)
      setSerie(ser)
      setSerieAnt(serA)
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }, [ventana, logout, navigate])

  useEffect(() => { cargar() }, [cargar])

  const hoyLargo = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
  const nombre = usuario?.nombre?.split(' ')[0] ?? ''

  return (
    <Layout>
      {/* ── Encabezado ── */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="font-serif text-4xl font-semibold text-gray-900 leading-none">
            {saludo()}{nombre && `, ${nombre}`}
          </h1>
          <p className="text-sm text-gray-500 mt-2 first-letter:uppercase">
            {hoyLargo} · {es_worker ? 'tus números' : 'resumen del negocio'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full bg-gray-200/60 p-1" role="group" aria-label="Ventana de tiempo">
            {VENTANAS.map((v) => (
              <button
                key={v.valor}
                onClick={() => setVentana(v.valor)}
                aria-pressed={ventana === v.valor}
                className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all ${
                  ventana === v.valor
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {v.etiqueta}
              </button>
            ))}
          </div>
          <Link
            to="/notas/nueva"
            className="px-4 py-2 rounded-full bg-amber-600 text-white text-sm font-medium
                       hover:bg-amber-700 transition-colors shadow-sm"
          >
            + Nueva nota
          </Link>
        </div>
      </div>

      {/* ── Accesos rápidos ── */}
      <nav className="flex flex-wrap gap-2 mb-6" aria-label="Accesos rápidos">
        {ACCESOS.map((a) => (
          <Link
            key={a.href}
            to={a.href}
            className="text-sm px-4 py-1.5 rounded-full border border-gray-200 bg-white
                       text-gray-600 hover:border-amber-300 hover:text-amber-700 transition-colors"
          >
            {a.etiqueta} →
          </Link>
        ))}
      </nav>

      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {cargando && (
        <p className="text-center text-gray-400 py-16 text-sm">Cargando…</p>
      )}

      {!cargando && resumen && serie && (
        <>
          {/* ── Ventas | Cobros | lo pendiente ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <TarjetaGrafica
              titulo="Ventas"
              actual={suma(serie, 'ventas')}
              previo={suma(serieAnt, 'ventas')}
              sub={`Últimos ${ventana} días`}
              serie={serie}
              clave="ventas"
              etiquetaPrevio={infoVentana.previo}
            />
            <TarjetaGrafica
              titulo="Cobros"
              actual={suma(serie, 'cobros')}
              previo={suma(serieAnt, 'cobros')}
              sub={`Últimos ${ventana} días`}
              serie={serie}
              clave="cobros"
              etiquetaPrevio={infoVentana.previo}
            />
            <div className="space-y-4 min-w-0">
              <TarjetaKpi
                etiqueta="Resta por cobrar"
                valor={mxn(resumen.resta_total)}
                sub={`${resumen.num_notas_resta} nota${resumen.num_notas_resta !== 1 ? 's' : ''} abierta${resumen.num_notas_resta !== 1 ? 's' : ''}`}
              />
              <PanelEntregasProximas entregas={entregas} />
            </div>
          </div>

          {/* ── Rentabilidad de la misma ventana ── */}
          {utilidad && (
            <SeccionRentabilidad
              utilidad={utilidad}
              anterior={utilidadAnt}
              ventana={ventana}
              es_worker={es_worker}
            />
          )}

          <p className="text-xs text-gray-400 text-center mt-6 pb-4">
            Comparación contra {infoVentana.previo.toLowerCase()}.
            Las utilidades son estimadas (precio base − costo del catálogo).
          </p>
        </>
      )}
    </Layout>
  )
}


// ── Próximas entregas (30 días) ──────────────────────────────────────────────
const LIMITE_ENTREGAS = 6

function PanelEntregasProximas({ entregas }) {
  const [verTodas, setVerTodas] = useState(false)
  const visibles = verTodas ? entregas : entregas.slice(0, LIMITE_ENTREGAS)

  return (
    <Tarjeta titulo="Próximas entregas" derecha={entregas.length || null}>
      {entregas.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-gray-400">Ninguna en los próximos 30 días.</p>
      ) : (
        <>
          {visibles.map((e, i) => {
            const dias = diasHasta(e.fecha_entrega)
            const colorFecha = dias <= 3 ? 'text-red-600' : dias <= 7 ? 'text-amber-700' : 'text-gray-600'
            return (
              <FilaLista
                key={e.folio}
                to={`/notas/${e.folio}`}
                titulo={e.etiqueta}
                meta={e.folio}
                ultima={i === visibles.length - 1 && entregas.length <= LIMITE_ENTREGAS}
                derecha={
                  <span className={colorFecha}>
                    {dias === 0 ? 'Hoy' : dias === 1 ? 'Mañana' : formatDiaCorto(e.fecha_entrega)}
                  </span>
                }
                derechaSub={e.resta > 0
                  ? <span className="text-red-600">Resta {mxn(e.resta)}</span>
                  : <span className="text-gray-400">{dias > 1 ? `en ${dias} días` : 'pagada'}</span>}
              />
            )
          })}
          {entregas.length > LIMITE_ENTREGAS && (
            <button
              onClick={() => setVerTodas((v) => !v)}
              className="w-full text-xs font-medium text-amber-700 hover:text-amber-800 py-2.5 border-t border-gray-100"
            >
              {verTodas ? 'Ver menos' : `Ver todas (${entregas.length})`}
            </button>
          )}
        </>
      )}
    </Tarjeta>
  )
}


// ── Rentabilidad: utilidad de la ventana elegida, con Δ contra la anterior ──
function SeccionRentabilidad({ utilidad, anterior, ventana, es_worker }) {
  const tablas = [
    { titulo: 'Por categoría', clave: 'por_categoria' },
    { titulo: 'Por proveedor', clave: 'por_proveedor' },
    { titulo: 'Por local',     clave: 'por_local' },
    ...(!es_worker ? [{ titulo: 'Por vendedor', clave: 'por_worker' }] : []),
  ].filter((t) => (utilidad?.[t.clave] || []).some((d) => d.utilidad !== 0))

  return (
    <>
      <h2 className="font-serif text-2xl font-semibold text-gray-900 mt-10 mb-3">
        Rentabilidad <span className="text-base font-sans font-normal text-gray-400">últimos {ventana} días</span>
      </h2>
      {tablas.length === 0 ? (
        <ListaVacia mensaje="Sin utilidad registrada en estos días (o los productos vendidos no tienen costo)." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          {tablas.map((t) => (
            <TablaUtilidad
              key={t.clave}
              titulo={t.titulo}
              filas={utilidad[t.clave]}
              filasAnt={anterior?.[t.clave] ?? []}
            />
          ))}
        </div>
      )}
    </>
  )
}
