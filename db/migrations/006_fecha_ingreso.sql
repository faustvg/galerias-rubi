-- ============================================================
-- 006_fecha_ingreso.sql
-- Agrega fecha_ingreso a productos: cuándo entra un producto
-- nuevo al catálogo, para poder ver altas a lo largo del tiempo.
--
-- Se agrega SIN default primero: los productos que ya existen en
-- esta base quedarían con la fecha de HOY (fecha de la migración)
-- si el default se aplicara de una vez, lo cual sería falso para
-- piezas que llevan años en catálogo. Quedan en NULL = "fecha
-- desconocida / anterior a esta migración".
--
-- El default CURRENT_DATE se activa en un segundo paso y solo
-- aplica a partir de ahora, para INSERTs nuevos.
-- ============================================================

ALTER TABLE productos
    ADD COLUMN fecha_ingreso DATE;

ALTER TABLE productos
    ALTER COLUMN fecha_ingreso SET DEFAULT CURRENT_DATE;

CREATE INDEX idx_productos_fecha_ingreso ON productos (fecha_ingreso);
