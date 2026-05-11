from __future__ import annotations

import pytest
from flask import Flask

from extensions import ext_set_secretkey


class InMemoryStorage:
    def __init__(self, files: dict[str, bytes] | None = None) -> None:
        self.files = files or {}
        self.saved_files: list[tuple[str, bytes]] = []

    def load_once(self, filename: str) -> bytes:
        try:
            return self.files[filename]
        except KeyError:
            raise FileNotFoundError(filename)

    def save(self, filename: str, data: bytes) -> None:
        self.files[filename] = data
        self.saved_files.append((filename, data))


def test_init_app_uses_configured_secret_key(monkeypatch: pytest.MonkeyPatch) -> None:
    secret_key = "configured-secret-key"
    storage = InMemoryStorage()
    monkeypatch.setattr("extensions.ext_set_secretkey.dify_config.SECRET_KEY", secret_key)
    monkeypatch.setattr("configs.secret_key.storage", storage)
    app = Flask(__name__)
    app.config["SECRET_KEY"] = secret_key

    ext_set_secretkey.init_app(app)

    assert app.secret_key == secret_key
    assert app.config["SECRET_KEY"] == secret_key
    assert storage.saved_files == []


def test_init_app_generates_and_persists_secret_key_when_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = InMemoryStorage()
    monkeypatch.setattr("extensions.ext_set_secretkey.dify_config.SECRET_KEY", "")
    monkeypatch.setattr("configs.secret_key.storage", storage)
    app = Flask(__name__)
    app.config["SECRET_KEY"] = ""

    ext_set_secretkey.init_app(app)

    persisted_key = storage.files[".dify_secret_key"].decode("utf-8").strip()
    assert persisted_key
    assert storage.saved_files == [(".dify_secret_key", f"{persisted_key}\n".encode())]
    assert persisted_key == ext_set_secretkey.dify_config.SECRET_KEY
    assert persisted_key == app.config["SECRET_KEY"]
    assert persisted_key == app.secret_key


def test_init_app_reuses_persisted_secret_key_when_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    persisted_key = "persisted-secret-key"
    storage = InMemoryStorage({".dify_secret_key": f"{persisted_key}\n".encode()})
    monkeypatch.setattr("extensions.ext_set_secretkey.dify_config.SECRET_KEY", "")
    monkeypatch.setattr("configs.secret_key.storage", storage)
    app = Flask(__name__)
    app.config["SECRET_KEY"] = ""

    ext_set_secretkey.init_app(app)

    assert persisted_key == ext_set_secretkey.dify_config.SECRET_KEY
    assert persisted_key == app.config["SECRET_KEY"]
    assert persisted_key == app.secret_key
    assert storage.saved_files == []
