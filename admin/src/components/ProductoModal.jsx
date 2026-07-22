/**
 * ProductoModal.jsx — Modal de crear / editar producto.
 *
 * CONCEPTOS NUEVOS QUE USAMOS AQUÍ:
 *
 * Un solo estado para todo el formulario
 *   En lugar de un useState por campo, guardamos todos los campos en un
 *   objeto: const [form, setForm] = useState({ nombre: '', precio: 0, … })
 *   Para actualizar UN campo sin perder los demás usamos el spread:
 *     setForm(prev => ({ ...prev, nombre: 'Silla' }))
 *
 * Factory de handlers: cambiar(campo)
 *   Devuelve una función onChange lista para usar en cualquier input.
 *   Así no repetimos setForm 10 veces:
 *     onChange={cambiar('nombre')}  ← genera (e) => setForm(prev => ({ ...prev, nombre: e.target.value }))
 *
 * Dos useEffect con propósitos distintos
 *   1. Al montar: cargar categorías y proveedores (se cargan una sola vez).
 *   2. Cuando cambia `producto`: pre-poblar el formulario si estamos editando.
 *
 * form="form-producto" en el botón de submit
 *   El botón "Guardar" está fuera del <form> (en el footer fijo del modal).
 *   El atributo HTML `form="id-del-form"` vincula el botón a ese formulario
 *   para que type="submit" lo dispare aunque esté fuera del DOM del form.
 *
 * Props:
 *   producto    — null = crear nuevo | objeto = editar existente
 *   onGuardado  — se llama cuando el servidor confirmó el guardado
 *   onCerrar    — se llama para cerrar el modal (cancelar o X)
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../api'
import GaleriaFotos from './GaleriaFotos'
import HistorialStock from './HistorialStock'

const formatFechaCorta = (fecha) =>
  fecha
    ? new Date(fecha + 'T00:00:00').toLocaleDateString('es-MX', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : '—'

const FORM_VACÍO = {
  nombre:          '',
  categoria_id:    '',   // '' = "sin categoría" en el select
  proveedor_id:    '',   // proveedor por defecto del catálogo — solo se fija al crear
  color:           '',
  material:        '',
  descripcion:     '',
  precio_base:     '',
  costo:           '0',
  descuento_pct:   '',
  visible_en_sitio: true,
  destacados:      false,
  // existencias, fecha_ingreso y ubicaciones NO viven aquí: son derivados
  // de movimientos_inventario (migración 010) y ya no se capturan al
  // crear — un producto nuevo arranca en existencias=0 / sin ubicaciones,
  // y su primera entrada se agrega desde "Editar stock" una vez creado.
}

export default function ProductoModal({ producto, onGuardado, onCerrar }) {
  const [form, setForm]           = useState(FORM_VACÍO)
  const [categorias, setCategorias] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError]         = useState(null)

  const { logout } = useAuth()
  const navigate   = useNavigate()

  // --- Efecto 1: cargar opciones de los selects al montar el modal ---
  // Promise.all ejecuta las dos peticiones en paralelo y espera a que
  // AMBAS terminen. Es más rápido que esperar una y luego la otra.
  useEffect(() => {
    Promise.all([
      apiFetch('/categorias').then((r) => r.json()),
      apiFetch('/proveedores').then((r) => r.json()),
    ]).then(([cats, provs]) => {
      setCategorias(cats)
      setProveedores(provs)
    })
  }, []) // [] = solo al montar

  // --- Efecto 2: pre-poblar el formulario cuando cambia `producto` ---
  // Si `producto` es null (crear), resetear a vacío.
  // Si `producto` tiene datos (editar), copiarlos al formulario.
  // El ?. (optional chaining) evita errores si producto es null.
  useEffect(() => {
    if (producto) {
      setForm({
        nombre:           producto.nombre          ?? '',
        categoria_id:     producto.categoria_id?.toString() ?? '',
        proveedor_id:     producto.proveedor_id?.toString() ?? '',
        color:            producto.color            ?? '',
        material:         producto.material         ?? '',
        descripcion:      producto.descripcion      ?? '',
        precio_base:      producto.precio_base?.toString() ?? '',
        costo:            producto.costo?.toString() ?? '0',
        descuento_pct:    producto.descuento_pct?.toString() ?? '',
        visible_en_sitio: producto.visible_en_sitio ?? true,
        destacados:       producto.destacados ?? false,
        // existencias, fecha_ingreso y ubicaciones: SOLO lectura aquí
        // (derivados vía trigger, migración 010). Se muestran para
        // contexto y se mantienen frescos por el callback de "Editar
        // stock" — nunca se mandan de vuelta al servidor desde este
        // formulario.
        existencias:      producto.existencias ?? 0,
        fecha_ingreso:    producto.fecha_ingreso ?? null,
        ubicaciones:      producto.ubicaciones ?? [],
      })
    } else {
      setForm(FORM_VACÍO)
    }
  }, [producto])

  // --- Factory de handlers ---
  // cambiar('nombre') devuelve (e) => setForm(prev => ({ ...prev, nombre: e.target.value }))
  // cambiar('visible_en_sitio') detecta checkbox y usa e.target.checked en vez de e.target.value
  function cambiar(campo) {
    return (e) => {
      const valor = e.target.type === 'checkbox' ? e.target.checked : e.target.value
      setForm((prev) => ({ ...prev, [campo]: valor }))
    }
  }

  // --- Editar stock: agregar/editar/borrar entradas de inventario vive en
  // su propio panel (HistorialStock), no como bloque permanente aquí. Al
  // cerrar cualquier cambio ahí, sincronizamos form.existencias/
  // fecha_ingreso con lo que devuelve el servidor — si no lo hiciéramos,
  // un "Guardar cambios" posterior mostraría (aunque no reenviaría, ya
  // que este formulario ya no manda esos campos) el valor VIEJO que cargó
  // el modal al abrirse.
  const [historialAbierto, setHistorialAbierto] = useState(false)

  // --- Validación y envío ---
  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    // Validación en el cliente (el servidor también valida, pero así
    // damos feedback inmediato sin esperar la petición)
    if (!form.nombre.trim()) {
      setError('El nombre del producto es obligatorio.')
      return
    }
    const precio = parseFloat(form.precio_base)
    if (isNaN(precio) || precio < 0) {
      setError('El precio debe ser un número mayor o igual a 0.')
      return
    }
    const costo = parseFloat(form.costo)
    if (isNaN(costo) || costo < 0) {
      setError('El costo debe ser un número mayor o igual a 0.')
      return
    }

    // Construir el payload que irá al API.
    // Los campos vacíos opcionales se mandan como null (no como '').
    // existencias, fecha_ingreso y ubicaciones NO van aquí — son derivados
    // de movimientos_inventario (migración 010); el backend ya ni siquiera
    // acepta esos campos en este endpoint.
    const payload = {
      nombre:           form.nombre.trim(),
      categoria_id:     form.categoria_id  ? parseInt(form.categoria_id)    : null,
      proveedor_id:     form.proveedor_id  ? parseInt(form.proveedor_id)    : null,
      color:            form.color.trim()  || null,
      material:         form.material.trim() || null,
      descripcion:      form.descripcion.trim() || null,
      precio_base:      precio,
      costo:            costo,
      descuento_pct:    form.descuento_pct !== '' ? parseFloat(form.descuento_pct) : null,
      visible_en_sitio: form.visible_en_sitio,
      destacados:       form.destacados,
    }

    setGuardando(true)
    try {
      const url    = producto ? `/productos/${producto.id}` : '/productos'
      const method = producto ? 'PUT' : 'POST'

      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(payload),
      })

      if (res.status === 401) {
        await logout()
        navigate('/login')
        return
      }
      if (res.status === 403) {
        setError('No tienes permiso para esta acción.')
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail ?? 'Error al guardar. Intenta de nuevo.')
        return
      }

      onGuardado() // avisar al padre que recargue la lista
    } finally {
      setGuardando(false)
    }
  }

  // Nombre del proveedor por defecto, para el resumen de solo lectura
  // del bloque "Stock" — form.proveedor_id es el id como string.
  const nombreProveedor = proveedores.find(
    (p) => p.id === Number(form.proveedor_id)
  )?.proveedor

  return (
    <>
    {/* Overlay oscuro — clic fuera cierra el modal */}
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50"
      onClick={onCerrar}
    >
      {/* Contenedor del modal — stopPropagation evita cerrar al hacer clic adentro */}
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg
                   max-h-[92dvh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >

        {/* ── Encabezado fijo ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-semibold text-gray-900">
            {producto ? 'Editar producto' : 'Nuevo producto'}
          </h2>
          <button
            onClick={onCerrar}
            aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* ── Formulario scrollable ── */}
        {/* id="form-producto" permite que el botón de submit del footer lo envíe */}
        <form
          id="form-producto"
          onSubmit={handleSubmit}
          className="overflow-y-auto flex-1 px-5 py-4 space-y-4"
        >

          {/* Nombre */}
          <Campo label="Nombre *">
            <input
              type="text"
              value={form.nombre}
              onChange={cambiar('nombre')}
              required
              placeholder="Ej. Silla comedor roble"
              className={inputCls}
            />
          </Campo>

          {/* Precio, Costo y Existencias */}
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Precio base *">
              <input
                type="number"
                value={form.precio_base}
                onChange={cambiar('precio_base')}
                min="0"
                step="0.01"
                placeholder="0.00"
                className={inputCls}
              />
            </Campo>
            <Campo label="Costo interno">
              <input
                type="number"
                value={form.costo}
                onChange={cambiar('costo')}
                min="0"
                step="0.01"
                placeholder="0.00"
                className={inputCls}
              />
            </Campo>
          </div>

          {/* Margen calculado — solo informativo */}
          {(() => {
            const p = parseFloat(form.precio_base)
            const c = parseFloat(form.costo)
            if (!isNaN(p) && !isNaN(c) && (p > 0 || c > 0)) {
              const margen = p - c
              const pct    = p > 0 ? ((margen / p) * 100).toFixed(1) : '—'
              return (
                <p className={`text-xs px-3 py-1.5 rounded-lg -mt-1 ${
                  margen >= 0
                    ? 'bg-green-50 text-green-700'
                    : 'bg-red-50 text-red-700'
                }`}>
                  Margen: ${margen.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({pct}%)
                </p>
              )
            }
            return null
          })()}

          {/* ── Stock ─────────────────────────────────────────────────────────
              Existencias, fecha de ingreso, ubicaciones y proveedor por
              defecto YA NO se editan aquí (migración 010: existencias/
              fecha_ingreso/ubicaciones quedan derivados de
              movimientos_inventario vía trigger, y proveedor se fija una
              sola vez al crear, no en cada edición). Al editar, se
              muestran de solo lectura y la edición real vive en el panel
              "Editar stock" — la ubicación se elige ahí, una vez por
              movimiento, no como una lista aparte aquí. Al crear, todavía
              no hay historial de stock — solo se elige el proveedor por
              defecto del catálogo. */}
          {producto ? (
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 space-y-1.5">
              <p className="text-xs font-medium text-gray-500 mb-1">Stock</p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Existencias</span>
                <span className="font-semibold text-gray-900">{form.existencias}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Fecha de ingreso</span>
                <span className="font-medium text-gray-700">{formatFechaCorta(form.fecha_ingreso)}</span>
              </div>
              <div className="flex items-center justify-between text-sm gap-3">
                <span className="text-gray-500 shrink-0">Ubicaciones</span>
                <span className="font-medium text-gray-700 text-right">
                  {form.ubicaciones?.length > 0 ? form.ubicaciones.join(', ') : '—'}
                </span>
              </div>
              {nombreProveedor && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Proveedor</span>
                  <span className="font-medium text-gray-700">{nombreProveedor}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setHistorialAbierto(true)}
                className="w-full mt-1.5 flex items-center justify-between px-3 py-2
                           bg-white border border-gray-200 rounded-lg text-sm
                           font-medium text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <span>Editar stock</span>
                <span className="text-gray-400">→</span>
              </button>
            </div>
          ) : (
            <Campo label="Proveedor">
              <select
                value={form.proveedor_id}
                onChange={cambiar('proveedor_id')}
                className={inputCls}
              >
                <option value="">— Sin proveedor —</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>{p.proveedor}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1.5">
                Podrás agregar existencias después de crear el producto.
              </p>
            </Campo>
          )}

          {/* Categoría */}
          <Campo label="Categoría">
            <select
              value={form.categoria_id}
              onChange={cambiar('categoria_id')}
              className={inputCls}
            >
              <option value="">— Sin categoría —</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </Campo>

          {/* Descuento */}
          <Campo label="Descuento (%) — deja vacío para heredar el de la categoría">
            <input
              type="number"
              value={form.descuento_pct}
              onChange={cambiar('descuento_pct')}
              min="0"
              max="100"
              step="0.01"
              placeholder="Sin descuento especial"
              className={inputCls}
            />
          </Campo>

          {/* Color y Material en fila */}
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Color">
              <input
                type="text"
                value={form.color}
                onChange={cambiar('color')}
                placeholder="Ej. Nogal"
                className={inputCls}
              />
            </Campo>
            <Campo label="Material">
              <input
                type="text"
                value={form.material}
                onChange={cambiar('material')}
                placeholder="Ej. Madera maciza"
                className={inputCls}
              />
            </Campo>
          </div>

          {/* Descripción */}
          <Campo label="Descripción">
            <textarea
              value={form.descripcion}
              onChange={cambiar('descripcion')}
              rows={3}
              placeholder="Descripción del producto para el catálogo público…"
              className={`${inputCls} resize-none`}
            />
          </Campo>

          {/* Visible en catálogo */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.visible_en_sitio}
              onChange={cambiar('visible_en_sitio')}
              className="w-4 h-4 rounded accent-amber-600 shrink-0"
            />
            <div>
              <span className="text-sm font-medium text-gray-700">
                Visible en el catálogo público
              </span>
              <p className="text-xs text-gray-400">
                Si lo desactivas, el producto no aparece en el sitio web.
              </p>
            </div>
          </label>

          {/* Destacado — marca manual de qué sale en "Lo más buscado" del
              inicio del sitio. No es automático: si no se marca nada, la
              sección simplemente no muestra nada ahí. */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.destacados}
              onChange={cambiar('destacados')}
              className="w-4 h-4 rounded accent-amber-600 shrink-0"
            />
            <div>
              <span className="text-sm font-medium text-gray-700">
                Destacado en "Lo más buscado"
              </span>
              <p className="text-xs text-gray-400">
                Aparece en la sección destacada del inicio del sitio público.
              </p>
            </div>
          </label>

          {/* ── Fotos ── */}
          <hr className="border-gray-100" />

          {producto ? (
            /*
             * La galería solo aparece al EDITAR porque necesita el ID del producto
             * para hacer POST /productos/{id}/fotos. Al crear, el producto
             * todavía no tiene ID — guarda primero y después edita para agregar fotos.
             *
             * Las fotos se guardan en la DB con cada upload/borrado (no al
             * hacer clic en "Guardar cambios"). GaleriaFotos gestiona su propio
             * estado local inicializado desde producto.fotos.
             */
            <GaleriaFotos
              productoId={producto.id}
              fotosIniciales={producto.fotos ?? []}
            />
          ) : (
            <p className="text-xs text-gray-400 bg-gray-50 border border-gray-100
                          rounded-xl px-3 py-2.5">
              Podrás agregar fotos después de crear el producto.
            </p>
          )}

          {/* Error del servidor */}
          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200
                          rounded-xl px-3 py-2.5">
              {error}
            </p>
          )}

        </form>

        {/* ── Footer fijo con botones ── */}
        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 shrink-0">
          <button
            type="button"
            onClick={onCerrar}
            className="flex-1 py-2.5 border border-gray-300 rounded-xl text-sm
                       font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          {/* type="submit" + form="form-producto" dispara el submit del form de arriba */}
          <button
            type="submit"
            form="form-producto"
            disabled={guardando}
            className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700
                       disabled:bg-amber-300 text-white rounded-xl text-sm
                       font-medium transition-colors"
          >
            {guardando ? 'Guardando…' : producto ? 'Guardar cambios' : 'Crear producto'}
          </button>
        </div>

      </div>
    </div>

    {/* Editar stock — panel aparte, por encima del modal de producto */}
    {historialAbierto && (
      <HistorialStock
        productoId={producto.id}
        proveedores={proveedores}
        onProductoActualizado={({ existencias, fecha_ingreso, ubicaciones }) =>
          setForm((prev) => ({ ...prev, existencias, fecha_ingreso, ubicaciones }))
        }
        onCerrar={() => setHistorialAbierto(false)}
      />
    )}
    </>
  )
}

// Clase compartida de inputs para consistencia visual
const inputCls =
  'w-full border border-gray-300 rounded-xl px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent ' +
  'bg-white'

// Componente local pequeño: etiqueta + slot para el input
// Solo vive en este archivo porque solo lo usa este modal.
function Campo({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  )
}
