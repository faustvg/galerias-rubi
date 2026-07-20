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
--    1. categorias  2. proveedores  3. productos
--    4. usuarios    5. notas        6. partidas    7. pagos
--    8. movimientos_inventario
--  Las tablas "padre" se crean antes que las que las referencian.
--  (usuarios va ANTES de notas porque notas referencia a usuarios.)
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
--      una pieza a medida puede no tener proveedor.
--    fecha_ingreso (NUEVO, migración 006) = cuándo entra la pieza al
--      catálogo, para ver altas de inventario a lo largo del tiempo.
--      DEFAULT CURRENT_DATE aquí porque este archivo es la foto para
--      una base NUEVA (sin filas viejas que falsear); en producción,
--      la migración 006 la agrega SIN default primero para no
--      backfillear piezas viejas con la fecha de hoy.
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
-- 4. USUARIOS  (cuentas del panel admin — autenticación y permisos)
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
-- ------------------------------------------------------------
CREATE TABLE usuarios (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(50) UNIQUE NOT NULL,
    nombre        VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    rol           VARCHAR(20) NOT NULL DEFAULT 'worker'
                  CHECK (rol IN ('superadmin', 'admin', 'viewer', 'worker')),
    activo        BOOLEAN NOT NULL DEFAULT true,
    creado_en     TIMESTAMP NOT NULL DEFAULT NOW()
);


-- ------------------------------------------------------------
-- 5. NOTAS  (encabezado de la transacción: cotización/pedido/venta)
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
    foto_nota        TEXT
);


-- ------------------------------------------------------------
-- 6. PARTIDAS  (una línea por producto con su propio precio)
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
-- 7. PAGOS  (migración 007 — cómo se cobró cada nota)
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
-- 8. MOVIMIENTOS_INVENTARIO  (migración 008 — historial de entradas)
--    A diferencia de productos.fecha_ingreso (solo la PRIMERA vez que
--    el modelo entra al catálogo), esta tabla registra CADA llegada
--    por separado, con su propia fecha, cantidad y ubicación.
--    productos.existencias sigue siendo el conteo actual (se
--    incrementa con cada movimiento nuevo); esta tabla es el desglose
--    de cómo se llegó a ese número — mismo patrón que PAGOS es el
--    desglose de cómo se cobró una nota.
--
--    producto_id -> productos(id) ON DELETE CASCADE: un movimiento no
--      existe sin su producto.
--    usuario_id -> usuarios(id) ON DELETE SET NULL: quién lo registró,
--      opcional, se conserva si se borra el usuario.
--    ubicacion es VARCHAR libre, no FK: coincide con el estilo de
--      productos.ubicaciones (TEXT[] de texto libre).
-- ------------------------------------------------------------
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


-- ------------------------------------------------------------
-- SECUENCIA para folios digitales (notas creadas en el sistema)
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS notas_digital_seq START 1;