"""
Límite de intentos fallidos de login (anti fuerza bruta) + aviso por correo.

Dos contadores independientes, en memoria del proceso:
  - por IP:      máx. 5 intentos fallidos por minuto
  - por usuario: máx. 10 intentos fallidos en 15 minutos (frena a un bot que
                 rota IPs contra la misma cuenta; nunca bloquea para siempre)

Al pasar cualquiera de los dos límites, POST /api/login responde 429 SIN
verificar la contraseña, hasta que la ventana se vacía sola. Un login
correcto limpia ambos contadores.

En memoria funciona porque producción corre UN solo proceso de uvicorn
(ver galerias-api.service, sin --workers). Si algún día se agregan
workers, cada uno tendría su propio contador y esto habría que moverlo a
la base de datos. Un reinicio del servicio también limpia los contadores.

La IP real se toma del header X-Real-IP que pone nginx (ver login() en
main.py); uvicorn escucha solo en 127.0.0.1, así que nadie puede llegarle
directo con ese header inventado.

El aviso por correo usa la misma configuración SMTP que el envío de notas
(SMTP_USER / SMTP_PASSWORD / NOTA_EMAIL_DESTINO en api/.env). Si no está
configurado, solo se escribe en el log del servicio (journalctl).
"""

import asyncio
import logging
import os
import smtplib
import time
from collections import deque
from datetime import datetime
from email.message import EmailMessage
from zoneinfo import ZoneInfo

log = logging.getLogger("uvicorn.error")

MAX_FALLOS_IP       = 5
VENTANA_IP_SEG      = 60
MAX_FALLOS_USUARIO  = 10
VENTANA_USUARIO_SEG = 15 * 60

# Correos de alerta: uno por IP/usuario bloqueado cada 15 min, y como tope
# 10 por hora en total — un ataque desde muchas IPs no debe llenar el buzón.
AVISO_REPETIR_SEG   = 15 * 60
MAX_AVISOS_POR_HORA = 10

_fallos: dict[str, deque] = {}       # "ip:1.2.3.4" / "user:faust01" → timestamps
_ultimo_aviso: dict[str, float] = {}
_avisos_enviados: deque = deque()
_tareas_aviso: set = set()


def _clave_usuario(username: str) -> str:
    return "user:" + username.strip().lower()


def _recientes(clave: str, ventana: int, ahora: float) -> deque:
    q = _fallos.get(clave)
    if q is None:
        return deque()
    while q and ahora - q[0] > ventana:
        q.popleft()
    if not q:
        del _fallos[clave]
    return q


def _limpiar_viejos(ahora: float) -> None:
    # Un bot que prueba miles de usernames inventados no debe hacer crecer
    # el diccionario sin fin.
    if len(_fallos) < 5000:
        return
    for clave in list(_fallos):
        ventana = VENTANA_IP_SEG if clave.startswith("ip:") else VENTANA_USUARIO_SEG
        _recientes(clave, ventana, ahora)


def segundos_bloqueado(ip: str, username: str) -> int:
    """0 si puede intentar; si no, cuántos segundos faltan para que pueda."""
    ahora = time.monotonic()
    espera = 0
    for clave, maximo, ventana in (
        ("ip:" + ip, MAX_FALLOS_IP, VENTANA_IP_SEG),
        (_clave_usuario(username), MAX_FALLOS_USUARIO, VENTANA_USUARIO_SEG),
    ):
        q = _recientes(clave, ventana, ahora)
        if len(q) >= maximo:
            espera = max(espera, int(ventana - (ahora - q[0])) + 1)
    return espera


