# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Actualizado:** 2026-08-09, tras la regla de "ocultar precio para productos
disponibles en CDMX" y la remoción de la etiqueta "SUCURSAL CDMX" del
catálogo. Si trabajaste en este repo antes de esa fecha, revisa las
secciones marcadas ⚠️ — cambiaron.

## Project overview

**Muebles Rubí** es un negocio familiar de muebles (San Pedro Tultepec,
Estado de México) con presencia digital: un sitio público estático
(`web-publico/`) y un panel de administración React (`admin/`), ambos
respaldados por una API FastAPI (`api/`) y PostgreSQL (dev local en Windows,
producción en un VPS de Hetzner con Ubuntu 24.04). Desde 2026 el negocio
opera **dos sucursales legalmente distintas**: San Pedro Tultepec (Muebles
Rubí, entidad principal) y Ciudad de México (Muebles Local No.17) — mismo
catálogo compartido en su mayoría, con un subconjunto de productos también
disponible en CDMX a precio propio.

El sitio público obtiene el catálogo en vivo desde el backend (`GET
/publico/productos`, `/publico/categorias`, `/publico/sucursales`,
`/publico/testimonios`) — no hay archivo JSON intermedio ni paso de
publicación manual.

`admin/` es un panel React (Vite) completo y en uso activo — no es un
placeholder futuro. CRUD de notas, productos, categorías, proveedores,
usuarios, sucursales, testimonios, más un dashboard con Recharts.

## Commands

### Python environment (run from `api/`)

```bash
venv\Scripts\activate          # Windows, entorno local
pip install -r api/requirements.txt
uvicorn api.main:app --reload
```

### Database (psql)

```bash
psql -U <user> -d <dbname> -f db/schema.sql    # inicializar una base nueva desde cero
```

Para bases existentes, aplicar migraciones individuales de `db/migrations/`
en orden (001–014) — nunca reaplicar `schema.sql` sobre una base con datos.

### Environment variables

Crear `api/.env` (nunca commitear):

```
DB_HOST=
DB_PORT=
DB_NAME=
DB_USER=
DB_PASSWORD=
SECRET_KEY=        # generar con: python -c "import secrets; print(secrets.token_hex(32))"

# Opcional — habilita el botón "enviar nota por email" en el panel admin.
# SMTP_USER/SMTP_PASSWORD son de una cuenta Gmail (mueblesrubimx@gmail.com).
# SMTP_PASSWORD debe ser un "App Password" de 16 caracteres (Google Account →
# Security → 2-Step Verification → App Passwords), NO la contraseña normal
# de la cuenta — Gmail rechaza contraseñas de login normales por SMTP.
# Puerto 587 + STARTTLS, no 465 + TLS implícito: varios proveedores de VPS
# (incluido Hetzner) bloquean el puerto 465 saliente por defecto (anti-spam).
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
NOTA_EMAIL_DESTINO=mueblesrubimx@gmail.com
```

### Create an admin user

```bash
python api/crear_usuario.py
# pide username, nombre completo, rol y password (input oculto)
# roles: superadmin / admin / viewer / worker
```

## ⚠️ Antes de un deploy público (ya aplicado en producción, dejar como referencia)

```python
# SessionMiddleware
https_only=True,

# CORSMiddleware
allow_origins=["https://mueblesrubimx.com"],
```

Publicar con `https_only=False` deja la cookie de sesión viajar sin cifrar
por HTTP. Publicar con `allow_origins=["*"]` deja que cualquier sitio haga
requests con credenciales contra la API de admin.

---

## Architecture

### Data flow

```
PostgreSQL DB  →  FastAPI (GET /publico/productos, /publico/categorias, ...)  →  index.html / producto.html (fetch en vivo)
                                                                              →  admin/ (React, autenticado)
```

El sitio estático obtiene el catálogo en vivo desde la API al cargar la
página — no hay archivo JSON intermedio ni paso de publicación manual. El
workflow de GitHub Actions (`.github/workflows/deploy-pages.yml`) despliega
`web-publico/` a GitHub Pages automáticamente en cada push a `main` que
toque esa carpeta — **verificado** (el archivo existe en el repo desde el
commit `fad00ad`, 2026-06-19). `api/` y `admin/` se despliegan aparte, a
mano, vía SSH al VPS (no hay pipeline automático para esos dos).

### Folder layout

```
galerias-rubi/
├── web-publico/     ← sitio estático, sin build step → GitHub Pages (deploy automático)
├── api/             ← FastAPI backend → VPS (deploy manual)
├── admin/           ← React (Vite) admin panel → VPS (deploy manual, build local)
├── db/              ← schema.sql (snapshot) + migrations/ (histórico, fuente de verdad real)
├── docs/            ← diagramas y notas internas
├── .github/
│   └── workflows/
│       └── deploy-pages.yml
├── .gitignore
├── CLAUDE.md
└── README.md
```

