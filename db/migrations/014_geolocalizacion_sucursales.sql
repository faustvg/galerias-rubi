-- ============================================================
--  Migración 014 — coordenadas de sucursales (geolocalización)
--
--  CONTEXTO: el sitio público quiere poder sugerir la sucursal más
--  cercana al cliente (San Pedro Tultepec vs Ciudad de México) cuando
--  el usuario decide compartir su ubicación — nunca automático, solo si
--  hace clic en "Usar mi ubicación" en la ficha de sucursales de
--  producto.html.
--
--  lat/lng nullable a propósito: CDMX queda en NULL hasta que se le
--  asignen coordenadas reales al activarla — el frontend simplemente no
--  la incluye en el cálculo de distancia mientras no tenga coordenadas
--  (no se inventa una ubicación).
--
--  Precisión: 19.2664/-99.5130 para San Pedro Tultepec es precisión de
--  pueblo (fuente INEGI), suficiente para comparar contra CDMX (~44 km
--  de distancia) — no hace falta la coordenada exacta de la calle para
--  decidir "cuál sucursal está más cerca de ti" a esa escala.
-- ============================================================

ALTER TABLE sucursales ADD COLUMN lat NUMERIC(10,7);
ALTER TABLE sucursales ADD COLUMN lng NUMERIC(10,7);

UPDATE sucursales SET lat = 19.2664, lng = -99.5130 WHERE nombre = 'San Pedro Tultepec';
-- CDMX queda en NULL hasta que se le asignen coordenadas reales al activarla
