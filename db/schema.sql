-- ============================================================
--  GALERÍAS RUBÍ — Esquema de base de datos
--
--  SECUENCIA PARA FOLIOS DIGITALES (se crea al final del archivo):
--    Los talonarios de papel usan números puros ('0986').
--    El sistema digital usa prefijo 'D-': 'D-00001', 'D-00002'.
--    Así nunca chocan. La app también la crea con IF NOT EXISTS al
--    arrancar, por lo que para bases existentes no hace falta migrar.
--  Stack: PostgreSQL (local en Windows ahora; también en VPS Hetzner)
--
--  Orden de creación = orden de dependencias:
--    1. categorias  2. proveedores  3. productos   4. sucursales
--    5. producto_sucursal  6. usuarios  7. notas  8. partidas
--    9. pagos  10. bodegas  11. movimientos_inventario  12. testimonios
--  Las tablas "padre" se crean antes que las que las referencian.
--  (usuarios va ANTES de notas porque notas referencia a usuarios.
--  sucursales va ANTES de usuarios y notas porque ambas la referencian.
--  bodegas va ANTES de movimientos_inventario porque esta última la
--  referencia vía bodega_id. testimonios no tiene FKs — va al final por
--  ser la tabla más nueva, sin que su posición importe realmente.)
--
--  Para cargar este archivo en psql (base de datos VACÍA):
--    \i 'D:/Faus_/galerias_rubi/db/schema.sql'
--
--  NOTA sobre cambios de esquema:
--  Este archivo es la "foto completa" del esquema actual (Opción A).
--  Para aplicar cambios a una base de datos que YA EXISTE (ej. el VPS),
--  no se re-ejecuta este archivo: se usan los archivos de migración en
--  db/migrations/ (ej. 001_usuarios.sql con su ALTER TABLE).
-- ============================================================


-- ------------------------------------------------------------
-- 1. CATEGORIAS
--    Salas, comedores, roperos, etc.
--    descuento_pct aplica a TODA la categoría (ej. 10% en todos
--    los comedores con un solo cambio).
-- ------------------------------------------------------------
CREATE TABLE categorias (
    id            SERIAL PRIMARY KEY,
    nombre        VARCHAR(100) NOT NULL,
    descuento_pct NUMERIC(5,2) DEFAULT 0
);


-- ------------------------------------------------------------
-- 2. PROVEEDORES
--    Proveedores de piezas ya hechas (salas, sillones de proveedor).
--    Se guarda una vez y se enlaza, para no reescribir el nombre
--    en cada producto.
-- ------------------------------------------------------------
CREATE TABLE proveedores (
    id        SERIAL PRIMARY KEY,
    proveedor VARCHAR(150) NOT NULL
);


