"""Keep provider tests independent of developer credentials and deployment settings."""

import os
from pathlib import Path
from unittest.mock import Mock

import pytest


@pytest.fixture(autouse=True)
def isolate_deployment_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Path, "home", Mock(return_value=tmp_path))
    monkeypatch.setattr(Path, "cwd", Mock(return_value=tmp_path))
    for name in tuple(os.environ):
        if name.startswith(("LANGSMITH_", "LANGCHAIN_", "OTEL_")) or name in {
            "HOSTED_LANGSERVE_PROJECT_NAME",
            "REQUESTS_CA_BUNDLE",
            "CURL_CA_BUNDLE",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
        }:
            monkeypatch.delenv(name)


@pytest.fixture(autouse=True)
def isolate_netrc(isolate_deployment_settings: None, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NETRC", str(tmp_path / "netrc"))
