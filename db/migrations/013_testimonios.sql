-- ============================================================
--  Migración 013 — testimonios
--
--  CONTEXTO: el testimonio del sitio público estaba hardcodeado en
--  index.html (un solo <blockquote> fijo). La familia quiere poder
--  curar qué testimonios se muestran sin tocar código — mismo patrón
--  ya usado para productos.destacados: se marca/edita desde el panel,
--  el sitio público solo refleja lo que ya está aprobado.
--
--  DISEÑO:
--   - activo: igual que destacados/visible_en_sitio en otras tablas —
--     permite tener testimonios cargados pero no publicados todavía.
--   - orden: entero simple para controlar el orden de aparición en el
--     carrusel público (ascendente). Empieza en 0, sin restricción de
--     unicidad — si dos quedan con el mismo valor, el orden entre ellos
--     no importa lo suficiente como para forzar una constraint.
--   - ciudad: opcional (nullable) — no todos los testimonios necesitan
--     atribuir una ciudad.
--   - Sin FK hacia notas/clientes: es contenido de marketing curado a
--     mano, no un registro transaccional — no hay necesidad de ligarlo
--     a una venta real.
--
--  BACKFILL: se migra el único testimonio que ya existía hardcodeado en
--  el sitio (Familia Hernández), para que no desaparezca nada al lanzar
--  esto — queda con orden=0, primero en el carrusel.
-- ============================================================

CREATE TABLE testimonios (
    id        SERIAL PRIMARY KEY,
    texto     TEXT NOT NULL,
    autor     VARCHAR(150) NOT NULL,
    ciudad    VARCHAR(100),
    activo    BOOLEAN NOT NULL DEFAULT true,
    orden     INTEGER NOT NULL DEFAULT 0,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO testimonios (texto, autor, ciudad, activo, orden) VALUES
  ('El comedor que nos hicieron es la pieza central de nuestra casa. La calidad de la parota es increíble — y lo entregaron antes de lo prometido.',
   'Familia Hernández', 'Ciudad de México', true, 0);
