-- ============================================================
-- 009_destacados.sql
-- Agrega destacados a productos: permite marcar manualmente qué
-- productos aparecen en la sección "Lo más buscado" del sitio
-- público, en vez de que salga automático — así las hermanas
-- deciden qué mostrar sin tocar código.
-- ============================================================

ALTER TABLE productos
    ADD COLUMN destacados BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_productos_destacados ON productos (destacados) WHERE destacados = true;
