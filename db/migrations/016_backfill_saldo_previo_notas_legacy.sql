-- ============================================================
--  Migración 016 (PROPUESTA — NO APLICADA) — saldo previo de notas
--  legacy sin ningún pago registrado
--
--  CONTEXTO: la migración 015 agregó trg_recalcular_anticipo, que
--  recalcula notas.anticipo como SUM(pagos.monto) cada vez que la tabla
--  pagos cambia (INSERT/UPDATE/DELETE). El propio comentario de esa
--  migración ya advertía: "una nota cuyo anticipo hoy ya está
--  desincronizado de SUM(pagos) se queda desincronizada hasta que reciba
--  un alta/edición/baja de pago después de aplicar esto" — eso ya pasó en
--  producción: la nota D-00010 tenía anticipo=$17,300 (capturado a mano,
--  sin ningún renglón en pagos) y total=$17,300 (resta=$0, "pagada por
--  completo"). Al registrar UN pago real de $500 a través del flujo de
--  Pagos, el trigger recalculó anticipo = SUM(pagos.monto) = $500 —
--  solo el pago nuevo, perdiendo silenciosamente los $17,300 previos. La
--  nota ahora se ve como si debiera $16,800 que en realidad ya se habían
--  cobrado.
--
--  Notas afectadas: anticipo > 0 con cero renglones en pagos. Ya se
--  contaron 136 con este SQL (fecha_pedido entre 2025-12-21 y
--  2026-07-29):
--
--    SELECT count(*), min(fecha_pedido), max(fecha_pedido)
--    FROM notas n
--    WHERE n.anticipo > 0
--      AND NOT EXISTS (SELECT 1 FROM pagos p WHERE p.folio_pedido = n.folio);
--
--  ESTO NO ES la misma idea que se rechazó antes ("no backfill" — no
--  inventar 136 historiales granulares de pago con fechas/métodos
--  individuales fabricados). Esa razón sigue siendo válida para el
--  DETALLE de cada nota — no sabemos en qué fechas ni con qué método se
--  cobró cada peso de esos $17,300. Pero el NÚMERO TOTAL sí se conoce y
--  es correcto (es justo lo que anticipo ya decía antes de que el
--  trigger lo pisara) — esta migración no inventa un dato nuevo, escribe
--  el que ya existía, ANTES de que se pierda con el primer pago real
--  contra cada folio.
--
--  DISEÑO: un renglón por nota afectada en pagos, con:
--    monto  = el anticipo actual de esa nota (el número ya conocido)
--    fecha  = fecha_pedido (proxy defendible: no hay una fecha de cobro
--             real registrada, así que se usa la fecha en que se levantó
--             el pedido — más cerca de la realidad que "hoy")
--    tipo   = 'saldo_previo' — valor NUEVO, deliberadamente distinto de
--             'anticipo'/'liquidacion'/'abono' (ver TIPOS_PAGO en
--             NotaFormulario.jsx), para que quede honestamente
--             etiquetado como "monto migrado", no como un pago
--             individual real con fecha/tipo verdaderos.
--    metodo = 'saldo_previo' — mismo criterio. metodo es NOT NULL en el
--             schema y es VARCHAR libre (sin CHECK, ver comentario
--             original de la tabla pagos), así que este valor es válido,
--             pero es un valor NUEVO fuera de METODOS_PAGO en el
--             frontend (efectivo/tarjeta/transferencia) — el frontend ya
--             muestra cualquier string tal cual (no valida contra una
--             lista fija al leer), así que renderiza bien, solo no
--             coincide con ningún ícono/estilo especial.
--             ⚠️ DECISIÓN ABIERTA: si 'saldo_previo' no es el label que
--             Faust prefiere para metodo, es el único valor de esta
--             migración que valdría la pena discutir antes de correrla.
--
--  Es AUTO-VERIFICABLE: al insertar, trg_recalcular_anticipo recalcula
--  notas.anticipo = SUM(pagos.monto) para ese folio — como este INSERT
--  es el ÚNICO renglón de pagos para esa nota, el resultado es
--  exactamente el mismo anticipo que ya tenía. No hace falta un UPDATE
--  aparte para "restaurar" el valor; el trigger ya lo hace solo.
--
--  IDEMPOTENTE por construcción: el WHERE NOT EXISTS solo alcanza notas
--  que TODAVÍA no tienen ningún pago al momento de correr esto — una
--  vez que una nota recibe su renglón (sea este backfill o un pago
--  real), deja de calificar. Correr esta migración dos veces no
--  duplica nada. También cubre el caso "whichever still haven't been
--  touched by the time this runs": si algunas de las 136 ya recibieron
--  un pago real entre el conteo original y ahora, esas ya NO aparecen
--  aquí (siguen su curso normal, sin necesitar backfill).
--
--  usuario_id: se deja NULL a propósito. La columna es
--  `INTEGER REFERENCES usuarios(id) ON DELETE SET NULL` (sin NOT NULL,
--  sin default — ver 007_pagos.sql), así que un NULL es válido y no
--  rompe el INSERT. No se inventa un usuario "sistema/migración": nadie
--  cobró estas 136 filas como un evento real, así que un usuario_id
--  vacío es lo honesto (mismo principio que el resto de esta migración:
--  no fabricar un dato que no se tiene). Además el frontend actual
--  (PagosEditor en NotaFormulario.jsx) no muestra nombre_usuario en la
--  lista de pagos de una nota, así que un NULL aquí no deja ningún hueco
--  visible en la UI.
--
--  tipo: confirmado sin CHECK ni enum a nivel de columna — es
--  `VARCHAR(20)` libre (ver 007_pagos.sql: "'anticipo' | 'liquidacion' |
--  'abono' (libre, opcional)"). TIPOS_PAGO en NotaFormulario.jsx es
--  validación de frontend únicamente; la base de datos acepta
--  'saldo_previo' sin problema. metodo también es VARCHAR(20) libre, sin
--  CHECK, por la misma razón (007_pagos.sql: "agregar un método de pago
--  nuevo el día de mañana no debe requerir otra migración").
--
--  Exclusión en reportes de periodo: GET /dashboard/cobros-periodo (y el
--  desglose por tipo que consume en Histórico) ya excluye
--  `pg.tipo = 'saldo_previo'` — ver api/routers/dashboard.py, WHERE de
--  cobros_periodo(). Estas filas siguen alimentando
--  trg_recalcular_anticipo (su único propósito) pero no cuentan como
--  dinero cobrado EN un periodo, porque no lo es — es un ajuste
--  correctivo con fecha = fecha_pedido, no una fecha de cobro real.
--
--  NO SE APLICA en esta migración — se corre a mano en el VPS después de
--  un pg_dump de respaldo, como cualquier otra. Revisar antes de correr:
--    1. ¿'saldo_previo' es aceptable para metodo, o prefieren otro label?
--    2. Confirmar el conteo actual (puede ya no ser 136 si algunas
--       recibieron pagos reales desde que se hizo el conteo original).
-- ============================================================

INSERT INTO pagos (folio_pedido, fecha, tipo, metodo, monto, usuario_id)
SELECT
    n.folio,
    n.fecha_pedido,
    'saldo_previo',
    'saldo_previo',
    n.anticipo,
    NULL
FROM notas n
WHERE n.anticipo > 0
  AND NOT EXISTS (SELECT 1 FROM pagos p WHERE p.folio_pedido = n.folio);
