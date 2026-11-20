"""Validação do access token emitido pelo S4 Identidade.

O S4 assina com HS256 e um segredo compartilhado (``JWT_SECRET``), com ``sub`` = userId, ``username``,
``iss``, ``aud`` e ``exp``. O S2 só confere quem é o usuário; quem pode mexer em cada ficha ou modelo é
decidido aqui, pelo dono gravado em cada um.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.domain.errors import Unauthenticated


@dataclass(frozen=True)
class AuthUser:
    user_id: str
    username: str


def _b64decode(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def bearer_token(header: str | None) -> str:
    parts = (header or "").strip().split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise Unauthenticated()
    return parts[1]


class TokenVerifier:
    def __init__(self, secret: str, issuer: str, audience: str, *, clock: Callable[[], float] = time.time) -> None:
        self._secret = secret.encode("utf-8")
        self._issuer = issuer
        self._audience = audience
        self._clock = clock

    def verify(self, token: str) -> AuthUser:
        parts = token.split(".")
        if len(parts) != 3 or not all(parts):
            raise Unauthenticated("token inválido")
        header, payload, signature = parts
        expected = hmac.new(self._secret, f"{header}.{payload}".encode("ascii"), hashlib.sha256).digest()
        try:
            actual = _b64decode(signature)
            head: dict[str, Any] = json.loads(_b64decode(header))
            claims: dict[str, Any] = json.loads(_b64decode(payload))
        except (ValueError, UnicodeDecodeError) as exc:
            raise Unauthenticated("token inválido") from exc
        if not hmac.compare_digest(actual, expected):
            raise Unauthenticated("token inválido")
        exp = claims.get("exp")
        if (
            head.get("alg") != "HS256"
            or claims.get("iss") != self._issuer
            or claims.get("aud") != self._audience
            or not isinstance(exp, int | float)
            or exp <= self._clock()
            or not isinstance(claims.get("sub"), str)
            or not claims["sub"]
            or not isinstance(claims.get("username"), str)
        ):
            raise Unauthenticated("token inválido ou expirado")
        return AuthUser(user_id=claims["sub"], username=claims["username"])


def sign_access_token(
    secret: str,
    *,
    issuer: str,
    audience: str,
    user_id: str,
    username: str,
    ttl_seconds: int = 900,
    now: float | None = None,
) -> str:
    """Emite um token igual ao do S4. Só para testes e scripts de demonstração: em uso real, quem emite é o S4."""
    issued = int(time.time() if now is None else now)
    head = _b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = _b64encode(
        json.dumps(
            {
                "sub": user_id,
                "username": username,
                "email": f"{username}@exemplo.com",
                "globalRole": "USER",
                "iss": issuer,
                "aud": audience,
                "iat": issued,
                "exp": issued + ttl_seconds,
            }
        ).encode()
    )
    signature = _b64encode(hmac.new(secret.encode("utf-8"), f"{head}.{body}".encode("ascii"), hashlib.sha256).digest())
    return f"{head}.{body}.{signature}"
