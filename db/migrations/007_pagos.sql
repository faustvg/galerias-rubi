-- ============================================================
-- 007_pagos.sql
-- Tabla pagos: registra cómo se cobra cada nota (efectivo /
-- tarjeta / transferencia), incluyendo pagos divididos entre
-- métodos.
--
-- Se usa una tabla nueva en vez de columnas en notas porque un
-- pedido normalmente se cobra en más de un momento (anticipo al
-- levantar el pedido, resta al entregar), y cada uno de esos
-- momentos puede a su vez dividirse en más de un método.
--
-- anticipo/resta en notas NO cambian: siguen siendo la fuente de
-- verdad del monto total. pagos es el desglose de cómo se cobró.
--
-- folio_pedido -> notas(folio) ON DELETE CASCADE, igual que en
--   PARTIDAS: un pago no existe sin su nota.
-- usuario_id -> usuarios(id) ON DELETE SET NULL, igual que en
--   NOTAS: es un registro financiero, se conserva aunque se
--   borre el usuario que lo cobró.
-- metodo es VARCHAR libre (no CHECK): agregar un método de pago
--   nuevo el día de mañana no debe requerir otra migración.
-- ============================================================

CREATE TABLE pagos (
    id           SERIAL PRIMARY KEY,
    folio_pedido VARCHAR(20) NOT NULL REFERENCES notas(folio) ON DELETE CASCADE,
    fecha        DATE NOT NULL DEFAULT CURRENT_DATE,
    tipo         VARCHAR(20),           -- 'anticipo' | 'liquidacion' | 'abono' (libre, opcional)
    metodo       VARCHAR(20) NOT NULL,  -- 'efectivo' | 'tarjeta' | 'transferencia' | ...
    monto        NUMERIC(10,2) NOT NULL CHECK (monto > 0),
    usuario_id   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pagos_folio_pedido ON pagos (folio_pedido);

CREATE VIEW notas_pagos_resumen AS
SELECT
    folio_pedido,
    SUM(monto) FILTER (WHERE metodo = 'efectivo')      AS total_efectivo,
    SUM(monto) FILTER (WHERE metodo = 'tarjeta')        AS total_tarjeta,
    SUM(monto) FILTER (WHERE metodo = 'transferencia')  AS total_transferencia,
    SUM(monto)                                          AS total_pagado
FROM pagos
GROUP BY folio_pedido;
