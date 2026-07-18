# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**Muebles Rubí** is a static landing page for a Mexican furniture craftsman, served via GitHub Pages. A PostgreSQL database (local dev on Windows, production on a Hetzner VPS running Ubuntu 24.04) stores the product catalog and order records. A Python script bridges the private DB to the public static site.

## Commands

### Python environment (run from `api/`)

```bash
# Activate virtual environment (Windows)
venv\Scripts\activate

# Install dependencies
pip install -r api/requirements.txt

# Generate the public product catalog (writes to web-publico/productos.json)
python api/generar_json.py

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
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
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
PostgreSQL DB  →  api/generar_json.py  →  web-publico/productos.json  →  index.html (GitHub Pages)
```

`generar_json.py` is the publish step: run it after updating products in the DB to regenerate `productos.json`, then commit and push. The GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) deploys `web-publico/` to GitHub Pages automatically on every push to `main` that touches that folder.

### Folder layout

```
galerias-rubi/
├── web-publico/     ← static site → GitHub Pages
├── api/             ← FastAPI + bridge script → VPS
├── admin/           ← future sisters' interface → VPS
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
| `productos` | Master catalog. `fotos TEXT[]` stores URL/path array (first = main image). `visible_en_sitio` gates what goes into `productos.json`. Product-level `descuento_pct` overrides category-level; `NULL` means inherit. |
| `notas` | Order header (quote/order/delivered). Client data is **denormalized** here (`nombre_cliente`, `telefono`) — no separate clients table. `folio` is a text primary key (paper receipt number, e.g. `'0986'`). `resta` is a generated column (`total - anticipo`). |
| `partidas` | Order line items (many-to-many bridge between `notas` and `productos`). `importe` is generated (`cantidad * precio_unitario`). `producto_id` is nullable to allow one-off items not in the catalog. Cascades delete from `notas`. |

> **Note:** `relational_diagramm.md` shows an older draft with a separate `CLIENTES` table. The authoritative schema is `schema.sql`.

### API layout

```
api/
├── main.py              ← app, middleware, auth endpoints, public catalog GETs
├── database.py          ← pool + get_db dependency
├── auth.py              ← pwd_context, UsuarioActual, get_usuario_actual, requiere_roles
├── routers/
│   └── catalogo.py      ← catalog write endpoints (POST/PUT/DELETE)
├── crear_usuario.py     ← CLI script to create admin users
└── generar_json.py      ← publish script: DB → web-publico/productos.json
```

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

- **Catalog data** is currently hardcoded in the `products` JS array at the bottom of the file. The intent is for the site to eventually fetch `productos.json` from the DB bridge instead.
- **WhatsApp number** placeholder is `527XXXXXXXXX` — appears in three places: `WA_NUMBER` constant, the contact section link, and the footer/bubble links. Replace all three with the real number (country code + number, no `+` or spaces).
- **Sections:** `#inicio` (hero) → `#destacados` → `#nosotros` → `#coleccion` (filterable grid) → `#amedida` (process steps) → `#testimonios` → `#contacto` (form + info).
- Form submission (`handleFormSubmit`) and card clicks (`openWhatsApp`) both open a pre-filled WhatsApp URL — there is no backend form handler.
