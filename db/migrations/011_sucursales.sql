-- ============================================================
--  Migración 011 — sucursales
--
--  CONTEXTO: el negocio agrega una segunda ubicación de venta,
--  Muebles Local No.17 en CDMX (entidad legal distinta de Muebles
--  Rubí / San Pedro Tultepec, aunque mismo taller/familia). CDMX
--  vende solo un subconjunto del catálogo, con precio propio por
--  transporte/renta, y la familia quiere poder ocultar el precio
--  de CDMX en el sitio público (mostrar WhatsApp en su lugar) sin
--  tocar producto por producto.
--
--  OJO — 'sucursal' NO es lo mismo que 'ubicacion':
--  productos.ubicaciones (migración 003, ahora derivado por trigger
--  en la 010) es bodega/logística interna ("Local Mexico", "Almacen",
--  etc.), no sucursal de venta. Son conceptos distintos a propósito;
--  por eso esta migración usa 'sucursal_id', nunca 'ubicacion_id'.
--
--  DISEÑO:
--   - sucursales: catálogo cerrado de las 2 ubicaciones de venta.
--     'ocultar_precio_publico' es la decisión a nivel de sucursal
--     completa (no por producto) de mostrar precio o CTA de WhatsApp.
--   - usuarios.sucursal_id: a qué sucursal está asignado hoy un
--     vendedor. Se puede reubicar sin afectar notas pasadas (ver
--     siguiente punto) — mismo patrón que vendedor_id/vendedor en la
--     migración 005 (enlace estructurado, resuelto en tiempo real).
--   - notas.sucursal_id: la sucursal de LA VENTA, congelada al crear
--     la nota (se copia del sucursal_id del vendedor en ese momento).
--     Si el vendedor se reubica después, las notas viejas NO cambian
--     — mismo principio de "no reescribir historia" que fecha_ingreso
--     y que vendedor_id resuelve para el nombre del vendedor.
--   - producto_sucursal: solo tiene fila cuando un producto TAMBIÉN
--     se vende en una sucursal distinta de San Pedro, con su propio
--     precio. San Pedro sigue usando productos.precio_base tal cual
--     — cero backfill, cero riesgo sobre el catálogo existente.
--
--  BACKFILL: ninguno para notas.sucursal_id — no hay forma confiable
--  de saber a qué sucursal pertenece cada nota histórica, y no es
--  decisión de esta migración inventarlo. Quedan en NULL; la familia
--  decide si vale la pena reclasificarlas a mano desde el panel.
--
--  es_principal: identifica a San Pedro de forma ESTABLE, sin depender
--  del texto de 'nombre' (que sí es editable desde Sucursales.jsx). El
--  backend usa esta columna — nunca nombre = 'Ciudad de México' — para
--  decidir cuál sucursal alimenta los CTAs genéricos del sitio (burbuja
--  de WhatsApp, botón del footer) y cuál es "la otra" para
--  disponible_cdmx/precio_cdmx. Por diseño NO se expone como campo
--  editable en la API/UI todavía (ver SucursalUpdate en sucursales.py) —
--  solo se fija aquí, por seed/migración, para que nunca queden 0 o 2+
--  sucursales marcadas como principal por accidente desde el panel.
--
--  ⚠️ Este enfoque de "principal vs. la otra" asume EXACTAMENTE 2
--  sucursales. Si algún día se agrega una tercera, todo lo que hoy
--  asume "la sucursal con es_principal=false es CDMX" (publico.py,
--  catalogo.py, web-publico/*.html) necesita un refactor real a un
--  modelo genérico de N sucursales — no alcanza con este booleano.
-- ============================================================

CREATE TABLE sucursales (
    id                     SERIAL PRIMARY KEY,
    nombre                 VARCHAR(100) NOT NULL,      -- "San Pedro Tultepec", "Ciudad de México"
    razon_social           VARCHAR(150) NOT NULL,       -- "Muebles Rubí", "Muebles Local No.17"
    direccion              TEXT,
    maps_url               TEXT,
    whatsapp               VARCHAR(20),
    ocultar_precio_publico BOOLEAN NOT NULL DEFAULT false,
    activo                 BOOLEAN NOT NULL DEFAULT true,
    es_principal           BOOLEAN NOT NULL DEFAULT false
);

-- Seed con lo que ya está publicado hoy en el sitio para San Pedro.
-- CDMX queda con datos placeholder y activo=false hasta que la
-- familia complete dirección/maps real y la active desde el panel
-- (Sucursales.jsx) — no es esta migración quien debe inventarlos.
INSERT INTO sucursales (nombre, razon_social, direccion, maps_url, whatsapp, ocultar_precio_publico, activo, es_principal) VALUES
  ('San Pedro Tultepec', 'Muebles Rubí',
   'C. Benito Juárez 73, C. Benito Juárez Manzana 033, 52030 San Pedro Tultepec, Lerma, Estado de México',
   NULL, '5217225723939', false, true, true),
  ('Ciudad de México', 'Muebles Local No.17',
   'PENDIENTE — completar desde el panel', NULL, NULL, true, false, false);

ALTER TABLE usuarios
    ADD COLUMN sucursal_id INTEGER REFERENCES sucursales(id) ON DELETE SET NULL;

ALTER TABLE notas
    ADD COLUMN sucursal_id INTEGER REFERENCES sucursales(id) ON DELETE SET NULL;

CREATE TABLE producto_sucursal (
    producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    sucursal_id INTEGER NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
    precio      NUMERIC(10,2) NOT NULL,
    PRIMARY KEY (producto_id, sucursal_id)
);
