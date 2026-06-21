-- ============================================================
--  Migración 003 — ubicaciones
--  Agrega una columna a PRODUCTOS para etiquetar en qué
--  ubicación(es) físicas está cada producto.
--
--  ubicaciones: ARRAY de etiquetas de ubicación (un producto puede
--  estar en una o varias). Ej: {'Local Mexico', 'Local Jose'}.
--  Mismo patrón que 'fotos' (TEXT[]).
--
--  NOTA: es solo una etiqueta informativa, NO un conteo por
--  ubicación. 'existencias' sigue siendo un total único. Si se
--  necesita saber cuántas hay en cada lugar, se maneja informalmente.
--
--  Ubicaciones válidas (se validan en el frontend con checkboxes,
--  no con un CHECK de DB, porque las restricciones sobre el
--  contenido de un array son incómodas en Postgres):
--    'Local Mexico', 'Local Jose', 'Local Amarillo', 'Almacen'
-- ============================================================

ALTER TABLE productos
    ADD COLUMN ubicaciones TEXT[] DEFAULT '{}';