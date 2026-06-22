/**
 * ConfirmDialog.jsx — Diálogo de confirmación reutilizable.
 *
 * Se usa para acciones destructivas (descontinuar un producto) antes
 * de ejecutarlas. Muestra un overlay oscuro y una tarjeta con mensaje.
 *
 * Props:
 *   titulo        — Encabezado del diálogo
 *   mensaje       — Explicación más detallada
 *   textoConfirmar — Texto del botón de acción (por defecto "Confirmar")
 *   onConfirmar   — Función a ejecutar si el usuario acepta
 *   onCancelar    — Función a ejecutar si el usuario cancela
 *
 * En móvil sube desde abajo (patrón "bottom sheet").
 * En escritorio aparece centrado.
 */

export default function ConfirmDialog({
  titulo,
  mensaje,
  textoConfirmar = 'Confirmar',
  onConfirmar,
  onCancelar,
}) {
  return (
    // El overlay oscuro cubre toda la pantalla.
    // onClick en el overlay = cancelar (clic fuera del cuadro).
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4"
      onClick={onCancelar}
    >
      {/* stopPropagation evita que el clic dentro del cuadro dispare onCancelar */}
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold text-gray-900 text-base mb-2">{titulo}</h2>
        <p className="text-sm text-gray-600 leading-relaxed mb-5">{mensaje}</p>

        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button
            onClick={onCancelar}
            className="flex-1 py-2.5 border border-gray-300 rounded-xl text-sm
                       font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white
                       rounded-xl text-sm font-medium transition-colors"
          >
            {textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  )
}
