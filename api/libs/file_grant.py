"""JWT codec for AppDeploy file grants and file content tokens.

Both token families are signed with the global ``SECRET_KEY`` that already
signs webapp passports, so ``aud`` is the only thing that separates them. Every
decode path pins ``audience`` explicitly: without it a webapp passport would be
accepted as a file grant, and a file grant would be accepted as a content token.
"""

from __future__ import annotations

import os
import time
from collections.abc import Sequence
from enum import StrEnum

import jwt
from pydantic import BaseModel, ValidationError

from configs import dify_config

FILE_GRANT_AUDIENCE = "dify-files"
FILE_CONTENT_AUDIENCE = "dify-files-content"

_ALGORITHM = "HS256"


class FileKind(StrEnum):
    """Which table owns a file referenced through a grant."""

    UPLOAD = "upload"
    TOOL = "tool"


class FileGrantScope(StrEnum):
    UPLOAD = "upload"
    RESOLVE = "resolve"
    PRODUCE = "produce"


class InvalidFileGrantError(Exception):
    """A grant or content token failed signature, audience, or claim validation."""


class FileGrantClaims(BaseModel):
    sub: str
    tenant_id: str
    app_id: str
    scopes: list[FileGrantScope]
    exp: int


class FileContentClaims(BaseModel):
    kind: FileKind
    file_id: str
    exp: int


def issue_file_grant(
    *,
    end_user_id: str,
    tenant_id: str,
    app_id: str,
    scopes: Sequence[FileGrantScope],
    ttl_seconds: int,
) -> tuple[str, int]:
    """Sign one file grant and return it with its absolute expiry."""

    expires_at = int(time.time()) + ttl_seconds
    token = jwt.encode(
        {
            "aud": FILE_GRANT_AUDIENCE,
            "sub": end_user_id,
            "tenant_id": tenant_id,
            "app_id": app_id,
            "scopes": [str(scope) for scope in scopes],
            "exp": expires_at,
        },
        dify_config.SECRET_KEY,
        algorithm=_ALGORITHM,
    )
    return token, expires_at


def decode_file_grant(token: str) -> FileGrantClaims:
    payload = _decode(token, audience=FILE_GRANT_AUDIENCE, required=["exp", "sub", "tenant_id", "app_id", "scopes"])
    try:
        return FileGrantClaims.model_validate(payload)
    except ValidationError as exc:
        raise InvalidFileGrantError("malformed file grant claims") from exc


def issue_file_content_token(*, file_id: str, kind: FileKind) -> str:
    return jwt.encode(
        {
            "aud": FILE_CONTENT_AUDIENCE,
            "kind": str(kind),
            "file_id": file_id,
            # Two tokens signed for the same file within the same second would
            # otherwise be byte-identical.
            "nonce": os.urandom(8).hex(),
            "exp": int(time.time()) + dify_config.FILES_ACCESS_TIMEOUT,
        },
        dify_config.SECRET_KEY,
        algorithm=_ALGORITHM,
    )


def decode_file_content_token(token: str) -> FileContentClaims:
    payload = _decode(token, audience=FILE_CONTENT_AUDIENCE, required=["exp", "kind", "file_id"])
    try:
        return FileContentClaims.model_validate(payload)
    except ValidationError as exc:
        raise InvalidFileGrantError("malformed content token claims") from exc


def build_content_url(*, file_id: str, kind: FileKind, external: bool) -> str:
    base_url = dify_config.FILES_URL if external else (dify_config.INTERNAL_FILES_URL or dify_config.FILES_URL)
    token = issue_file_content_token(file_id=file_id, kind=kind)
    return f"{base_url}/files/appdeploy/{file_id}/content?token={token}"


def _decode(token: str, *, audience: str, required: list[str]) -> dict[str, object]:
    try:
        return jwt.decode(
            token,
            dify_config.SECRET_KEY,
            algorithms=[_ALGORITHM],
            audience=audience,
            options={"require": ["aud", *required]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidFileGrantError(str(exc)) from exc


__all__ = [
    "FILE_CONTENT_AUDIENCE",
    "FILE_GRANT_AUDIENCE",
    "FileContentClaims",
    "FileGrantClaims",
    "FileGrantScope",
    "FileKind",
    "InvalidFileGrantError",
    "build_content_url",
    "decode_file_content_token",
    "decode_file_grant",
    "issue_file_content_token",
    "issue_file_grant",
]