-- ------------------------------------------------------------
-- 3. PRODUCTOS  (el CATÁLOGO — modelos base)
--    precio_base = precio de catálogo / sitio.
--    descuento_pct aquí SOBREESCRIBE al de la categoría;
--      NULL = "hereda el descuento de la categoría",
--      0    = "sin descuento aunque la categoría tenga".
--    fotos = ARRAY de rutas/URLs (3+ fotos por mueble). La primera
--      es la imagen principal. Guarda rutas, NO los archivos.
--    existencias: piezas de proveedor llevan conteo; las hechas
--      a medida quedan en 0.
--    visible_en_sitio: controla qué sale al productos.json público.
--    categoria_id / proveedor_id quedan NULLABLE a propósito:
--      una pieza a medida puede no tener proveedor. proveedor_id aquí es
--      el proveedor POR DEFECTO del catálogo (se fija al crear el
--      producto) — distinto de movimientos_inventario.proveedor_id, que
--      es de quién vino CADA entrada de stock (pueden diferir entre sí).
--    fecha_ingreso (migración 006) = cuándo entra la pieza al catálogo,
--      para ver altas de inventario a lo largo del tiempo.
--      DERIVADO (migración 010, ver sección 8): desde que existen
--      movimientos_inventario editables/borrables, esta columna la
--      mantiene un trigger — es la fecha del movimiento más antiguo del
--      producto. La app NUNCA la escribe directamente; el DEFAULT
--      CURRENT_DATE de aquí abajo solo cubre el instante entre crear el
--      producto y registrar su primer movimiento.
--    ubicaciones = en qué locales físicos está el producto. DERIVADO
--      (migración 010, ver sección 8) igual que fecha_ingreso: el trigger
--      lo recalcula como el conjunto de ubicaciones DISTINTAS entre todos
--      los movimientos del producto. Ya no se elige a mano en el
--      formulario del producto — se captura una vez por movimiento en
--      "Editar stock".
--    destacados (NUEVO, migración 009) = marca manual de qué productos
--      aparecen en "Lo más buscado" del sitio público. Manual, no
--      automático — las hermanas deciden desde el panel qué mostrar.
-- ------------------------------------------------------------
CREATE TABLE productos (
    id               SERIAL PRIMARY KEY,
    nombre           VARCHAR(150) NOT NULL,
    categoria_id     INTEGER REFERENCES categorias(id),
    proveedor_id     INTEGER REFERENCES proveedores(id),
    color            VARCHAR(80),
    material         VARCHAR(80),
    descripcion      TEXT,
    precio_base      NUMERIC(10,2) NOT NULL DEFAULT 0,
    fotos            TEXT[] DEFAULT '{}',
    existencias      INTEGER NOT NULL DEFAULT 0,
    visible_en_sitio BOOLEAN NOT NULL DEFAULT true,
    descuento_pct    NUMERIC(5,2),
    ubicaciones      TEXT[] DEFAULT '{}',
    costo            NUMERIC(10,2) NOT NULL DEFAULT 0,
    fecha_ingreso    DATE DEFAULT CURRENT_DATE,
    destacados       BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_productos_fecha_ingreso ON productos (fecha_ingreso);
CREATE INDEX idx_productos_destacados ON productos (destacados) WHERE destacados = true;


-- ------------------------------------------------------------
-- 4. SUCURSALES  (migración 011 — ubicaciones de venta)
--    Catálogo cerrado de las ubicaciones donde se vende: San Pedro
--    Tultepec (Muebles Rubí) y Ciudad de México (Muebles Local
--    No.17) — dos entidades legales distintas, mismo taller/familia.
--
--    OJO: esto NO es lo mismo que productos.ubicaciones (bodega/
--    logística interna, derivado de movimientos_inventario). Son
--    conceptos separados a propósito: 'sucursal' es dónde se VENDE,
--    'ubicacion' es dónde está FÍSICAMENTE guardado un mueble.
--
--    razon_social: el nombre fiscal, distinto del nombre comercial
--      ('nombre'), porque cada sucursal es una entidad legal aparte
--      para efectos fiscales.
--    ocultar_precio_publico: decisión a nivel de SUCURSAL COMPLETA
--      (no por producto individual) de mostrar precio o un CTA de
--      WhatsApp en el sitio público para lo que vende esa sucursal.
--    activo: permite dar de alta la sucursal en la base sin que
--      aparezca todavía en el sitio público, mientras la familia
--      termina de cargar sus datos reales desde el panel.
--    es_principal: identifica a San Pedro de forma ESTABLE, sin
--      depender del texto de 'nombre' (que sí es editable desde
--      Sucursales.jsx). El backend usa esta columna — nunca
--      nombre = 'Ciudad de México' — para decidir cuál sucursal
--      alimenta los CTAs genéricos del sitio y cuál es "la otra" para
--      disponible_cdmx/precio_cdmx. NO se expone como editable en la
--      API/UI todavía: solo se fija por seed/migración, para que
--      nunca queden 0 o 2+ sucursales marcadas principal por accidente.
--      ⚠️ Asume EXACTAMENTE 2 sucursales — una tercera requeriría
--      refactor a un modelo genérico, no solo este booleano.
--    lat/lng (migración 014): coordenadas para sugerir la sucursal más
--      cercana en el sitio público (geolocalización opcional, nunca
--      automática — ver producto.html). Nullable: CDMX queda en NULL
--      hasta que se le asignen coordenadas reales al activarla. San
--      Pedro usa precisión de pueblo (INEGI), suficiente para comparar
--      contra CDMX (~44 km) sin necesitar la coordenada exacta.
-- ------------------------------------------------------------
CREATE TABLE sucursales (
    id                     SERIAL PRIMARY KEY,
    nombre                 VARCHAR(100) NOT NULL,
    razon_social           VARCHAR(150) NOT NULL,
    direccion              TEXT,
    maps_url               TEXT,
    whatsapp               VARCHAR(20),
    ocultar_precio_publico BOOLEAN NOT NULL DEFAULT false,
    activo                 BOOLEAN NOT NULL DEFAULT true,
    es_principal           BOOLEAN NOT NULL DEFAULT false,
    lat                    NUMERIC(10,7),
    lng                    NUMERIC(10,7)
);


-- ------------------------------------------------------------
-- 5. PRODUCTO_SUCURSAL  (migración 011 — catálogo y precio por sucursal)
--    Solo tiene fila cuando un producto TAMBIÉN se vende en una
--    sucursal distinta de San Pedro (con su propio precio, por
--    transporte/renta). San Pedro sigue usando productos.precio_base
--    directamente y nunca necesita fila aquí.
--    PRIMARY KEY compuesta (producto_id, sucursal_id): un producto
--    tiene a lo más un precio por sucursal.
-- ------------------------------------------------------------
CREATE TABLE producto_sucursal (
    producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    sucursal_id INTEGER NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
    precio      NUMERIC(10,2) NOT NULL,
    PRIMARY KEY (producto_id, sucursal_id)
);


-- ------------------------------------------------------------
-- 6. USUARIOS  (cuentas del panel admin — autenticación y permisos)
--
--    REGLAS DE SEGURIDAD (no negociables):
--    - La contraseña NUNCA se guarda en texto plano. Se guarda un
--      HASH (revoltijo de una sola dirección). Aunque roben la base
--      de datos, no pueden leer las contraseñas.
--    - El hashing lo hace una librería probada (passlib/bcrypt) en
--      el backend. NUNCA se programa el hashing a mano.
--    - Autenticación basada en SESIONES (cookie HttpOnly), no JWT.
--    - Esta tabla la maneja solo el superadmin.
--
--    Roles (de mayor a menor privilegio):
--      'superadmin' -> Faust. Todo + gestión de usuarios.
--      'admin'      -> hermanos. Todo lo operativo (catálogo, todas
--                     las notas, dashboards, finanzas). Sin gestión
--                     de usuarios.
--      'viewer'     -> padres. Solo lectura de dashboards/resúmenes.
--      'worker'     -> empleados. Crea productos/fotos. Maneja SOLO
--                     sus propias notas. NO ve ventas ni finanzas de
--                     otros ni el panorama general de dinero.
--
--    password_hash VARCHAR(255): los hashes de bcrypt ocupan ~60
--      caracteres; dejamos margen.
--    rol ... CHECK: la base RECHAZA cualquier rol fuera de los
--      cuatro permitidos. Integridad a nivel DB.
--    activo: permite desactivar a alguien sin borrarlo (ej. un
--      empleado que se va). FALSE = no puede entrar, pero su
--      historial de notas se conserva.
--    sucursal_id (migración 011) = a qué sucursal está asignado HOY
--      este usuario. Los vendedores se pueden reubicar (ej. de San
--      Pedro a CDMX) — cambiar esto NO reescribe la sucursal de sus
--      notas pasadas, solo afecta notas.sucursal_id de aquí en
--      adelante (se copia al crear cada nota nueva). NULLABLE:
--      roles que no son de piso (viewer) no necesitan una.
-- ------------------------------------------------------------
CREATE TABLE usuarios (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(50) UNIQUE NOT NULL,
    nombre        VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    rol           VARCHAR(20) NOT NULL DEFAULT 'worker'
                  CHECK (rol IN ('superadmin', 'admin', 'viewer', 'worker')),
    activo        BOOLEAN NOT NULL DEFAULT true,
    creado_en     TIMESTAMP NOT NULL DEFAULT NOW(),
    sucursal_id   INTEGER REFERENCES sucursales(id) ON DELETE SET NULL
);


-- ------------------------------------------------------------
-- 7. NOTAS  (encabezado de la transacción: cotización/pedido/venta)
--    folio = número del talonario de papel (ej. '0986'). Es TEXTO,
--      no entero, para conservar ceros a la izquierda.
--    Cliente APLANADO aquí (nombre_cliente, telefono) — sin tabla
--      CLIENTES, porque los clientes rara vez regresan. Reversible.
--    resta = columna GENERADA (total - anticipo): se calcula sola,
--      no se puede escribir, nunca se desincroniza.
--    consideraciones = notas de TODA la nota (ej. "entrega sábado").
--    estatus: 'Presupuesto' / 'En proceso' / 'Entregado'.
--
--    usuario_id (NUEVO) = enlace al usuario del sistema que creó la
--      nota. Es la base del aislamiento por usuario: un 'worker' solo
--      consulta las notas WHERE usuario_id = su propio id; admin y
--      superadmin ven todas. (El filtrado vive en el código de la API.)
--      NULLABLE: las notas históricas (de papel) no tienen un usuario
--      del sistema asignado. ON DELETE SET NULL: si se borrara un
--      usuario, sus notas se conservan (registros financieros), solo
--      pierden el enlace. (En la práctica se usa activo=false, no
--      se borra.)
--
--    NOTA: 'vendedor' (texto libre, el nombre escrito en el papel) y
--      'usuario_id' (enlace estructurado) coexisten: uno es el dato
--      histórico/textual, el otro es para permisos y filtrado.
--
--    vendedor_id (NUEVO, migración 005) = enlace estructurado al
--      usuario que hizo la venta. A diferencia de 'vendedor' (texto
--      congelado al momento de guardar la nota), este SIEMPRE resuelve
--      al nombre ACTUAL del usuario vía JOIN — si alguien cambia su
--      nombre en Usuarios, todas sus notas pasadas lo reflejan de
--      inmediato. 'vendedor' (texto) sigue existiendo como respaldo
--      para notas de papel sin cuenta de sistema asociada.
--
--    sucursal_id (migración 011) = la sucursal de ESTA VENTA,
--      CONGELADA al crear la nota (se copia del sucursal_id del
--      vendedor en ese momento). A propósito NO es un JOIN en vivo
--      como vendedor_id: si el vendedor se reubica de sucursal
--      después, sus notas pasadas deben seguir mostrando la sucursal
--      donde realmente ocurrió la venta — mismo principio de "no
--      reescribir historia" que fecha_ingreso. NULLABLE: notas
--      históricas anteriores a esta migración no tienen forma
--      confiable de inferir su sucursal, quedan sin asignar.
-- ------------------------------------------------------------
CREATE TABLE notas (
    folio            VARCHAR(20) PRIMARY KEY,
    fecha_pedido     DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_entrega    DATE,
    estatus          VARCHAR(20) NOT NULL DEFAULT 'Presupuesto',
    total            NUMERIC(10,2) NOT NULL DEFAULT 0,
    anticipo         NUMERIC(10,2) NOT NULL DEFAULT 0,
    resta            NUMERIC(10,2) GENERATED ALWAYS AS (total - anticipo) STORED,
    vendedor         VARCHAR(100),
    nombre_cliente   VARCHAR(150),
    telefono         VARCHAR(20),
    consideraciones  TEXT,
    usuario_id       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    vendedor_id      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    foto_nota        TEXT,
    sucursal_id      INTEGER REFERENCES sucursales(id) ON DELETE SET NULL
);


-- ------------------------------------------------------------
-- 8. PARTIDAS  (una línea por producto con su propio precio)
--    Tabla puente que resuelve el muchos-a-muchos entre NOTAS y
--    PRODUCTOS. REGLA: una partida = una cosa con su propio precio.
--      Dos productos -> dos partidas bajo el mismo folio.
--      Un juego vendido como unidad (sala 5 piezas) = una partida,
--      cantidad 1.
--    folio_pedido -> notas(folio), NOT NULL (una línea no existe
--      sin su nota). ON DELETE CASCADE: borrar la nota borra sus
--      partidas.
--    producto_id NULLABLE: permite vender algo único que no está
--      en el catálogo (solo texto + precio).
--    modificaciones = cómo difiere ESTA pieza del modelo base.
--    precio_unitario = precio REAL cotizado (custom), no el de
--      catálogo.
--    importe = columna GENERADA (cantidad * precio_unitario).
-- ------------------------------------------------------------
CREATE TABLE partidas (
    id              SERIAL PRIMARY KEY,
    folio_pedido    VARCHAR(20) NOT NULL REFERENCES notas(folio) ON DELETE CASCADE,
    producto_id     INTEGER REFERENCES productos(id),
    cantidad        INTEGER NOT NULL DEFAULT 1,
    modificaciones  TEXT,
    precio_unitario NUMERIC(10,2) NOT NULL DEFAULT 0,
    importe         NUMERIC(10,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED
);


-- ------------------------------------------------------------
-- 9. PAGOS  (migración 007 — cómo se cobró cada nota)
--    Tabla nueva en vez de columnas en NOTAS porque un pedido
--    normalmente se cobra en más de un momento (anticipo al
--    levantar el pedido, resta al entregar), y cada momento puede
--    a su vez dividirse entre métodos (parte efectivo, parte
--    tarjeta). anticipo/resta en NOTAS siguen siendo la fuente de
--    verdad del monto total; PAGOS es el desglose de cómo se cobró.
--
--    folio_pedido -> notas(folio) ON DELETE CASCADE, igual que en
--      PARTIDAS: un pago no existe sin su nota.
--    usuario_id -> usuarios(id) ON DELETE SET NULL, igual que en
--      NOTAS: es un registro financiero, se conserva aunque se
--      borre el usuario que lo cobró.
--    metodo es VARCHAR libre (no CHECK): agregar un método de pago
--      nuevo el día de mañana no debe requerir otra migración.
--    tipo es libre y opcional: 'anticipo' | 'liquidacion' | 'abono',
--      solo para contexto, no se valida a nivel DB.
-- ------------------------------------------------------------
CREATE TABLE pagos (
    id           SERIAL PRIMARY KEY,
    folio_pedido VARCHAR(20) NOT NULL REFERENCES notas(folio) ON DELETE CASCADE,
    fecha        DATE NOT NULL DEFAULT CURRENT_DATE,
    tipo         VARCHAR(20),
    metodo       VARCHAR(20) NOT NULL,
    monto        NUMERIC(10,2) NOT NULL CHECK (monto > 0),
    usuario_id   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pagos_folio_pedido ON pagos (folio_pedido);

-- Vista de resumen: desglose de pagos por método, uno por folio.
-- Usada por el detalle de nota para mostrar "efectivo: $X / tarjeta: $Y"
-- sin un segundo round-trip ni recalcular en Python.
CREATE VIEW notas_pagos_resumen AS
SELECT
    folio_pedido,
    SUM(monto) FILTER (WHERE metodo = 'efectivo')      AS total_efectivo,
    SUM(monto) FILTER (WHERE metodo = 'tarjeta')        AS total_tarjeta,
    SUM(monto) FILTER (WHERE metodo = 'transferencia')  AS total_transferencia,
    SUM(monto)                                          AS total_pagado
FROM pagos
GROUP BY folio_pedido;


-- ------------------------------------------------------------
-- 10. BODEGAS  (migración 012 — catálogo de bodegas, enlazadas a sucursal)
--    Formaliza lo que antes era solo texto libre en
--    movimientos_inventario.ubicacion. Cada bodega pertenece a una
--    sucursal (bodegas.sucursal_id); una sucursal puede tener varias
--    bodegas (San Pedro tiene 3: Local Jose, Local Amarillo, Almacen;
--    CDMX tiene 1: Local Mexico).
--
--    OJO: bodega (logística interna — dónde está FÍSICAMENTE un mueble)
--    y sucursal (entidad legal de venta) siguen siendo conceptos
--    DISTINTOS, igual que ya se explicó para productos.ubicaciones. No
--    se fusionan: se conectan por FK, nada más.
--
--    nombre es UNIQUE porque movimientos_inventario.ubicacion (texto
--    libre) se sigue usando para el backfill/matching por nombre exacto
--    — dos bodegas con el mismo nombre harían ese match ambiguo.
--    sucursal_id ON DELETE SET NULL: si se borrara una sucursal, sus
--    bodegas se conservan (historial de movimientos), solo pierden el
--    enlace.
-- ------------------------------------------------------------
CREATE TABLE bodegas (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    sucursal_id INTEGER REFERENCES sucursales(id) ON DELETE SET NULL,
    activo      BOOLEAN NOT NULL DEFAULT true
);


-- ------------------------------------------------------------
-- 11. MOVIMIENTOS_INVENTARIO  (migración 008, extendida en 010 y 012 —
--    historial de entradas de inventario, editable)
--    A diferencia de productos.fecha_ingreso (solo la PRIMERA vez que
--    el modelo entra al catálogo), esta tabla registra CADA llegada
--    por separado, con su propia fecha, cantidad, ubicación, proveedor
--    y costo. Los renglones se pueden editar o borrar (no solo agregar)
--    para poder corregir una captura equivocada.
--
--    producto_id -> productos(id) ON DELETE CASCADE: un movimiento no
--      existe sin su producto.
--    usuario_id -> usuarios(id) ON DELETE SET NULL: quién lo registró,
--      opcional, se conserva si se borra el usuario.
--    ubicacion es VARCHAR libre, no FK: coincide con el estilo de
--      productos.ubicaciones (TEXT[] de texto libre). SIGUE siendo la
--      fuente de verdad de trg_recalcular_existencias (ver abajo) — NO
--      se tocó al agregar bodega_id.
--    bodega_id (migración 012) = enlace ADITIVO en paralelo a
--      'ubicacion', no un reemplazo: alimenta el rollup de existencias
--      por sucursal (GET /bodegas/existencias) sin arriesgar el trigger
--      existente, que sigue leyendo únicamente 'ubicacion'. Nullable:
--      movimientos históricos cuyo texto de ubicacion no matcheó
--      ninguna bodega en el backfill de la migración 012 se quedan sin
--      enlazar — no se les inventa una bodega.
--    proveedor_id (migración 010) = de qué proveedor vino ESTE lote —
--      puede ser distinto del proveedor por defecto del producto
--      (productos.proveedor_id), porque un mismo modelo a veces se
--      reabastece de más de un lugar. Opcional: no siempre hay factura
--      clara al momento de capturar.
--    costo_unitario / costo_total (migración 010) = cuánto costó este
--      lote, para poder ver gasto de restock por semana/ubicación/
--      proveedor. costo_total es GENERATED (cantidad × costo_unitario);
--      ambos opcionales por la misma razón que proveedor_id.
--
--    productos.existencias, productos.fecha_ingreso y
--    productos.ubicaciones son DERIVADOS de esta tabla (ver el trigger
--    más abajo) — la aplicación nunca los escribe directamente, solo
--    inserta/edita/borra movimientos.
-- ------------------------------------------------------------
CREATE TABLE movimientos_inventario (
    id             SERIAL PRIMARY KEY,
    producto_id    INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    cantidad       INTEGER NOT NULL CHECK (cantidad > 0),
    fecha          DATE NOT NULL DEFAULT CURRENT_DATE,
    ubicacion      VARCHAR(100),
    usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado_en      TIMESTAMP NOT NULL DEFAULT NOW(),
    proveedor_id   INTEGER REFERENCES proveedores(id),
    costo_unitario NUMERIC(10,2),
    costo_total    NUMERIC(10,2) GENERATED ALWAYS AS (cantidad * costo_unitario) STORED,
    bodega_id      INTEGER REFERENCES bodegas(id)
);

CREATE INDEX idx_movimientos_producto_id ON movimientos_inventario (producto_id);
CREATE INDEX idx_movimientos_fecha ON movimientos_inventario (fecha);

-- Trigger: mantiene productos.existencias, productos.fecha_ingreso y
-- productos.ubicaciones sincronizados con movimientos_inventario en
-- cualquier INSERT/UPDATE/DELETE.
--   existencias   = SUM(cantidad)
--   fecha_ingreso = MIN(fecha)
--   ubicaciones   = ubicaciones DISTINTAS (no nulas), ordenadas
-- Así una edición o un borrado en el historial siempre se refleja, no
-- solo las altas nuevas.
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
-- 12. TESTIMONIOS  (migración 013 — curación manual desde el panel)
--    Mismo patrón que productos.destacados: la familia decide qué se
--    muestra en el sitio público sin tocar código.
--    activo: permite cargar un testimonio sin publicarlo todavía.
--    orden: entero simple, controla el orden del carrusel público
--      (ascendente); sin restricción de unicidad.
--    Sin FKs: es contenido de marketing curado a mano, no un registro
--    transaccional ligado a una venta real.
-- ------------------------------------------------------------
CREATE TABLE testimonios (
    id        SERIAL PRIMARY KEY,
    texto     TEXT NOT NULL,
    autor     VARCHAR(150) NOT NULL,
    ciudad    VARCHAR(100),
    activo    BOOLEAN NOT NULL DEFAULT true,
    orden     INTEGER NOT NULL DEFAULT 0,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW()
);


-- ------------------------------------------------------------
-- SECUENCIA para folios digitales (notas creadas en el sistema)
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS notas_digital_seq START 1;


-- ------------------------------------------------------------
-- SEED de sucursales (migración 011)
-- San Pedro con los datos ya publicados en el sitio. CDMX queda con
-- placeholders y activo=false hasta que la familia complete sus
-- datos reales desde el panel (Sucursales.jsx) y la active.
-- ------------------------------------------------------------
INSERT INTO sucursales (nombre, razon_social, direccion, maps_url, whatsapp, ocultar_precio_publico, activo, es_principal, lat, lng) VALUES
  ('San Pedro Tultepec', 'Muebles Rubí',
   'C. Benito Juárez 73, C. Benito Juárez Manzana 033, 52030 San Pedro Tultepec, Lerma, Estado de México',
   NULL, '5217225723939', false, true, true, 19.2664, -99.5130),
  ('Ciudad de México', 'Muebles Local No.17',
   'PENDIENTE — completar desde el panel', NULL, NULL, true, false, false, NULL, NULL);


-- ------------------------------------------------------------
-- SEED de bodegas (migración 012)
-- Local Mexico -> CDMX. Local Jose / Local Amarillo / Almacen -> San Pedro.
-- Mapeo confirmado con la familia — ver comentario en la sección 10.
-- ------------------------------------------------------------
INSERT INTO bodegas (nombre, sucursal_id, activo)
SELECT 'Local Mexico', id, true FROM sucursales WHERE nombre = 'Ciudad de México'
UNION ALL
SELECT 'Local Jose', id, true FROM sucursales WHERE nombre = 'San Pedro Tultepec'
UNION ALL
SELECT 'Local Amarillo', id, true FROM sucursales WHERE nombre = 'San Pedro Tultepec'
UNION ALL
SELECT 'Almacen', id, true FROM sucursales WHERE nombre = 'San Pedro Tultepec';


-- ------------------------------------------------------------
-- SEED de testimonios (migración 013)
-- Migra el único testimonio que ya existía hardcodeado en el sitio, para
-- que no desaparezca nada al lanzar la curación desde el panel.
-- ------------------------------------------------------------
INSERT INTO testimonios (texto, autor, ciudad, activo, orden) VALUES
  ('El comedor que nos hicieron es la pieza central de nuestra casa. La calidad de la parota es increíble — y lo entregaron antes de lo prometido.',
   'Familia Hernández', 'Ciudad de México', true, 0);