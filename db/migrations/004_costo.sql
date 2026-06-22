-- ============================================================
--  Migración 004 — costo
--  Agrega el costo base de cada producto, para poder calcular
--  utilidad (ganancia) = precio_base - costo.
--
--  costo: lo que a NOSOTROS nos cuesta el producto (comprarlo al
--  proveedor, o materiales+mano de obra de uno hecho a medida).
--  Es un costo BASE/típico por producto — una estimación, no el
--  costo exacto por venta. Suficiente para márgenes aproximados
--  por categoría/proveedor sin agregar fricción al registrar ventas.
--
--  NUMERIC(10,2) igual que precio_base. DEFAULT 0 (productos sin
--  costo definido cuentan como 0 hasta que se les ponga uno).
-- ============================================================

ALTER TABLE productos
    ADD COLUMN costo NUMERIC(10,2) NOT NULL DEFAULT 0;