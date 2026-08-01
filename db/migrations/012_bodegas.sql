-- ============================================================
--  Migración 012 — bodegas
--
--  CONTEXTO: hasta ahora movimientos_inventario.ubicacion es texto libre
--  ("Local Mexico", "Local Jose", "Local Amarillo", "Almacen"), sin ningún
--  enlace a la sucursal de venta (migración 011). Uno de esos valores,
--  "Local Mexico", en realidad YA ES la bodega de CDMX — las otras tres
--  son de San Pedro. Esta migración formaliza eso: crea un catálogo de
--  bodegas con FK a sucursales, para poder ver existencias agrupadas por
--  sucursal sin adivinar a partir de texto libre.
--
--  MAPEO (confirmado con la familia, definitivo):
--    Local Mexico    -> Ciudad de México
--    Local Jose      -> San Pedro Tultepec
--    Local Amarillo  -> San Pedro Tultepec
--    Almacen         -> San Pedro Tultepec
--
--  OJO — bodega (logística interna) y sucursal (entidad legal de venta)
--  siguen siendo conceptos DISTINTOS, igual que se explicó en la 011 para
--  productos.ubicaciones. No se fusionan en una tabla ni columna: se
--  conectan por FK (bodegas.sucursal_id), nada más. Una bodega pertenece
--  a una sucursal; una sucursal puede tener varias bodegas.
--
--  DISEÑO — bodega_id es ADITIVO, no un reemplazo:
--  movimientos_inventario.ubicacion (texto) sigue existiendo tal cual y
--  sigue siendo lo único que trg_recalcular_existencias lee (ver
--  schema.sql) — ese trigger NO se toca en esta migración. bodega_id es
--  un enlace en paralelo para el nuevo rollup de existencias por
--  sucursal; el texto libre sigue siendo la fuente de verdad del trigger
--  existente, para minimizar el riesgo sobre una pieza que ya funciona.
--
--  BACKFILL: matchea movimientos_inventario.ubicacion contra bodegas.nombre
--  por texto exacto. Filas cuyo texto no matchea ningún nombre de bodega
--  (valores como "Sin ubicación", NULL, o typos históricos) se quedan con
--  bodega_id NULL — no se inventa a qué bodega pertenecen. Repórtese el
--  conteo de esas filas después de aplicar (ver verificación).
-- ============================================================

CREATE TABLE bodegas (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    sucursal_id INTEGER REFERENCES sucursales(id) ON DELETE SET NULL,
    activo      BOOLEAN NOT NULL DEFAULT true
);

-- Seed a partir de los valores que ya existen como texto libre hoy.
INSERT INTO bodegas (nombre, sucursal_id, activo)
SELECT 'Local Mexico', id, true FROM sucursales WHERE nombre = 'Ciudad de México'
UNION ALL
SELECT 'Local Jose', id, true FROM sucursales WHERE nombre = 'San Pedro Tultepec'
UNION ALL
SELECT 'Local Amarillo', id, true FROM sucursales WHERE nombre = 'San Pedro Tultepec'
UNION ALL
SELECT 'Almacen', id, true FROM sucursales WHERE nombre = 'San Pedro Tultepec';

-- Columna nueva, ADITIVA. NO se toca ni se elimina
-- movimientos_inventario.ubicacion — sigue alimentando
-- trg_recalcular_existencias exactamente igual que antes.
ALTER TABLE movimientos_inventario
    ADD COLUMN bodega_id INTEGER REFERENCES bodegas(id);

-- Backfill: matchea el texto libre existente contra el nombre de la bodega.
UPDATE movimientos_inventario m
SET bodega_id = b.id
FROM bodegas b
WHERE m.ubicacion = b.nombre;
