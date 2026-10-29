-- ============================================================
--  Migración 018 — local de venta en notas
--
--  Cada nota guarda en qué LOCAL se vendió (una de las bodegas:
--  Local Jose, Local Amarillo, Almacen, Local 17). La sucursal sigue
--  existiendo y se deriva del local (bodegas.sucursal_id), así que el
--  sitio público, la regla de precios CDMX y es_principal no cambian.
--  Reemplaza la propuesta 017 (que rehacía la tabla sucursales).
--
--  1. Renombra la bodega "Local Mexico" → "Local 17", incluido el texto
--     libre movimientos_inventario.ubicacion (el trigger
--     trg_recalcular_existencias recalcula productos.ubicaciones solo).
--  2. notas.bodega_id (FK nullable — obligatoria solo desde el panel
--     para notas nuevas; la base no la exige).
--  3. Backfill de notas viejas por VENDEDOR (notas.vendedor_id), decisión
--     del 2026-10-29 solo para el histórico:
--       Irma12, Michelle03 → Local Jose
--       Mary11             → Local Amarillo
--       Faust01            → Local 17
--  4. notas.sucursal_id = sucursal del local asignado, para que ambas
--     columnas no se contradigan.
--
--  Verificación previa (debe dar 4 filas con esos nombres):
--    SELECT id, nombre, sucursal_id FROM bodegas ORDER BY id;
-- ============================================================

BEGIN;

UPDATE bodegas SET nombre = 'Local 17' WHERE nombre = 'Local Mexico';
UPDATE movimientos_inventario SET ubicacion = 'Local 17' WHERE ubicacion = 'Local Mexico';

ALTER TABLE notas
    ADD COLUMN bodega_id INTEGER REFERENCES bodegas(id) ON DELETE SET NULL;

UPDATE notas n
SET bodega_id = b.id
FROM usuarios u, bodegas b
WHERE u.id = n.vendedor_id
  AND n.bodega_id IS NULL
  AND b.nombre = CASE u.username
                   WHEN 'Irma12'     THEN 'Local Jose'
                   WHEN 'Michelle03' THEN 'Local Jose'
                   WHEN 'Mary11'     THEN 'Local Amarillo'
                   WHEN 'Faust01'    THEN 'Local 17'
                 END;

UPDATE notas n
SET sucursal_id = b.sucursal_id
FROM bodegas b
WHERE b.id = n.bodega_id
  AND n.sucursal_id IS DISTINCT FROM b.sucursal_id;

CREATE INDEX IF NOT EXISTS idx_notas_bodega ON notas(bodega_id);

COMMIT;

-- Verificación posterior (ninguna nota debe quedar sin local):
--   SELECT b.nombre, s.nombre, count(*)
--   FROM notas n LEFT JOIN bodegas b ON b.id = n.bodega_id
--   LEFT JOIN sucursales s ON s.id = n.sucursal_id
--   GROUP BY 1, 2 ORDER BY 3 DESC;
