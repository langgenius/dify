from pathlib import Path
import secrets

import pytest
from pydantic import ValidationError

from dify_agent.server.settings import ServerSettings


def _base64url_secret(value: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def test_server_settings_reads_shellctl_entrypoint_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_SHELLCTL_ENTRYPOINT", "http://shellctl.example")

    settings = ServerSettings()

    assert settings.shellctl_entrypoint == "http://shellctl.example"


def test_server_settings_reads_shellctl_auth_token_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_SHELLCTL_AUTH_TOKEN", "shell-secret")

    settings = ServerSettings()

    assert settings.shellctl_auth_token == "shell-secret"


def test_server_settings_defaults_shellctl_auth_token_to_none(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("DIFY_AGENT_SHELLCTL_AUTH_TOKEN", raising=False)
    monkeypatch.chdir(tmp_path)

    settings = ServerSettings()

    assert settings.shellctl_auth_token is None


def test_server_settings_reads_shell_back_proxy_public_url_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_SHELL_BACK_PROXY_PUBLIC_URL", "https://agent.example.com/back-proxy/")
    monkeypatch.setenv("DIFY_AGENT_SERVER_SECRET_KEY", _base64url_secret(secrets.token_bytes(32)))

    settings = ServerSettings()

    assert settings.shell_back_proxy_public_url == "https://agent.example.com/back-proxy"


def test_server_settings_rejects_shell_back_proxy_public_url_with_query_or_fragment() -> None:
    secret = _base64url_secret(secrets.token_bytes(32))

    with pytest.raises(ValidationError, match="query string or fragment"):
        _ = ServerSettings(
            shell_back_proxy_public_url="https://agent.example.com/back-proxy?x=1",
            server_secret_key=secret,
        )

    with pytest.raises(ValidationError, match="query string or fragment"):
        _ = ServerSettings(
            shell_back_proxy_public_url="https://agent.example.com/back-proxy#fragment",
            server_secret_key=secret,
        )


def test_server_settings_rejects_public_back_proxy_url_without_secret_key() -> None:
    with pytest.raises(ValidationError, match="DIFY_AGENT_SERVER_SECRET_KEY"):
        _ = ServerSettings(shell_back_proxy_public_url="https://agent.example.com/back-proxy")


def test_server_settings_rejects_invalid_server_secret_key() -> None:
    with pytest.raises(ValidationError, match="32 decoded bytes"):
        _ = ServerSettings(server_secret_key=_base64url_secret(b"short"))


def test_server_settings_rejects_padded_or_quoted_server_secret_key() -> None:
    secret = _base64url_secret(secrets.token_bytes(32))

    with pytest.raises(ValidationError, match="unpadded base64url"):
        _ = ServerSettings(server_secret_key=f"{secret}=")

    with pytest.raises(ValidationError, match="unpadded base64url"):
        _ = ServerSettings(server_secret_key=f'"{secret}"')
