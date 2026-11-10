import asyncio
import time

import bcrypt
import jwt
from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from .config import settings

# FERNET_KEY may hold several comma-separated keys for rotation: the first encrypts, all of them decrypt.
_fernet = MultiFernet([Fernet(k.strip().encode()) for k in settings.fernet_key.split(",") if k.strip()])
TOKEN_TTL = 3 * 86400


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


async def hash_pw_async(pw: str) -> str:
    return await asyncio.to_thread(hash_pw, pw)


async def check_pw(pw: str, hashed: str) -> bool:
    return await asyncio.to_thread(bcrypt.checkpw, pw.encode(), hashed.encode())


def make_token(uid: int, version: int) -> str:
    return jwt.encode({"sub": str(uid), "v": version, "exp": int(time.time()) + TOKEN_TTL}, settings.jwt_secret, "HS256")


def read_token(token: str) -> tuple[int, int] | None:
    try:
        d = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        return int(d["sub"]), int(d.get("v", 0))
    except Exception:
        return None


def encrypt(s: str) -> str:
    return _fernet.encrypt(s.encode()).decode()


def decrypt(s: str) -> str:
    try:
        return _fernet.decrypt(s.encode()).decode()
    except InvalidToken:
        return ""
