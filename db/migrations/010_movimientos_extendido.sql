-- ============================================================
-- 010_movimientos_extendido.sql
-- Extiende movimientos_inventario para soportar el rediseño del
-- panel de stock: cada movimiento ahora también registra
-- proveedor y costo (para poder ver cuánto se invierte por
-- ubicación y por semana), y los movimientos pueden editarse o
-- borrarse — no solo agregarse.
--
-- Como los movimientos ahora pueden editarse/borrarse, productos.
-- existencias, productos.fecha_ingreso y productos.ubicaciones YA
-- NO se escriben a mano: se vuelven completamente derivados de
-- movimientos_inventario, mantenidos por un trigger, para que nunca
-- se desincronicen sin importar cuántas veces se edite el historial.
-- La elección de ubicación pasa a hacerse una vez por movimiento (en
-- "Editar stock"), no como una lista aparte en el formulario del
-- producto.
--
-- NOTA sobre el backfill de ubicaciones: movimientos_inventario.
-- ubicacion es UN solo valor por renglón, pero productos.ubicaciones
-- es un arreglo (un producto puede estar en varios locales a la
-- vez). El backfill de abajo solo puede sembrar el PRIMER valor del
-- arreglo existente en el movimiento sintético — si un producto ya
-- tenía más de una ubicación marcada, las demás no sobreviven el
-- corte (se pierden al momento de esta migración, no después: una
-- vez migrado, cada ubicación nueva que se capture en un movimiento
-- sí se refleja normalmente).
-- ============================================================

ALTER TABLE movimientos_inventario
    ADD COLUMN proveedor_id   INTEGER REFERENCES proveedores(id),
    ADD COLUMN costo_unitario NUMERIC(10,2),
    ADD COLUMN costo_total    NUMERIC(10,2) GENERATED ALWAYS AS (cantidad * costo_unitario) STORED;

-- ------------------------------------------------------------
-- Trigger: mantiene productos.existencias, productos.fecha_ingreso y
-- productos.ubicaciones sincronizados con movimientos_inventario en
-- INSERT/UPDATE/DELETE.
--   existencias   = suma de todas las cantidades registradas.
--   fecha_ingreso = fecha del movimiento más antiguo.
--   ubicaciones   = ubicaciones DISTINTAS (no nulas) entre todos los
--                   movimientos del producto, ordenadas alfabéticamente.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalcular_existencias() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE productos SET
            existencias   = COALESCE((SELECT SUM(cantidad) FROM movimientos_inventario WHERE producto_id = OLD.producto_id), 0),
            fecha_ingreso = (SELECT MIN(fecha) FROM movimientos_inventario WHERE producto_id = OLD.producto_id),
            ubicaciones   = COALESCE(
                (SELECT array_agg(DISTINCT ubicacion ORDER BY ubicacion)
                 FROM movimientos_inventario
                 WHERE producto_id = OLD.producto_id AND ubicacion IS NOT NULL),
                '{}'
            )
        WHERE id = OLD.producto_id;
        RETURN OLD;
    ELSE
        UPDATE productos SET
            existencias   = COALESCE((SELECT SUM(cantidad) FROM movimientos_inventario WHERE producto_id = NEW.producto_id), 0),
            fecha_ingreso = (SELECT MIN(fecha) FROM movimientos_inventario WHERE producto_id = NEW.producto_id),
            ubicaciones   = COALESCE(
                (SELECT array_agg(DISTINCT ubicacion ORDER BY ubicacion)
                 FROM movimientos_inventario
                 WHERE producto_id = NEW.producto_id AND ubicacion IS NOT NULL),
                '{}'
            )
        WHERE id = NEW.producto_id;

        -- Caso raro: si un movimiento se reasigna a otro producto,
        -- recalcular también el producto anterior.
        IF TG_OP = 'UPDATE' AND OLD.producto_id IS DISTINCT FROM NEW.producto_id THEN
            UPDATE productos SET
                existencias   = COALESCE((SELECT SUM(cantidad) FROM movimientos_inventario WHERE producto_id = OLD.producto_id), 0),
                fecha_ingreso = (SELECT MIN(fecha) FROM movimientos_inventario WHERE producto_id = OLD.producto_id),
                ubicaciones   = COALESCE(
                    (SELECT array_agg(DISTINCT ubicacion ORDER BY ubicacion)
                     FROM movimientos_inventario
                     WHERE producto_id = OLD.producto_id AND ubicacion IS NOT NULL),
                    '{}'
                )
            WHERE id = OLD.producto_id;
        END IF;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalcular_existencias
    AFTER INSERT OR UPDATE OR DELETE ON movimientos_inventario
    FOR EACH ROW EXECUTE FUNCTION recalcular_existencias();

-- ------------------------------------------------------------
-- Backfill: productos con existencias > 0 pero SIN movimientos
-- registrados (catálogo de antes de esta función) reciben un
-- movimiento inicial, para que la suma derivada no pierda ese
-- conteo. Fecha: la fecha_ingreso que ya tenían, o hoy si no había.
-- Ubicación: la primera del arreglo existente, si tenía alguna (ver
-- nota al inicio del archivo sobre la limitación de este backfill).
-- ------------------------------------------------------------
INSERT INTO movimientos_inventario (producto_id, cantidad, fecha, proveedor_id, ubicacion)
SELECT
    id, existencias, COALESCE(fecha_ingreso, CURRENT_DATE), proveedor_id,
    CASE WHEN array_length(ubicaciones, 1) > 0 THEN ubicaciones[1] ELSE NULL END
FROM productos
WHERE existencias > 0
  AND id NOT IN (SELECT DISTINCT producto_id FROM movimientos_inventario);
