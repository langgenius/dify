"""SECRET_KEY persistence helpers for runtime setup."""

from __future__ import annotations

import secrets

from extensions.ext_storage import storage

GENERATED_SECRET_KEY_FILENAME = ".dify_secret_key"


def resolve_secret_key(secret_key: str) -> str:
    """Return an explicit SECRET_KEY or a generated key persisted in storage."""
    if secret_key:
        return secret_key

    return _load_or_create_secret_key()


def _load_or_create_secret_key() -> str:
    try:
        persisted_key = storage.load_once(GENERATED_SECRET_KEY_FILENAME).decode("utf-8").strip()
        if persisted_key:
            return persisted_key
    except FileNotFoundError:
        pass

    generated_key = secrets.token_urlsafe(48)

    try:
        storage.save(GENERATED_SECRET_KEY_FILENAME, f"{generated_key}\n".encode())
    except Exception as exc:
        raise ValueError(
            f"SECRET_KEY is not set and could not be generated at {GENERATED_SECRET_KEY_FILENAME}. "
            "Set SECRET_KEY explicitly or make storage writable."
        ) from exc

    return generated_key
