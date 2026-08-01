# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**Muebles Rubí** is a static landing page for a Mexican furniture craftsman, served via GitHub Pages. A PostgreSQL database (local dev on Windows, production on a Hetzner VPS running Ubuntu 24.04) stores the product catalog and order records. The static site fetches the catalog live from the FastAPI backend (`GET /publico/productos`, `/publico/categorias`) — there is no static JSON bridge file.

An `admin/` React (Vite) frontend already exists and is in active use (not just a future placeholder) — CRUD for notas, productos, categorías, proveedores, usuarios, plus a Recharts dashboard.

## Commands

### Python environment (run from `api/`)

```bash
# Activate virtual environment (Windows)
venv\Scripts\activate

# Install dependencies
pip install -r api/requirements.txt

# Run the API
uvicorn api.main:app --reload
```

### Database (psql)

```bash
# Load the schema (run once to initialize)
psql -U <user> -d <dbname> -f db/schema.sql
```

### Environment variables

Create `api/.env` (never commit it):

```
DB_HOST=
DB_PORT=
DB_NAME=
DB_USER=
DB_PASSWORD=
SECRET_KEY=        # generate with: python -c "import secrets; print(secrets.token_hex(32))"

# Optional — enables the "send nota by email" button in the admin panel.
# SMTP_USER/SMTP_PASSWORD are for a Gmail account (mueblesrubimx@gmail.com).
# SMTP_PASSWORD must be a 16-char Gmail "App Password" (Google Account →
# Security → 2-Step Verification → App Passwords), NOT the account's login
# password — Gmail's SMTP rejects plain login passwords.
# Port 587 + STARTTLS, not 465 + implicit TLS: several VPS providers
# (including Hetzner) block outbound port 465 by default (anti-spam).
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
NOTA_EMAIL_DESTINO=mueblesrubimx@gmail.com
```

### Create an admin user

```bash
python api/crear_usuario.py
# prompts for username, full name, role, and password (hidden input)
# roles: superadmin / admin / viewer / worker
```

## ⚠️ Before public deploy (VPS with real domain)

Two changes **must** be made in `api/main.py` before going to production:

```python
# 1. SessionMiddleware — enable the Secure flag so the cookie only travels over HTTPS
app.add_middleware(
    SessionMiddleware,
    ...
    https_only=True,   # ← change False → True
)

# 2. CORSMiddleware — lock to your actual domain; never ship allow_origins=["*"] with credentials
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://tu-dominio.com"],   # ← replace wildcard with real domain
    allow_credentials=True,
    ...
)
```

Shipping with `https_only=False` means the session cookie can be sent over plain HTTP and intercepted. Shipping with `allow_origins=["*"]` means any website can make credentialed requests to your admin API.

---

## Architecture

### Data flow

```
PostgreSQL DB  →  FastAPI (GET /publico/productos, /publico/categorias)  →  index.html / producto.html (live fetch)
```

The static site fetches the catalog live from the API on page load — there is no static JSON bridge file or manual publish step. The GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) deploys `web-publico/` to GitHub Pages automatically on every push to `main` that touches that folder; the API itself is deployed separately to the VPS.

### Folder layout

```
galerias-rubi/
├── web-publico/     ← static site → GitHub Pages
├── api/             ← FastAPI backend → VPS
├── admin/           ← React (Vite) admin panel → VPS
├── db/              ← schema.sql (source of truth)
├── docs/            ← diagrams and internal docs
├── .github/
│   └── workflows/
│       └── deploy-pages.yml
├── .gitignore
├── CLAUDE.md
└── README.md
```

### Database schema (`schema.sql`)

Five tables in dependency order:

| Table | Purpose |
|---|---|
| `categorias` | Product categories; `descuento_pct` applies to all products in the category |
| `proveedores` | Supplier names, linked per product |
| `productos` | Master catalog. `fotos TEXT[]` stores URL/path array (first = main image). `visible_en_sitio` gates what the public API exposes. Product-level `descuento_pct` overrides category-level; `NULL` means inherit. |
| `notas` | Order header (quote/order/delivered). Client data is **denormalized** here (`nombre_cliente`, `telefono`) — no separate clients table. `folio` is a text primary key (paper receipt number, e.g. `'0986'`). `resta` is a generated column (`total - anticipo`). |
| `partidas` | Order line items (many-to-many bridge between `notas` and `productos`). `importe` is generated (`cantidad * precio_unitario`). `producto_id` is nullable to allow one-off items not in the catalog. Cascades delete from `notas`. |

> **Note:** `relational_diagramm.md` shows an older draft with a separate `CLIENTES` table. The authoritative schema is `schema.sql`. The table list above is not exhaustive — `schema.sql` also has `usuarios`, `pagos`, and `movimientos_inventario` (with a trigger that derives `productos.existencias`/`fecha_ingreso`/`ubicaciones`). Treat `schema.sql` + `db/migrations/` as the source of truth over this doc for schema details.

### API layout

```
api/
├── main.py              ← app, middleware, auth endpoints, internal catalog GETs used by admin/
├── database.py          ← pool + get_db dependency
├── auth.py              ← pwd_context, UsuarioActual, get_usuario_actual, requiere_roles
├── routers/
│   ├── catalogo.py      ← catalog write endpoints (POST/PUT/DELETE) + inventory movements
│   ├── dashboard.py     ← reporting/KPI endpoints for admin/
│   ├── fotos.py         ← photo upload endpoints
│   ├── notas.py         ← notas (orders/quotes) + pagos
│   ├── publico.py       ← unauthenticated GETs consumed by web-publico/ (hides costo/existencias)
│   └── usuarios.py      ← usuarios/vendedores CRUD (superadmin only, except /usuarios/vendedores)
└── crear_usuario.py     ← standalone CLI script to bootstrap the first admin user (not an HTTP route)
```