### Database schema

`schema.sql` es un snapshot completo; `db/migrations/` es la fuente de
verdad histórica cuando difieran. Migraciones aplicadas hasta la fecha:
001–014.

Tablas principales:

| Tabla | Propósito |
|---|---|
| `categorias` | Categorías; `descuento_pct` aplica a todos sus productos |
| `proveedores` | Proveedores, ligados por producto |
| `productos` | Catálogo maestro. `fotos TEXT[]` (primera = imagen principal). `visible_en_sitio` filtra la API pública. `descuento_pct` a nivel producto pisa al de categoría; `NULL` = hereda. `ubicaciones TEXT[]` es bodega/logística interna, derivado por trigger — NO confundir con sucursal |
| `usuarios` | Login del panel; también hace de "vendedores" (`rol`: superadmin/admin/viewer/worker). `sucursal_id` = asignación ACTUAL, editable, no histórica |
| `sucursales` | 2 filas: San Pedro Tultepec (`es_principal=true`) y Ciudad de México (`es_principal=false`). Columnas: `direccion`, `maps_url`, `whatsapp`, `ocultar_precio_publico`, `activo`, `lat`/`lng` (nullable, migración 014) |
| `producto_sucursal` | Solo tiene fila cuando un producto TAMBIÉN se vende en CDMX — `producto_id, sucursal_id, precio`. San Pedro usa `productos.precio_base` directo, sin fila aquí |
| `bodegas` | Catálogo de ubicaciones físicas de inventario, cada una ligada a una `sucursal_id`. NO es lo mismo que `sucursales` — bodega es logística interna, sucursal es entidad de venta |
| `notas` | Pedido/cotización. Datos de cliente **desnormalizados** (`nombre_cliente`, `telefono`) — no hay tabla de clientes separada. `folio` es texto (PK, ticket de papel, ej. `'0986'`). `resta` es columna generada (`total - anticipo`). `sucursal_id` se congela al crear la nota (copiado del vendedor en ese momento) — NO se recalcula si el vendedor cambia de sucursal después |
| `partidas` | Líneas de una nota (bridge many-to-many `notas`↔`productos`). `importe` es generado (`cantidad * precio_unitario`). `producto_id` nullable para ítems sueltos fuera de catálogo. Cascada de borrado desde `notas` |
| `pagos` | Abonos contra una nota |
| `movimientos_inventario` | Historial de entradas de stock; trigger `trg_recalcular_existencias` deriva `productos.existencias`/`fecha_ingreso`/`ubicaciones`. `bodega_id` es columna aditiva en paralelo, no reemplaza `ubicacion` (texto libre) |
| `testimonios` | Curados a mano desde el panel (`Testimonios.jsx`) — `texto, autor, ciudad, activo, orden` |

**Importante — "sucursal" ≠ "ubicación"/bodega.** Son conceptos
deliberadamente separados; `sucursal_id` nunca debe confundirse con
`ubicacion`/`bodega_id`.

### ⚠️ Regla de precio para productos disponibles en CDMX (decisión de los dueños, agosto 2026)

Para cualquier producto con `disponible_cdmx = true`: **no se muestra ningún
precio públicamente, ni el de San Pedro tampoco.** Implementado en
`_fila_a_producto()` en `routers/publico.py` — si `disponible_cdmx`, los
campos `precio_efectivo`, `precio_base`, `precio_cdmx` regresan `null` y
`descuento_pct` se fuerza a `0`, sin importar el valor de
`sucursales.ocultar_precio_publico`. Esta regla es adicional al toggle
existente, no lo reemplaza. En `producto.html`, ambas filas de la "ficha de
sucursales" muestran un CTA de WhatsApp ("Contáctanos para el precio") en
vez de un número. Los productos solo-San-Pedro no se ven afectados.

Esta lógica vive **solo** en `routers/publico.py` — confirmado que no
contamina los endpoints del panel admin (`GET /productos` en `main.py` y
`GET /admin/productos` en `catalogo.py` usan serializadores distintos, sin
relación con `_fila_a_producto()`).

Ya NO se muestra ninguna etiqueta "SUCURSAL CDMX"/"TAMBIÉN EN CDMX" en las
tarjetas del catálogo o destacados de `index.html` — se removió (2026-08-09)
para no llamar la atención sobre la distinción de sucursal fuera de la
ficha del producto. `badgeCdmx()` y la clase CSS `.badge-cdmx` ya no
existen en `index.html`.

### API layout

