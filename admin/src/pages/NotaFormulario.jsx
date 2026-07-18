/**
 * NotaFormulario.jsx — Crear o editar una nota de venta.
 *
 * Un mismo componente sirve para ambos modos:
 *   /notas/nueva          → modoEdicion = false, formulario vacío
 *   /notas/:folio/editar  → modoEdicion = true, carga datos existentes
 *
 * ── PATRÓN CENTRAL: LISTA DINÁMICA DE PARTIDAS ────────────────────────────
 *
 *   Una partida es un objeto en un array de estado. Tiene tres operaciones:
 *   agregar, quitar y actualizar un campo de una línea específica.
 *
 *   La clave para hacerlo bien es el campo `_key`:
 *
 *     const [partidas, setPartidas] = useState([
 *       { _key: 1234, producto_id: null, cantidad: 1, precio_unitario: '' },
 *       { _key: 5678, producto_id: 3,    cantidad: 2, precio_unitario: '3500' },
 *     ])
 *
 *   ¿Por qué `_key` y no el índice del array?
 *   Si usaras el índice como key en React (key={idx}), al borrar la partida 0
 *   la partida 1 se convierte en "índice 0", React la compara con la DOM del
 *   índice 0 (que era diferente) y puede mezclar valores de inputs no
 *   controlados. El `_key` es estable: un Date.now() al crear, el id de DB
 *   al cargar un pedido existente. Nunca cambia aunque muevas o borres filas.
 *
 *   Agregar → spread + nuevo objeto al final:
 *     setPartidas(prev => [...prev, nuevaPartida()])
 *
 *   Quitar → filter descarta el elemento con ese _key:
 *     setPartidas(prev => prev.filter(p => p._key !== key))
 *
 *   Actualizar campo → map: si _key coincide, spread + campo nuevo; si no, sin cambios:
 *     setPartidas(prev => prev.map(p =>
 *       p._key !== key ? p : { ...p, [campo]: valor }
 *     ))
 *
 *   Este patrón escala a cualquier número de campos por fila y cualquier
 *   número de filas, sin código duplicado.
 *
 * ── PATRÓN: CARGA PARALELA ────────────────────────────────────────────────
 *
 *   Los datos de referencia (vendedores, productos) y la nota a editar
 *   son independientes: se pueden cargar a la vez con Promise.all:
 *
 *     const [resV, resP] = await Promise.all([
 *       apiFetch('/usuarios/vendedores'),
 *       apiFetch('/productos'),
 *     ])
 *
 *   Esto es más rápido que esperar uno, luego el otro (secuencial).
 */

import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch, urlFoto } from '../api'
import Layout from '../components/Layout'

// ── Constantes ─────────────────────────────────────────────────────────────

const ESTATUS_OPCIONES = ['Presupuesto', 'En proceso', 'Entregado']

// Fecha de hoy en formato YYYY-MM-DD (el que esperan los <input type="date">)
const hoy = () => new Date().toISOString().slice(0, 10)

// Estado inicial del encabezado — cadenas vacías para que los inputs sean siempre controlados
const CABECERA_INICIAL = {
  nombre_cliente: '',
  telefono: '',
  fecha_pedido: hoy(),
  fecha_entrega: '',
  vendedor_id: '',
  total: '',
  anticipo: '',
  estatus: 'Presupuesto',
  consideraciones: '',
}

// Genera una nueva partida vacía con un _key único
// Date.now() + random evita colisiones si el usuario agrega dos filas rápido
const nuevaPartida = () => ({
  _key: Date.now() + Math.random(),
  producto_id: null,
  nombre_producto: '',   // solo para mostrar en el select, no se envía al backend
  cantidad: 1,
  modificaciones: '',
  precio_unitario: '',
})

// Clases CSS comunes para los inputs — definidas aquí para no repetirlas
const estiloInput = [
  'block w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5',
  'text-sm text-gray-900 focus:outline-none focus:border-amber-400',
  'focus:ring-1 focus:ring-amber-200 transition-colors',
].join(' ')


// ── Componente principal ───────────────────────────────────────────────────

