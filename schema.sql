-- ============================================================
--  GALERÍAS RUBÍ — Esquema de base de datos
--  Stack: PostgreSQL (local en Windows ahora; luego VPS Hetzner Ubuntu 24.04)
--
--  Orden de creación = orden de dependencias:
--    1. categorias  2. proveedores  3. productos  4. notas  5. partidas
--  Las tablas "padre" se crean antes que las que las referencian.
--
--  Para cargar este archivo en psql:
--    \i 'D:/Faus_/muebles_rubi/schema.sql'
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
    descuento_pct    NUMERIC(5,2)
);


-- ------------------------------------------------------------
-- 4. NOTAS  (encabezado de la transacción: cotización/pedido/venta)
--    folio = número del talonario de papel (ej. '0986'). Es TEXTO,
--      no entero, para conservar ceros a la izquierda.
--    Cliente APLANADO aquí (nombre_cliente, telefono) — sin tabla
--      CLIENTES, porque los clientes rara vez regresan. Reversible.
--    resta = columna GENERADA (total - anticipo): se calcula sola,
--      no se puede escribir, nunca se desincroniza.
--    consideraciones = notas de TODA la nota (ej. "entrega sábado").
--    estatus: 'Presupuesto' / 'En proceso' / 'Entregado'.
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
    consideraciones  TEXT
);


-- ------------------------------------------------------------
-- 5. PARTIDAS  (una línea por producto con su propio precio)
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