```
api/
├── main.py              ← app, middleware, auth, + GET /api/categorias|/api/proveedores|/api/productos|/api/productos/{id}
│                            (sin auth, usados por admin/ para dropdowns — NO por el sitio público,
│                            que usa routers/publico.py. No son código muerto, no los borres.)
├── database.py          ← pool + get_db dependency
├── auth.py              ← pwd_context, UsuarioActual, get_usuario_actual, requiere_roles
├── routers/
│   ├── catalogo.py      ← productos CRUD (incl. disponible_cdmx/precio_cdmx → upsert en producto_sucursal) + movimientos de inventario
│   ├── dashboard.py     ← reporting/KPIs, incluye desglose "por_sucursal" (visible a todos los roles, no oculto como "por vendedor")
│   ├── fotos.py         ← endpoints de subida de fotos
│   ├── notas.py         ← notas (pedidos/cotizaciones) + pagos. ⚠️ query compartida _SQL_DETALLE con índices posicionales hardcodeados, ver Pendientes
│   ├── publico.py       ← GETs sin auth para web-publico/: productos, categorías, sucursales, testimonios (oculta costo/existencias)
│   ├── sucursales.py    ← GET/PUT (sin POST/DELETE — 2 sucursales fijas, sembradas por migración)
│   ├── testimonios.py   ← CRUD completo, admin/superadmin
│   └── usuarios.py      ← CRUD usuarios/vendedores (superadmin only, excepto /usuarios/vendedores)
└── crear_usuario.py     ← script CLI standalone para el primer admin (no es una ruta HTTP)
```

### Authentication

Sesión por cookie firmada con HttpOnly. Sin JWT.

| Concern | Decisión |
|---|---|
| Password hashing | `passlib[bcrypt]`, fijado `bcrypt<4.0` (passlib incompatible con bcrypt 4.x) |
| Session storage | Cookie firmada vía `itsdangerous` (HMAC-SHA256), 8h max age |
| Cookie flags | `HttpOnly` (JS no puede leerla) + `SameSite=Lax` (bloquea POST/PUT/DELETE cross-site) |
| CSRF | SameSite=Lax + CORS bloqueado a un dominio es suficiente; sin tokens CSRF explícitos |
| Timing attacks | `dummy_verify()` cuando el username no existe — mismo tiempo de respuesta que un usuario válido |
| Username enumeration | Mismo `401` para username incorrecto que para password incorrecto |

**Flow:**
1. `POST /login` — verifica hash bcrypt, checa `activo=true`, escribe `user_id` en la cookie firmada.
2. Rutas protegidas usan `Depends(get_usuario_actual)` — lee la cookie, consulta la DB, regresa `UsuarioActual` o lanza 401.
3. `Depends(requiere_roles("superadmin", "admin"))` — se apila sobre `get_usuario_actual`, lanza 403 si el rol no está en la lista.
4. `POST /logout` — limpia la sesión.

### Catalog write endpoints (`api/routers/catalogo.py`)

Todos los endpoints de escritura requieren rol `superadmin`, `admin` o
`worker`. Los `viewer` no pueden escribir.

| Method | Path | Acción |
|---|---|---|
| POST | `/categorias` | Crear categoría |
| PUT | `/categorias/{id}` | Actualización parcial (solo campos enviados) |
| POST | `/proveedores` | Crear proveedor |
| PUT | `/proveedores/{id}` | Actualización parcial |
| POST | `/productos` | Crear producto |
| PUT | `/productos/{id}` | Actualización parcial (stock, visibilidad, precio, etc.) |
| DELETE | `/productos/{id}` | Soft-delete: pone `visible_en_sitio=false`, la fila se conserva por el historial de notas |

### Frontend (`web-publico/`)

Dos archivos autocontenidos, sin build step: `index.html` y `producto.html`.
CSS y JS inline en cada uno — al editar algo compartido entre ambos (header,
footer, WhatsApp), recuerda tocar los dos archivos, no hay plantilla
compartida.

- **Catálogo**: fetch en vivo desde `GET /publico/productos` /
  `/publico/categorias` (ver `API_BASE` cerca del final de cada archivo),
  con paginación incremental ("Ver más piezas", 8 a la vez) y tabs de
  categoría vía `?categoria=ID` (replaceState).
- **Filtro CDMX**: pill adicional "Ver solo CDMX" en Colección, combinable
  (AND) con el filtro de categoría vía `?sucursal=cdmx`, mismo patrón de URL
  que categoría.
- **Destacados**: carrusel horizontal (scroll-snap), no grid — flechas solo
  en desktop.