export default function NotaFormulario() {
  // useParams lee el segmento :folio de la URL (undefined en /notas/nueva)
  const { folio } = useParams()
  const modoEdicion = Boolean(folio)

  const navigate = useNavigate()
  const { usuario, logout } = useAuth()

  // ── Estado del formulario ────────────────────────────────────────────────
  const [cabecera, setCabecera] = useState(CABECERA_INICIAL)
  const [partidas, setPartidas] = useState([])

  // Datos de referencia que se cargan una vez al montar
  const [vendedores, setVendedores]   = useState([])
  const [productos,  setProductos]    = useState([])

  // Control de la UI
  const [cargando,  setCargando]  = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error,     setError]     = useState(null)

  // Para la confirmación de "Entregado" (ver handleGuardar)
  const [confirmarEntrega, setConfirmarEntrega] = useState(false)
  const [estatusAnterior,  setEstatusAnterior]  = useState(null)

  // Foto de la nota de papel — se sube/borra inmediatamente (como GaleriaFotos),
  // no espera al guardado del formulario porque el endpoint es independiente.
  const [fotoNota, setFotoNota] = useState(null)

  // Nombre a mostrar cuando el vendedor de la nota ya no aparece en la lista
  // de vendedores activos (empleado desactivado o dato histórico). Viene del
  // campo `vendedor` (nombre resuelto en vivo o texto histórico) que ya
  // devuelve el backend junto con `vendedor_id`.
  const [vendedorHistorico, setVendedorHistorico] = useState('')

  // ── Valor derivado: resta se calcula en tiempo real ──────────────────────
  // No necesita un useState — es una función pura de cabecera.total y .anticipo.
  // Se recalcula en cada teclazo sin delay.
  const restaCalculada = (Number(cabecera.total) || 0) - (Number(cabecera.anticipo) || 0)

  // ── Carga inicial de datos ───────────────────────────────────────────────
  useEffect(() => {
    async function cargar() {
      setCargando(true)
      setError(null)
      try {
        // Cargar vendedores y productos en paralelo — son independientes entre sí
        const [resV, resP] = await Promise.all([
          apiFetch('/usuarios/vendedores'),
          apiFetch('/productos'),
        ])

        if (resV.status === 401 || resP.status === 401) {
          await logout(); navigate('/login'); return
        }
        if (!resV.ok) throw new Error('No se pudo cargar la lista de vendedores.')
        if (!resP.ok) throw new Error('No se pudo cargar los productos.')

        const [dataV, dataP] = await Promise.all([resV.json(), resP.json()])
        setVendedores(dataV)
        setProductos(dataP)

        // En modo edición, cargar la nota existente (secuencial: depende de los datos base)
        if (modoEdicion) {
          const resN = await apiFetch(`/notas/${folio}`)
          if (resN.status === 401) { await logout(); navigate('/login'); return }
          if (resN.status === 404) { setError('Esta nota no existe o no tienes acceso.'); return }
          if (!resN.ok) throw new Error('No se pudo cargar la nota.')

          const nota = await resN.json()

          // Guardar el nombre a mostrar por si vendedor_id no está en la lista
          // de vendedores activos (empleado desactivado, o nota vieja sin
          // cuenta de sistema asociada) — el select lo muestra como opción
          // extra de solo-lectura.
          setVendedorHistorico(nota.vendedor || '')

          // Normalizar foto_nota: descartar valores placeholder que no son rutas reales
          // (p.ej. el string literal "string" que Swagger usa como ejemplo).
          const fotoRaw = nota.foto_nota
          const fotoLimpia = fotoRaw && fotoRaw.includes('/') ? fotoRaw : null

          // Llenar el encabezado con los datos existentes.
          // Los números se guardan como cadena para que el input[type=number] funcione bien.
          setCabecera({
            nombre_cliente:  nota.nombre_cliente  || '',
            telefono:        nota.telefono        || '',
            fecha_pedido:    nota.fecha_pedido    || hoy(),
            fecha_entrega:   nota.fecha_entrega   || '',
            vendedor_id:     nota.vendedor_id != null ? String(nota.vendedor_id) : '',
            total:           nota.total    != null ? String(nota.total)    : '',
            anticipo:        nota.anticipo != null ? String(nota.anticipo) : '',
            estatus:         nota.estatus,
            consideraciones: nota.consideraciones || '',
          })
          setEstatusAnterior(nota.estatus)
          setFotoNota(fotoLimpia)

          // Convertir partidas del servidor al formato del estado local.
          // Se usa p.id como _key porque es estable (no cambiará entre rerenders).
          setPartidas(nota.partidas.map(p => ({
            _key:            p.id,
            producto_id:     p.producto_id,
            nombre_producto: p.nombre_producto || '',
            cantidad:        p.cantidad,
            modificaciones:  p.modificaciones  || '',
            precio_unitario: p.precio_unitario != null ? String(p.precio_unitario) : '',
          })))
        }
      } catch (err) {
        setError(err.message)
      } finally {
        setCargando(false)
      }
    }

    cargar()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folio])   // solo si cambia el folio en la URL (raro, pero correcto manejarlo)


  // ── Manejadores de estado ────────────────────────────────────────────────

  function handleCampo(campo, valor) {
    setCabecera(prev => ({ ...prev, [campo]: valor }))
    // Si el usuario cambia el estatus lejos de Entregado, ocultar la confirmación
    if (campo === 'estatus' && valor !== 'Entregado') {
      setConfirmarEntrega(false)
    }
  }

  // AGREGAR: añade un objeto nuevo al final del array
  function agregarPartida() {
    setPartidas(prev => [...prev, nuevaPartida()])
  }

  // QUITAR: filter descarta el elemento con ese _key — el resto no se toca
  function quitarPartida(key) {
    setPartidas(prev => prev.filter(p => p._key !== key))
  }

  // ACTUALIZAR UN CAMPO: map reemplaza solo el objeto con ese _key
  // [campo]: valor usa el nombre de la propiedad como variable (computed property)
  function actualizarPartida(key, campo, valor) {
    setPartidas(prev => prev.map(p =>
      p._key !== key ? p : { ...p, [campo]: valor }
    ))
  }

  // SELECCIONAR PRODUCTO: actualiza tres campos a la vez en un solo setPartidas
  // (evita dos rerenders separados y un estado intermedio inconsistente)
  function seleccionarProducto(key, productoId) {
    const prod = productos.find(p => p.id === Number(productoId))
    setPartidas(prev => prev.map(p => {
      if (p._key !== key) return p
      return {
        ...p,
        producto_id:     prod?.id   ?? null,
        nombre_producto: prod?.nombre ?? '',
        // Pre-llenar precio de catálogo, pero solo si aún no hay precio o el campo está vacío.
        // Así no pisa un precio personalizado que el usuario ya escribió.
        precio_unitario: prod ? String(prod.precio) : p.precio_unitario,
      }
    }))
  }

  // ── Envío del formulario ─────────────────────────────────────────────────

  function construirPayload() {
    return {
      nombre_cliente:  cabecera.nombre_cliente.trim() || null,
      telefono:        cabecera.telefono.trim()       || null,
      fecha_pedido:    cabecera.fecha_pedido          || hoy(),
      fecha_entrega:   cabecera.fecha_entrega         || null,
      vendedor_id:     cabecera.vendedor_id ? Number(cabecera.vendedor_id) : null,
      total:           Math.max(0, Number(cabecera.total)    || 0),
      anticipo:        Math.max(0, Number(cabecera.anticipo) || 0),
      estatus:         cabecera.estatus,
      consideraciones: cabecera.consideraciones.trim() || null,
      partidas: partidas.map(p => ({
        producto_id:     p.producto_id || null,
        cantidad:        Math.max(1, Number(p.cantidad) || 1),
        modificaciones:  p.modificaciones.trim() || null,
        precio_unitario: Math.max(0, Number(p.precio_unitario) || 0),
      })),
    }
  }

  async function handleGuardar() {
    // ── Confirmación de Entregado ──────────────────────────────────────────
    // Si el formulario está en Entregado y NO estaba antes, pedimos confirmación.
    // En crear, estatusAnterior es null, así que cualquier Entregado en crear pide confirmación.
    const esTransicionEntrega = cabecera.estatus === 'Entregado' &&
      estatusAnterior !== 'Entregado'

    if (esTransicionEntrega && !confirmarEntrega) {
      setConfirmarEntrega(true)
      setTimeout(() =>
        document.getElementById('confirm-entrega')?.scrollIntoView({ behavior: 'smooth' })
      , 50)
      return
    }

    setGuardando(true)
    setError(null)

    try {
      const payload = construirPayload()
      const res = modoEdicion
        ? await apiFetch(`/notas/${folio}`, { method: 'PUT',  body: JSON.stringify(payload) })
        : await apiFetch('/notas',           { method: 'POST', body: JSON.stringify(payload) })

      if (res.status === 401) { await logout(); navigate('/login'); return }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'No se pudo guardar la nota.')
      }

      const data = await res.json()
      // En crear, el backend devuelve { folio: "D-00001" }
      // En editar, devuelve la nota completa (con .folio)
      navigate(`/notas/${modoEdicion ? folio : data.folio}`)
    } catch (err) {
      setError(err.message)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setGuardando(false)
    }
  }


  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Layout>
      {/* ── Encabezado de página ── */}
      <div className="flex items-center gap-3 mb-5">
        <Link
          to={modoEdicion ? `/notas/${folio}` : '/notas'}
          className="text-sm font-medium text-gray-400 hover:text-amber-700 transition-colors"
        >
          ←
        </Link>
        <h1 className="text-xl font-bold text-gray-900">
          {modoEdicion ? `Editando ${folio}` : 'Nueva nota de venta'}
        </h1>
      </div>

      {/* ── Error global ── */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-2xl px-5 py-3
                        text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Spinner de carga ── */}
      {cargando && (
        <p className="text-center text-gray-400 py-20 text-sm">Cargando…</p>
      )}

      {/* ── Formulario ── */}
      {!cargando && (
        <form onSubmit={e => { e.preventDefault(); handleGuardar() }} className="space-y-4">

          {/* ── 1. Cliente ── */}
          <Seccion titulo="Cliente">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Campo label="Nombre del cliente">
                <input
                  type="text"
                  value={cabecera.nombre_cliente}
                  onChange={e => handleCampo('nombre_cliente', e.target.value)}
                  placeholder="Ej. María García"
                  className={estiloInput}
                />
              </Campo>
              <Campo label="Teléfono">
                <input
                  type="tel"
                  value={cabecera.telefono}
                  onChange={e => handleCampo('telefono', e.target.value)}
                  placeholder="Ej. 55 1234 5678"
                  className={estiloInput}
                />
              </Campo>
            </div>
          </Seccion>

          {/* ── 2. Detalles ── */}
          <Seccion titulo="Detalles del pedido">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Campo label="Fecha del pedido">
                <input
                  type="date"
                  value={cabecera.fecha_pedido}
                  onChange={e => handleCampo('fecha_pedido', e.target.value)}
                  className={estiloInput}
                />
              </Campo>
              <Campo label="Fecha de entrega">
                <input
                  type="date"
                  value={cabecera.fecha_entrega}
                  onChange={e => handleCampo('fecha_entrega', e.target.value)}
                  className={estiloInput}
                />
              </Campo>
              <Campo label="Vendedor">
                {/*
                  El select usa el ID del trabajador como value (vendedor_id,
                  un FK real a usuarios). Así, si el vendedor cambia su nombre
                  después en Usuarios, esta nota (y su PDF, lista, dashboards)
                  siempre muestran el nombre ACTUAL — no una copia congelada.
                  Si el vendedor_id ya no aparece en la lista de activos
                  (empleado desactivado, dato histórico), se agrega como
                  opción extra al final usando el nombre que ya resolvió el
                  backend (vendedorHistorico).
                */}
                <select
                  value={cabecera.vendedor_id}
                  onChange={e => handleCampo('vendedor_id', e.target.value)}
                  className={estiloInput}
                >
                  <option value="">— Sin vendedor —</option>
                  {vendedores.map(v => (
                    <option key={v.id} value={v.id}>{v.nombre}</option>
                  ))}
                  {cabecera.vendedor_id &&
                   !vendedores.some(v => String(v.id) === String(cabecera.vendedor_id)) && (
                    <option value={cabecera.vendedor_id}>
                      {vendedorHistorico} (ya no está en el sistema)
                    </option>
                  )}
                </select>
              </Campo>
              <Campo label="Estatus">
                <select
                  value={cabecera.estatus}
                  onChange={e => handleCampo('estatus', e.target.value)}
                  className={estiloInput}
                >
                  {ESTATUS_OPCIONES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Campo>
            </div>
          </Seccion>

          {/* ── 3. Montos ── */}
          <Seccion titulo="Montos">
            <p className="text-xs text-gray-400 mb-3 -mt-1">
              El total lo escribe el vendedor directamente — no se suma de los muebles.
              Los muebles son para el registro y el inventario.
            </p>
            <div className="grid grid-cols-3 gap-4">
              <Campo label="Total ($)" required>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={cabecera.total}
                  onChange={e => handleCampo('total', e.target.value)}
                  placeholder="0"
                  className={estiloInput}
                  required
                />
              </Campo>
              <Campo label="Cantidad Pagada ($)">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={cabecera.anticipo}
                  onChange={e => handleCampo('anticipo', e.target.value)}
                  placeholder="0"
                  className={estiloInput}
                />
              </Campo>
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1.5">Resta</p>
                <div className={`${estiloInput} font-bold ${
                  restaCalculada > 0 ? 'text-amber-700 bg-amber-50' : 'text-gray-400 bg-gray-50'
                }`}>
                  ${restaCalculada.toLocaleString('es-MX', { minimumFractionDigits: 0 })}
                </div>
              </div>
            </div>
          </Seccion>

          {/* ── 3b. Pagos — cómo se cobró (efectivo/tarjeta/transferencia) ──
              A diferencia de las partidas, los pagos son un sub-recurso propio
              en el backend (POST/GET/DELETE /notas/{folio}/pagos), no parte
              del payload de la nota — se guardan de inmediato, igual que la
              foto de la nota de papel. Por eso solo aparecen en modo edición:
              necesitan un folio ya existente. */}
          <Seccion titulo="Pagos">
            {modoEdicion ? (
              <PagosEditor folio={folio} />
            ) : (
              <p className="text-xs text-gray-400">
                Podrás registrar los pagos (efectivo, tarjeta, transferencia) después de crear el pedido.
              </p>
            )}
          </Seccion>

          {/* ── 4. Muebles (partidas) ── */}
          <Seccion titulo={`Muebles${partidas.length > 0 ? ` (${partidas.length})` : ''}`}>
            <p className="text-xs text-gray-400 mb-3 -mt-1">
              Agrega los muebles del pedido. El precio aquí es referencial,
              no afecta el total de arriba.
            </p>

            <div className="space-y-3">
              {partidas.map((partida, idx) => (
                <FilaPartida
                  key={partida._key}
                  partida={partida}
                  numero={idx + 1}
                  productos={productos}
                  onSeleccionarProducto={pid => seleccionarProducto(partida._key, pid)}
                  onChange={(campo, valor) => actualizarPartida(partida._key, campo, valor)}
                  onQuitar={() => quitarPartida(partida._key)}
                />
              ))}

              <button
                type="button"
                onClick={agregarPartida}
                className="w-full py-3 border-2 border-dashed border-amber-300 rounded-xl
                           text-sm font-medium text-amber-700 hover:bg-amber-50
                           active:bg-amber-100 transition-colors"
              >
                + Agregar mueble
              </button>
            </div>
          </Seccion>

          {/* ── 5. Consideraciones ── */}
          <Seccion titulo="Consideraciones">
            <textarea
              value={cabecera.consideraciones}
              onChange={e => handleCampo('consideraciones', e.target.value)}
              placeholder="Notas generales: entrega a domicilio, color especial, detalles de pago, etc."
              rows={3}
              className={`${estiloInput} resize-y`}
            />
          </Seccion>

          {/* ── 6. Foto de la nota de papel (opcional) ── */}
          <Seccion titulo="Foto de la nota de papel (opcional)">
            {modoEdicion ? (
              <FotoNotaEditor
                folio={folio}
                fotoNota={fotoNota}
                onCambio={setFotoNota}
              />
            ) : (
              <p className="text-xs text-gray-400">
                Podrás agregar la foto de la nota física después de crear el pedido.
              </p>
            )}
          </Seccion>

          {/* ── Confirmación de Entregado ── */}
          {confirmarEntrega && (
            <div
              id="confirm-entrega"
              className="bg-amber-50 border border-amber-300 rounded-2xl p-5"
            >
              <p className="font-semibold text-amber-900 mb-1">
                ¿Marcar como Entregado?
              </p>
              <p className="text-sm text-amber-700 mb-4">
                Esto descontará las existencias de los muebles de esta nota.
                Solo hazlo cuando el cliente ya recibió su pedido.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={guardando}
                  className="bg-amber-600 text-white text-sm font-semibold px-5 py-2.5
                             rounded-xl hover:bg-amber-700 disabled:opacity-50
                             disabled:cursor-not-allowed transition-colors"
                >
                  {guardando ? 'Guardando…' : 'Sí, confirmar entrega'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmarEntrega(false)
                    // Volver al estatus anterior (o 'En proceso' si no había)
                    handleCampo('estatus', estatusAnterior || 'En proceso')
                  }}
                  className="text-sm font-medium text-gray-600 px-5 py-2.5 rounded-xl
                             hover:bg-gray-100 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* ── Botones de acción ── */}
          {!confirmarEntrega && (
            <div className="flex gap-3 pt-1 pb-8">
              <button
                type="submit"
                disabled={guardando}
                className="flex-1 bg-amber-600 text-white font-semibold py-3 rounded-xl
                           hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed
                           transition-colors text-sm"
              >
                {guardando ? 'Guardando…' : modoEdicion ? 'Guardar cambios' : 'Crear nota'}
              </button>
              <Link
                to={modoEdicion ? `/notas/${folio}` : '/notas'}
                className="px-5 py-3 rounded-xl border border-gray-200 text-gray-600
                           text-sm font-medium hover:bg-gray-50 transition-colors text-center"
              >
                Cancelar
              </Link>
            </div>
          )}

        </form>
      )}
    </Layout>
  )
}


