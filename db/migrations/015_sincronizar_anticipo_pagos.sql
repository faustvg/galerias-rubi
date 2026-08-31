-- ============================================================
--  Migración 015 — trigger de sincronización pagos -> notas.anticipo
--
--  CONTEXTO: notas.anticipo ("Cantidad Pagada") se escribe hoy a mano en
--  el formulario de la nota (sección Montos), totalmente desconectado de
--  la tabla PAGOS (el registro real de cobros, cada uno con su propia
--  fecha/monto/método/tipo). Una nota puede mostrar "Cantidad Pagada:
--  $500" sin un solo renglón en pagos debajo, o viceversa — el propio
--  comentario original de la tabla PAGOS (ver schema.sql) documentaba
--  esto como decisión intencional ("anticipo/resta en NOTAS siguen
--  siendo la fuente de verdad del monto total; PAGOS es el desglose de
--  cómo se cobró"). Esta migración revierte esa decisión: a partir de
--  aquí, anticipo se calcula SIEMPRE desde pagos, nunca se escribe a mano.
--
--  DISEÑO — mismo patrón que trg_recalcular_existencias (schema.sql,
--  movimientos_inventario -> productos.existencias): un trigger AFTER
--  INSERT OR UPDATE OR DELETE en la tabla hija (pagos) recalcula la
--  columna derivada en el padre (notas.anticipo) desde SUM(monto). Se
--  eligió el trigger sobre recalcular a mano en los endpoints de la API
--  (POST/DELETE /notas/{folio}/pagos en notas.py) porque así queda
--  correcto sin importar qué escriba en pagos en el futuro — no solo los
--  dos endpoints de hoy — igual que existencias no depende de que cada
--  código que toque movimientos_inventario recuerde recalcular a mano.
--
--  Cubre los 3 eventos, no solo alta/baja: un pago puede corregirse
--  (UPDATE, ej. arreglar un monto mal capturado) y notas.anticipo debe
--  seguir ese cambio igual que sigue un alta o una baja. Hoy la API no
--  expone un PUT /pagos/{id} (solo POST y DELETE) — el trigger igual
--  cubre UPDATE desde ya, para no requerir otra migración el día que se
--  agregue esa edición.
--
--  notas.anticipo y notas.resta (columna GENERADA a partir de anticipo)
--  NO se eliminan ni se tocan como columnas — se quedan igual que antes.
--  Todo lo que hoy LEE anticipo/resta sigue funcionando sin cambios: el
--  ticket PDF (notas.py, sección "CANTIDAD PAGADA"), el dashboard, las
--  listas de notas. Lo único que cambia es QUIÉN escribe anticipo: antes
--  el usuario a mano en el formulario, ahora este trigger, en cuanto
--  pagos cambia. (El formulario deja de mandar `anticipo` en el payload
--  de POST/PUT /notas — ese cambio de frontend/API es aparte, no forma
--  parte de esta migración de base de datos.)
--
--  ⚠️ ESTA MIGRACIÓN NO RECONCILIA NOTAS EXISTENTES. El trigger solo
--  dispara con escrituras NUEVAS en pagos — una nota cuyo anticipo hoy
--  ya está desincronizado de SUM(pagos) (el bug exacto que esto arregla)
--  se queda desincronizada hasta que reciba un alta/edición/baja de pago
--  después de aplicar esto. Un backfill (UPDATE notas SET anticipo =
--  COALESCE(SUM(pagos.monto), 0) para todas las notas) reconciliaría el
--  histórico de una vez, pero es una decisión de negocio aparte, no
--  técnica: notas viejas capturadas en papel pueden tener anticipo > 0
--  sin NINGÚN renglón en pagos (la tabla pagos es más nueva que el
--  hábito de captura) — un backfill sin criterio les pondría anticipo
--  en $0. NO se incluye aquí a propósito; pídase como migración separada
--  si Faust decide que la quiere, después de revisar cuántas notas caen
--  en ese caso.
--
--  NO SE APLICA en esta migración — se corre a mano en el VPS después de
--  un pg_dump de respaldo, como cualquier otra.
-- ============================================================

CREATE OR REPLACE FUNCTION recalcular_anticipo() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE notas SET
            anticipo = COALESCE((SELECT SUM(monto) FROM pagos WHERE folio_pedido = OLD.folio_pedido), 0)
        WHERE folio = OLD.folio_pedido;
        RETURN OLD;
    ELSE
        UPDATE notas SET
            anticipo = COALESCE((SELECT SUM(monto) FROM pagos WHERE folio_pedido = NEW.folio_pedido), 0)
        WHERE folio = NEW.folio_pedido;

        -- Caso raro: si un pago se reasigna a otra nota (folio_pedido
        -- cambia en un UPDATE), recalcular también la nota anterior —
        -- mismo criterio que trg_recalcular_existencias para producto_id.
        IF TG_OP = 'UPDATE' AND OLD.folio_pedido IS DISTINCT FROM NEW.folio_pedido THEN
            UPDATE notas SET
                anticipo = COALESCE((SELECT SUM(monto) FROM pagos WHERE folio_pedido = OLD.folio_pedido), 0)
            WHERE folio = OLD.folio_pedido;
        END IF;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalcular_anticipo
    AFTER INSERT OR UPDATE OR DELETE ON pagos
    FOR EACH ROW EXECUTE FUNCTION recalcular_anticipo();