- **WhatsApp**: número cargado dinámicamente desde `GET /publico/sucursales`
  al cargar la página (`aplicarSucursales()` en ambos archivos) — ya no es
  una constante fija. `waPrincipal` (la sucursal con `es_principal=true`)
  alimenta la burbuja flotante, el botón del footer y los CTAs genéricos; los
  hrefs `wa.me/...` ya escritos en el HTML son solo respaldo si falla el
  fetch.
- **Multi-sucursal (migración 011)**: la tabla `sucursales` tiene
  exactamente 2 filas (San Pedro = `es_principal=true`, CDMX =
  `es_principal=false`). Backend y frontend identifican "la otra sucursal"
  siempre vía `es_principal`, nunca comparando `nombre` (editable desde
  `Sucursales.jsx`). Esto asume exactamente 2 sucursales — ver el comentario
  al inicio de `db/migrations/011_sucursales.sql` para lo que implicaría una
  tercera.
- **Ficha de sucursales** (`producto.html`): reemplaza el precio simple
  cuando `disponible_cdmx=true`. Formato de lista con pin + nombre +
  precio-o-CTA (ver regla de precio arriba). Incluye botón opcional "Usar mi
  ubicación" (geolocalización — solo dispara al hacer clic, nunca
  automático; calcula distancia Haversine contra `sucursales.lat/lng`;
  recuerda la elección en `localStorage` bajo `mr_sucursal_preferida`; falla
  en silencio si se rechaza el permiso).
- **Instagram**: widget de Elfsight embebido (script + div), reemplazó el
  placeholder "Próximamente".
- **Testimonios**: carrusel dinámico desde `/publico/testimonios`, oculta la
  sección completa si no hay ninguno activo, flechas solo con 2+.
- **Secciones:** `#inicio` (hero) → `#destacados` → `#nosotros` →
  `#coleccion` (grid filtrable) → `#amedida` (pasos del proceso) →
  `#instagram` → `#testimonios` → `#contacto` (form + info).
- **Motion**: sistema de scroll-reveal (IntersectionObserver), respeta
  `prefers-reduced-motion` en todo el sitio.
- El envío del formulario de contacto y los clics en las tarjetas abren una
  URL de WhatsApp pre-llenada — no hay handler de backend para el form.
- **Gotcha de assets**: `logo.png` es el archivo correcto y limpio.
  `logo_transparente.png` (en `assets/`, ya no referenciado en ningún HTML)
  tiene un defecto real — nunca volver a usarlo ni enlazarlo.

## Pendientes técnicos

Identificados durante la implementación de multi-sucursal (migración 011),
deliberadamente dejados fuera de esa entrega para no mezclar una feature con
un refactor de convención de todo el backend:

1. **Migrar de indexado posicional (`row[0]`, `row[13]`...) a acceso por
   nombre de columna** en los routers de `api/`. El patrón actual rompió en
   silencio cuando se insertó `sucursal_id` a la mitad de `_SQL_DETALLE` en
   `notas.py` — todas las columnas posteriores se recorrieron un índice, y
   `_verificar_acceso()` habría comparado el campo equivocado sin lanzar
   ningún error visible. Empezar por `notas.py` (mayor riesgo: una sola
   query compartida por 3 endpoints con índices hardcodeados en cada uno)
   usando `row_factory=dict_row` de psycopg3 — no requiere librerías nuevas,
   es un cambio de una línea por cursor. Extender al resto de `catalogo.py`,
   `publico.py`, `usuarios.py`, `dashboard.py` después, archivo por archivo,
   verificando cada endpoint contra `/docs` antes de seguir con el
   siguiente.
2. **Agregar `Depends(get_usuario_actual)` a los 4 endpoints sin
   autenticación en `api/main.py`**: `GET /api/productos`,
   `/api/productos/{id}`, `/api/categorias`, `/api/proveedores`. Hoy solo
   dependen de `Depends(database.get_db)` — son alcanzables sin sesión ni
   login, aunque el consumidor real es el panel admin (`Categorias.jsx`,
   `Proveedores.jsx`, `ProductoModal.jsx`, `NotaFormulario.jsx`). No exponen
   `costo`/`existencias`/`disponible_cdmx`/`precio_cdmx` (usan un modelo
   `Producto` más viejo que nunca hace join a `producto_sucursal`), así que
   no hay fuga de precio de sucursal — pero siguen siendo superficie pública
   innecesaria que debería vivir detrás de sesión igual que el resto de
   `/api`.
3. Si se agrega una tercera sucursal algún día: refactorizar el patrón
   `es_principal` (asume exactamente 2) a un modelo genérico de N
   sucursales — afecta `publico.py`, el JS de `web-publico/`, y
   probablemente el diseño de la "ficha de sucursales".