// ── Subcomponentes ─────────────────────────────────────────────────────────

function Seccion({ titulo, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
        {titulo}
      </p>
      {children}
    </div>
  )
}

function Campo({ label, children, required = false }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 font-medium mb-1.5">
        {label}
        {required && <span className="text-amber-600 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

function FilaPartida({ partida, numero, productos, onSeleccionarProducto, onChange, onQuitar }) {
  return (
    <div className="border border-gray-200 rounded-xl p-3.5 bg-gray-50 space-y-2.5">

      {/* Cabecera de la fila: número + botón quitar */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-gray-400">Mueble #{numero}</span>
        <button
          type="button"
          onClick={onQuitar}
          className="text-gray-300 hover:text-red-500 transition-colors text-base
                     font-bold leading-none px-1"
          title="Quitar este mueble"
        >
          ✕
        </button>
      </div>

      {/* Selector de producto del catálogo */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Del catálogo (opcional)</label>
        <select
          value={partida.producto_id ?? ''}
          onChange={e => onSeleccionarProducto(e.target.value || null)}
          className={estiloInput}
        >
          <option value="">— Artículo libre (no está en el catálogo) —</option>
          {productos.map(p => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
      </div>

      {/* Modificaciones / descripción libre */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">
          Descripción o modificaciones
        </label>
        <input
          type="text"
          value={partida.modificaciones}
          onChange={e => onChange('modificaciones', e.target.value)}
          placeholder="Ej. 180 cm en lugar de 150 cm, madera de pino oscuro"
          className={estiloInput}
        />
      </div>

      {/* Cantidad y precio en dos columnas */}
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Cantidad</label>
          <input
            type="number"
            min="1"
            value={partida.cantidad}
            onChange={e => onChange('cantidad', e.target.value)}
            className={estiloInput}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Precio referencial ($)
          </label>
          <input
            type="number"
            min="0"
            step="any"
            value={partida.precio_unitario}
            onChange={e => onChange('precio_unitario', e.target.value)}
            placeholder="0"
            className={estiloInput}
          />
        </div>
      </div>

    </div>
  )
}


// ── PagosEditor ───────────────────────────────────────────────────────────────
// Registro de pagos (efectivo/tarjeta/transferencia) de una nota ya existente.
// Igual que FotoNotaEditor: cada acción (agregar, eliminar) se guarda de
// inmediato contra el backend, no espera al botón "Guardar cambios" del
// formulario principal — porque pagos es un sub-recurso independiente, no
// parte del payload de la nota.
// Un pago DIVIDIDO (parte efectivo, parte tarjeta) es simplemente agregar
// dos filas seguidas con el mismo folio.

const METODOS_PAGO = ['efectivo', 'tarjeta', 'transferencia']
const TIPOS_PAGO   = ['anticipo', 'liquidacion', 'abono']

function PagosEditor({ folio }) {
  const [pagos,     setPagos]     = useState([])
  const [cargando,  setCargando]  = useState(true)
  const [error,     setError]     = useState(null)
  const [guardando, setGuardando] = useState(false)

  // Formulario de "agregar pago" — se reinicia después de cada guardado exitoso
  const [metodo, setMetodo] = useState('efectivo')
  const [tipo,   setTipo]   = useState('')
  const [monto,  setMonto]  = useState('')

  // Gate de confirmación: "+ Agregar pago" NO postea de inmediato — solo
  // muestra un resumen con un botón "Confirmar" explícito. Evita que un
  // clic accidental (o presionar Enter en el input de monto) registre un
  // pago sin que quien lo captura lo haya confirmado a propósito.
  const [confirmando, setConfirmando] = useState(false)

  async function cargarPagos() {
    setCargando(true)
    setError(null)
    try {
      const res = await apiFetch(`/notas/${folio}/pagos`)
      if (!res.ok) throw new Error('No se pudieron cargar los pagos.')
      setPagos(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargarPagos() }, [folio])

  // Paso 1: pedir confirmación — no llama al backend todavía.
  function handlePedirConfirmacion() {
    const montoNum = Number(monto)
    if (!montoNum || montoNum <= 0) return
    setConfirmando(true)
  }

  // Paso 2: solo aquí se registra el pago de verdad.
  async function handleConfirmar() {
    setGuardando(true)
    setError(null)
    try {
      const res = await apiFetch(`/notas/${folio}/pagos`, {
        method: 'POST',
        body: JSON.stringify({ metodo, tipo: tipo || null, monto: Number(monto) }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'No se pudo registrar el pago.')
      }
      setMonto('')
      setTipo('')
      setConfirmando(false)
      await cargarPagos()
    } catch (err) {
      setError(err.message)
    } finally {
      setGuardando(false)
    }
  }

  function handleCancelarConfirmacion() {
    setConfirmando(false)
  }

  async function handleEliminar(id) {
    setError(null)
    try {
      const res = await apiFetch(`/notas/${folio}/pagos/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('No se pudo eliminar el pago.')
      setPagos(prev => prev.filter(p => p.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  const totalRegistrado = pagos.reduce((acc, p) => acc + Number(p.monto), 0)

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-600">{error}</p>}

      {cargando ? (
        <p className="text-xs text-gray-400">Cargando pagos…</p>
      ) : pagos.length === 0 ? (
        <p className="text-xs text-gray-400">Todavía no hay pagos registrados.</p>
      ) : (
        <div className="space-y-1.5">
          {pagos.map(p => (
            <div
              key={p.id}
              className="flex items-center justify-between text-sm bg-gray-50
                         rounded-lg px-3 py-2"
            >
              <div className="min-w-0">
                <span className="font-medium text-gray-800 capitalize">{p.metodo}</span>
                {p.tipo && <span className="text-gray-400"> · {p.tipo}</span>}
                <span className="text-gray-400"> · {p.fecha}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-semibold text-gray-900">
                  ${Number(p.monto).toLocaleString('es-MX', { minimumFractionDigits: 0 })}
                </span>
                <button
                  type="button"
                  onClick={() => handleEliminar(p.id)}
                  className="text-gray-300 hover:text-red-500 text-base font-bold
                             leading-none px-1"
                  title="Eliminar pago"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          <div className="flex justify-between text-xs text-gray-500 pt-1">
            <span>Total registrado</span>
            <span className="font-semibold">
              ${totalRegistrado.toLocaleString('es-MX', { minimumFractionDigits: 0 })}
            </span>
          </div>
        </div>
      )}

      {/* Fila para agregar un pago nuevo — deshabilitada mientras se confirma,
          para que el resumen de abajo no quede desincronizado de los campos. */}
      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-100">
        <select
          value={metodo}
          onChange={e => setMetodo(e.target.value)}
          disabled={confirmando}
          className={estiloInput}
        >
          {METODOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select
          value={tipo}
          onChange={e => setTipo(e.target.value)}
          disabled={confirmando}
          className={estiloInput}
        >
          <option value="">— Tipo (opcional) —</option>
          {TIPOS_PAGO.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          type="number"
          min="0"
          step="any"
          value={monto}
          onChange={e => setMonto(e.target.value)}
          disabled={confirmando}
          placeholder="Monto"
          className={estiloInput}
        />
      </div>

      {!confirmando ? (
        <button
          type="button"
          onClick={handlePedirConfirmacion}
          disabled={!monto}
          className="w-full py-2.5 border-2 border-dashed border-amber-300 rounded-xl
                     text-sm font-medium text-amber-700 hover:bg-amber-50
                     active:bg-amber-100 disabled:opacity-50 transition-colors"
        >
          + Agregar pago
        </button>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2.5">
          <p className="text-xs text-amber-900">
            ¿Registrar <span className="font-semibold capitalize">{metodo}</span>
            {tipo && <> · {tipo}</>} por{' '}
            <span className="font-semibold">
              ${Number(monto).toLocaleString('es-MX', { minimumFractionDigits: 0 })}
            </span>?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleConfirmar}
              disabled={guardando}
              className="flex-1 py-2 bg-amber-600 text-white text-sm font-semibold
                         rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              {guardando ? 'Guardando…' : 'Confirmar'}
            </button>
            <button
              type="button"
              onClick={handleCancelarConfirmacion}
              disabled={guardando}
              className="flex-1 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100
                         rounded-lg disabled:opacity-50 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


// ── FotoNotaEditor ────────────────────────────────────────────────────────────
// Componente de subida de la foto de la nota de papel.
// La subida es INMEDIATA al seleccionar el archivo — no espera al botón guardar.
// Si ya hay foto la muestra con botones de reemplazar y quitar.

function FotoNotaEditor({ folio, fotoNota, onCambio }) {
  const inputRef = useRef(null)
  const [subiendo, setSubiendo] = useState(false)
  const [error,    setError]    = useState(null)

  async function handleArchivo(e) {
    const archivo = e.target.files?.[0]
    if (!archivo) return
    e.target.value = ''   // resetear para que el mismo archivo pueda seleccionarse de nuevo

    setSubiendo(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('archivo', archivo)
      const res = await apiFetch(`/notas/${folio}/foto`, { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'No se pudo subir la foto.')
      }
      const data = await res.json()
      onCambio(data.foto_nota)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubiendo(false)
    }
  }

  async function handleQuitar() {
    setSubiendo(true)
    setError(null)
    try {
      const res = await apiFetch(`/notas/${folio}/foto`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'No se pudo quitar la foto.')
      }
      onCambio(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubiendo(false)
    }
  }

  return (
    <div>
      {/* Input oculto — se activa con el botón visible */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleArchivo}
        className="hidden"
      />

      {error && (
        <p className="text-xs text-red-600 mb-2">{error}</p>
      )}

      {urlFoto(fotoNota) ? (
        /* Previsualización de la foto existente */
        <div className="space-y-3">
          <img
            src={urlFoto(fotoNota)}
            alt="Foto de la nota de papel"
            className="w-full max-w-xs rounded-xl border border-gray-200 block"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={subiendo}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200
                         text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {subiendo ? 'Subiendo…' : 'Reemplazar'}
            </button>
            <button
              type="button"
              onClick={handleQuitar}
              disabled={subiendo}
              className="text-xs px-3 py-1.5 rounded-lg border border-red-200
                         text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              Quitar foto
            </button>
          </div>
        </div>
      ) : (
        /* Sin foto — mostrar botón de subida */
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={subiendo}
          className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl
                     border-2 border-dashed border-gray-300 text-gray-500
                     hover:border-amber-300 hover:text-amber-700 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {subiendo ? 'Subiendo…' : 'Agregar foto de la nota de papel'}
        </button>
      )}
    </div>
  )
}
