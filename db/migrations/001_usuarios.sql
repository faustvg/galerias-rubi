-- ============================================================
--  GALERÍAS RUBÍ — Tabla de USUARIOS (autenticación del panel admin)
--  Se agrega al esquema existente. Es la base del login y los permisos.
--
--  REGLAS DE SEGURIDAD (no negociables):
--  - La contraseña NUNCA se guarda en texto plano. Se guarda un HASH
--    (un revoltijo de una sola dirección). Aunque alguien robe la
--    base de datos, no puede leer las contraseñas.
--  - El hashing lo hace una librería probada (passlib/bcrypt) en el
--    backend. NUNCA se programa el hashing a mano.
--  - Esta tabla la maneja solo el superadmin (crear/editar usuarios).
-- ============================================================


-- ------------------------------------------------------------
--  Roles posibles (de mayor a menor privilegio):
--    'superadmin' → Faust. Todo + gestión de usuarios.
--    'admin'      → hermanos. Todo lo operativo (catálogo, todas
--                   las notas, dashboards, finanzas). Sin gestión
--                   de usuarios.
--    'viewer'     → padres. Solo lectura de dashboards/resúmenes.
--                   No edita datos.
--    'worker'     → empleados. Crea productos/fotos. Maneja SOLO
--                   sus propias notas. NO ve ventas ni finanzas de
--                   otros ni el panorama general de dinero.
-- ------------------------------------------------------------
CREATE TABLE usuarios (
    id            SERIAL PRIMARY KEY,

    -- Con qué inicia sesión. UNIQUE = no puede haber dos iguales.
    username      VARCHAR(50) UNIQUE NOT NULL,

    -- Nombre real para mostrar en la interfaz (ej. "María", "Juan").
    nombre        VARCHAR(100) NOT NULL,

    -- El HASH de la contraseña (NO la contraseña). Largo porque
    -- los hashes de bcrypt ocupan ~60 caracteres; dejamos margen.
    password_hash VARCHAR(255) NOT NULL,

    -- El rol. CHECK restringe a solo estos cuatro valores: la base
    -- de datos RECHAZA cualquier otro rol. Integridad a nivel DB.
    rol           VARCHAR(20) NOT NULL DEFAULT 'worker'
                  CHECK (rol IN ('superadmin', 'admin', 'viewer', 'worker')),

    -- Permite desactivar a alguien sin borrarlo (ej. un empleado que
    -- se va). FALSE = no puede iniciar sesión, pero su historial de
    -- notas se conserva intacto.
    activo        BOOLEAN NOT NULL DEFAULT true,

    -- Cuándo se creó la cuenta. Útil para auditoría.
    creado_en     TIMESTAMP NOT NULL DEFAULT NOW()
);


-- ------------------------------------------------------------
--  CONEXIÓN CON LAS NOTAS (clave para el aislamiento por usuario)
--
--  Para que un WORKER vea SOLO sus propias notas, cada nota debe
--  "pertenecer" al usuario que la creó. Agregamos una columna a la
--  tabla NOTAS que la enlaza con USUARIOS.
--
--  - usuario_id NULLABLE: las notas viejas (históricas, en papel)
--    no tienen un usuario del sistema asignado. NULL = "sin dueño
--    registrado". Las notas nuevas SÍ llevarán el id de quien las creó.
--  - ON DELETE SET NULL: si se borrara un usuario, sus notas NO se
--    borran (son registros financieros), solo pierden el enlace.
--    (En la práctica usamos 'activo=false' en vez de borrar.)
--
--  El backend filtra: si el rol es 'worker', solo consulta las notas
--  WHERE usuario_id = (el id del worker logueado). Admin/superadmin
--  ven todas. Este filtrado vive en el código de la API, sobre esta
--  columna.
-- ------------------------------------------------------------
ALTER TABLE notas
    ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;


-- ------------------------------------------------------------
--  NOTA sobre el campo 'vendedor' que ya existe en NOTAS:
--  'vendedor' es texto libre (el nombre escrito en la nota de papel).
--  'usuario_id' es el enlace estructurado al usuario del sistema.
--  Coexisten: 'vendedor' es el dato histórico/textual; 'usuario_id'
--  es para los permisos y el filtrado. No se contradicen.
-- ------------------------------------------------------------