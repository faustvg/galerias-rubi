"""
crear_usuario.py
-----------------
Script de línea de comandos para crear usuarios del panel admin.
La contraseña se escribe en la terminal de forma oculta (no aparece en pantalla).
Nunca se guarda en texto plano: solo el hash bcrypt va a la base de datos.

Uso (desde la carpeta api/ con el venv activo):
    python crear_usuario.py

O desde la raíz del proyecto:
    python api/crear_usuario.py
"""

import getpass
import os
import sys
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from passlib.context import CryptContext

# Busca el .env en la misma carpeta que este script (api/.env),
# sin importar desde dónde se invoque.
load_dotenv(Path(__file__).parent / ".env")

ROLES_VALIDOS = ("superadmin", "admin", "viewer", "worker")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def pedir_rol() -> str:
    while True:
        rol = input(f"Rol {ROLES_VALIDOS} [worker]: ").strip() or "worker"
        if rol in ROLES_VALIDOS:
            return rol
        print(f"  Rol inválido. Elige uno de: {', '.join(ROLES_VALIDOS)}")


def main() -> None:
    print("=== Crear usuario del panel admin ===\n")

    username = input("Username: ").strip()
    if not username:
        print("ERROR: el username no puede estar vacío.")
        sys.exit(1)

    nombre = input("Nombre completo: ").strip()
    if not nombre:
        print("ERROR: el nombre no puede estar vacío.")
        sys.exit(1)

    rol = pedir_rol()

    password = getpass.getpass("Contraseña: ")
    if len(password) < 8:
        print("ERROR: la contraseña debe tener al menos 8 caracteres.")
        sys.exit(1)

    confirmacion = getpass.getpass("Confirmar contraseña: ")
    if password != confirmacion:
        print("ERROR: las contraseñas no coinciden.")
        sys.exit(1)

    password_hash = pwd_context.hash(password)

    conninfo = (
        f"host={os.getenv('DB_HOST')} "
        f"port={os.getenv('DB_PORT', '5432')} "
        f"dbname={os.getenv('DB_NAME')} "
        f"user={os.getenv('DB_USER')} "
        f"password={os.getenv('DB_PASSWORD')}"
    )

    try:
        with psycopg.connect(conninfo) as conn:
            conn.execute(
                "INSERT INTO usuarios (username, nombre, password_hash, rol) "
                "VALUES (%s, %s, %s, %s)",
                (username, nombre, password_hash, rol),
            )
            conn.commit()
    except psycopg.errors.UniqueViolation:
        print(f"\nERROR: el username '{username}' ya existe en la base de datos.")
        sys.exit(1)
    except Exception as e:
        print(f"\nERROR al conectar o insertar: {e}")
        sys.exit(1)

    print(f"\nUsuario '{username}' ({nombre}) creado exitosamente con rol '{rol}'.")


if __name__ == "__main__":
    main()
