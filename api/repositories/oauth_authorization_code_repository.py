"""Single-use OAuth authorization codes stored in Redis."""

import hashlib
import json
import secrets
from dataclasses import asdict, dataclass
from datetime import timedelta
from typing import Protocol

from pydantic import TypeAdapter, ValidationError

_KEY = "openapi_oauth:authorization_code:{digest}"
_CODE_BYTES = 32


@dataclass(frozen=True)
class AuthorizationCodeRecord:
    client_id: str
    redirect_uri: str
    code_challenge: str
    resource: str
    scope: str | None
    account_id: str
    workspace_id: str


_RECORD_ADAPTER = TypeAdapter(AuthorizationCodeRecord)


def _key(code: str) -> str:
    return _KEY.format(digest=hashlib.sha256(code.encode("utf-8")).hexdigest())


class AuthorizationCodeRedis(Protocol):
    def setex(self, name: str, time: timedelta, value: str) -> object: ...

    def getdel(self, name: str) -> str | bytes | None: ...


class RedisAuthorizationCodeRepository:
    def __init__(self, redis: AuthorizationCodeRedis) -> None:
        self._redis = redis

    def save(self, record: AuthorizationCodeRecord, ttl: timedelta) -> str:
        code = secrets.token_urlsafe(_CODE_BYTES)
        self._redis.setex(_key(code), ttl, json.dumps(asdict(record)))
        return code

    def consume(self, code: str) -> AuthorizationCodeRecord | None:
        raw = self._redis.getdel(_key(code))
        if raw is None:
            return None
        try:
            return _RECORD_ADAPTER.validate_json(raw)
        except ValidationError:
            return None