Note: `main.py` still defines its own `GET /categorias`, `/proveedores`, `/productos`, `/productos/{id}` — these are unauthenticated but are used internally by `admin/` for dropdown/picker data, not by the public site (which uses `routers/publico.py` instead). Don't assume they're dead code.

### Authentication

Session-based auth with HttpOnly cookies. No JWT.

| Concern | Decision |
|---|---|
| Password hashing | `passlib[bcrypt]`, pinned `bcrypt<4.0` (passlib incompatible with bcrypt 4.x) |
| Session storage | Signed cookie via `itsdangerous` (HMAC-SHA256), 8h max age |
| Cookie flags | `HttpOnly` (JS can't read) + `SameSite=Lax` (blocks cross-site POST/PUT/DELETE) |
| CSRF | SameSite=Lax + locked CORS domain is sufficient; no CSRF tokens needed |
| Timing attacks | `dummy_verify()` when username not found — same response time as valid user |
| Username enumeration | Same `401` for wrong username and wrong password |

**Flow:**
1. `POST /login` — verifies bcrypt hash, checks `activo=true`, writes `user_id` into signed cookie.
2. Protected routes use `Depends(get_usuario_actual)` — reads cookie, queries DB, returns `UsuarioActual` or raises 401.
3. `Depends(requiere_roles("superadmin", "admin"))` — layered on top of `get_usuario_actual`, raises 403 if role not in list.
4. `POST /logout` — clears session.

### Catalog write endpoints (`api/routers/catalogo.py`)

All write endpoints require roles `superadmin`, `admin`, or `worker`. Viewers cannot write.

| Method | Path | Action |
|---|---|---|
| POST | `/categorias` | Create category |
| PUT | `/categorias/{id}` | Partial update (only sent fields) |
| POST | `/proveedores` | Create supplier |
| PUT | `/proveedores/{id}` | Partial update |
| POST | `/productos` | Create product |
| PUT | `/productos/{id}` | Partial update (stock, visibility, price, etc.) |
| DELETE | `/productos/{id}` | Soft-delete: sets `visible_en_sitio=false`, row preserved for order history |

### Frontend (`index.html`)

Single self-contained file — all CSS and JS are inline, no build step, no framework.

- **Catalog data** is fetched live from `GET /publico/productos` / `/publico/categorias` on page load (see `API_BASE` near the bottom of `index.html`/`producto.html`) — it is not hardcoded or read from a static JSON file.
- **WhatsApp number**: loaded dynamically from `GET /publico/sucursales` on page load (`aplicarSucursales()` in both `index.html` and `producto.html`) — no longer a single hardcoded constant. `waPrincipal` (the branch with `es_principal=true`) feeds the floating bubble, footer CTA, and generic contact CTAs; the literal `wa.me/...` hrefs still baked into the HTML are only a fallback used if the API call fails.
- **Multi-branch (migración 011)**: `sucursales` table has exactly 2 rows (San Pedro = `es_principal=true`, CDMX = `es_principal=false`). Both backend and frontend identify "the other branch" via `es_principal`, never by matching `nombre` (which is editable from `Sucursales.jsx`). This assumes exactly 2 branches — see the comment block at the top of `db/migrations/011_sucursales.sql` for what a third branch would require.
- **Sections:** `#inicio` (hero) → `#destacados` → `#nosotros` → `#coleccion` (filterable grid) → `#amedida` (process steps) → `#testimonios` → `#contacto` (form + info).
- Form submission (`handleFormSubmit`) and card clicks (`openWhatsApp`) both open a pre-filled WhatsApp URL — there is no backend form handler.

## Pendientes técnicos

Identificados durante la implementación de multi-sucursal (migración 011), deliberadamente dejados fuera de esa entrega para no mezclar una feature con un refactor de convención de todo el backend:

1. **Migrar de indexado posicional (`row[0]`, `row[13]`...) a acceso por nombre de columna** en los routers de `api/`. El patrón actual rompió en silencio cuando se insertó `sucursal_id` a la mitad de `_SQL_DETALLE` en `notas.py` — todas las columnas posteriores se recorrieron un índice, y `_verificar_acceso()` habría comparado el campo equivocado sin lanzar ningún error visible. Empezar por `notas.py` (mayor riesgo: una sola query compartida por 3 endpoints con índices hardcodeados en cada uno) usando `row_factory=dict_row` de psycopg3 — no requiere librerías nuevas, es un cambio de una línea por cursor. Extender al resto de `catalogo.py`, `publico.py`, `usuarios.py`, `dashboard.py` después, archivo por archivo, verificando cada endpoint contra `/docs` antes de seguir con el siguiente.
2. **Agregar `Depends(get_usuario_actual)` a los 4 endpoints sin autenticación en `api/main.py`**: `GET /api/productos`, `/api/productos/{id}`, `/api/categorias`, `/api/proveedores`. Hoy solo dependen de `Depends(database.get_db)` — son alcanzables sin sesión ni login, aunque el consumidor real es el panel admin (`Categorias.jsx`, `Proveedores.jsx`, `ProductoModal.jsx`, `NotaFormulario.jsx`). No exponen `costo`/`existencias`/`disponible_cdmx`/`precio_cdmx` (usan un modelo `Producto` más viejo que nunca hace join a `producto_sucursal`), así que no hay fuga de precio de sucursal — pero siguen siendo superficie pública innecesaria que debería vivir detrás de sesión igual que el resto de `/api`.
