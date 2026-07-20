-- ============================================================
-- 008_movimientos_inventario.sql
-- Historial de entradas de inventario: cada llegada de un producto,
-- con fecha, cantidad y ubicación.
--
-- A diferencia de productos.fecha_ingreso (que solo marca la
-- PRIMERA vez que el modelo entra al catálogo), esta tabla registra
-- CADA llegada por separado — ej. "1 llegó el 11/07, 2 más
-- llegaron el 18/07" quedan como dos renglones distintos, cada uno
-- con su propia fecha, cantidad y ubicación.
--
-- productos.existencias sigue siendo el conteo actual (se
-- incrementa con cada movimiento nuevo); esta tabla es el desglose
-- de cómo se llegó a ese número — mismo patrón que pagos es el
-- desglose de cómo se cobró una nota, o partidas el desglose de
-- qué contiene una nota.
--
-- producto_id -> productos(id) ON DELETE CASCADE: un movimiento no
--   existe sin su producto.
-- usuario_id -> usuarios(id) ON DELETE SET NULL: quién lo registró,
--   opcional, se conserva si se borra el usuario (mismo patrón que
--   notas.usuario_id y pagos.usuario_id).
-- ubicacion es VARCHAR libre, no FK: coincide con el estilo de
--   productos.ubicaciones (TEXT[] de texto libre), no un catálogo
--   cerrado de ubicaciones.
-- ============================================================

CREATE TABLE movimientos_inventario (
    id           SERIAL PRIMARY KEY,
    producto_id  INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    cantidad     INTEGER NOT NULL CHECK (cantidad > 0),
    fecha        DATE NOT NULL DEFAULT CURRENT_DATE,
    ubicacion    VARCHAR(100),
    usuario_id   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_movimientos_producto_id ON movimientos_inventario (producto_id);
CREATE INDEX idx_movimientos_fecha ON movimientos_inventario (fecha);