def registrar_fallo(ip: str, username: str) -> None:
    """Anota un intento fallido; si con este se alcanza un límite, avisa."""
    ahora = time.monotonic()
    _limpiar_viejos(ahora)
    for clave, maximo, ventana in (
        ("ip:" + ip, MAX_FALLOS_IP, VENTANA_IP_SEG),
        (_clave_usuario(username), MAX_FALLOS_USUARIO, VENTANA_USUARIO_SEG),
    ):
        _recientes(clave, ventana, ahora)
        q = _fallos.setdefault(clave, deque())
        q.append(ahora)
        if len(q) == maximo:
            _avisar_bloqueo(clave, ip, username, len(q), ventana, ahora)


def registrar_exito(ip: str, username: str) -> None:
    _fallos.pop("ip:" + ip, None)
    _fallos.pop(_clave_usuario(username), None)


def _avisar_bloqueo(clave: str, ip: str, username: str, fallos: int,
                    ventana: int, ahora: float) -> None:
    motivo = "IP" if clave.startswith("ip:") else "usuario"
    log.warning(
        "Login bloqueado por %s: ip=%s usuario=%r — %d intentos fallidos en %d s",
        motivo, ip, username, fallos, ventana,
    )

    if ahora - _ultimo_aviso.get(clave, -AVISO_REPETIR_SEG) < AVISO_REPETIR_SEG:
        return
    while _avisos_enviados and ahora - _avisos_enviados[0] > 3600:
        _avisos_enviados.popleft()
    if len(_avisos_enviados) >= MAX_AVISOS_POR_HORA:
        return
    _ultimo_aviso[clave] = ahora
    _avisos_enviados.append(ahora)

    hora = datetime.now(ZoneInfo("America/Mexico_City")).strftime("%d/%m/%Y %H:%M")
    asunto = f"⚠️ Panel Muebles Rubí: login bloqueado ({motivo})"
    cuerpo = (
        "Se bloqueó temporalmente el inicio de sesión del panel por demasiados\n"
        "intentos fallidos.\n\n"
        f"Hora (CDMX):  {hora}\n"
        f"Motivo:       {fallos} intentos fallidos por {motivo} en "
        f"{ventana // 60 or 1} min\n"
        f"Usuario:      {username}\n"
        f"IP:           {ip}\n\n"
        "El bloqueo se quita solo cuando pasa la ventana. Si no fuiste tú ni\n"
        "alguien del equipo equivocándose de contraseña, puede ser un bot.\n"
        "No hace falta hacer nada mientras se repita poco; si llegan muchos\n"
        "avisos seguidos, revisa: sudo journalctl -u galerias-api.service\n"
    )
    try:
        tarea = asyncio.get_running_loop().create_task(_enviar_aviso(asunto, cuerpo))
    except RuntimeError:
        return  # sin event loop (p. ej. en un script) — queda solo el log
    # Guardar referencia: asyncio solo guarda referencias débiles a las tareas.
    _tareas_aviso.add(tarea)
    tarea.add_done_callback(_tareas_aviso.discard)


async def _enviar_aviso(asunto: str, cuerpo: str) -> None:
    try:
        await asyncio.to_thread(_enviar_correo, asunto, cuerpo)
    except Exception:
        log.exception("No se pudo enviar el correo de aviso de login bloqueado")


def _enviar_correo(asunto: str, cuerpo: str) -> None:
    # Mismo esquema que _enviar_pdf_por_email en routers/notas.py:
    # puerto 587 + STARTTLS (Hetzner bloquea el 465 saliente).
    usuario_smtp  = os.getenv("SMTP_USER")
    password_smtp = os.getenv("SMTP_PASSWORD")
    if not usuario_smtp or not password_smtp:
        return

    msg = EmailMessage()
    msg["Subject"] = asunto
    msg["From"]    = os.getenv("SMTP_FROM", usuario_smtp)
    msg["To"]      = os.getenv("NOTA_EMAIL_DESTINO", "mueblesrubimx@gmail.com")
    msg.set_content(cuerpo)

    host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    port = int(os.getenv("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=20) as server:
        server.starttls()
        server.login(usuario_smtp, password_smtp)
        server.send_message(msg)
