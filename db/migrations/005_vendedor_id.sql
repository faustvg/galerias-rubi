-- ============================================================
--  Migración 005 — vendedor_id
--
--  BUG QUE ARREGLA: el campo 'vendedor' de NOTAS es texto libre,
--  copiado del nombre del trabajador en el momento de crear/editar
--  la nota. Si ese trabajador cambia de nombre en Usuarios después,
--  las notas ya guardadas se quedan con el nombre VIEJO para siempre
--  (en la lista de notas, el detalle, el PDF y los dashboards de
--  utilidad por vendedor) — el cambio nunca se propaga.
--
--  FIX: agregamos 'vendedor_id', un enlace estructurado a usuarios(id),
--  igual que ya existe 'usuario_id' (el creador de la nota). A partir
--  de ahora la app muestra SIEMPRE el nombre ACTUAL vía este enlace
--  (JOIN en tiempo de consulta), no una copia congelada.
--
--  'vendedor' (texto) NO se borra: sigue siendo el respaldo para
--  notas de papel importadas sin cuenta de sistema asociada. Cuando
--  vendedor_id IS NOT NULL, su nombre en vivo gana sobre el texto.
--
--  BACKFILL: para notas existentes, si el texto de 'vendedor' coincide
--  (sin importar mayúsculas/espacios) con el nombre de un usuario actual,
--  enlazamos vendedor_id automáticamente. Los que no coincidan (ex
--  empleados ya renombrados, notas de papel genéricas) se quedan solo
--  con el texto, igual que antes.
-- ============================================================

ALTER TABLE notas
    ADD COLUMN vendedor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;

UPDATE notas n
SET    vendedor_id = u.id
FROM   usuarios u
WHERE  n.vendedor_id IS NULL
  AND  n.vendedor IS NOT NULL
  AND  lower(trim(n.vendedor)) = lower(trim(u.nombre));
