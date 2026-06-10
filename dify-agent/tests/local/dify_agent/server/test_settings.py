from __future__ import annotations

from pathlib import Path
import secrets

import pytest
from pydantic import ValidationError

from dify_agent.agent_stub.server.agent_stub_files import DifyApiAgentStubFileRequestHandler
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubTokenCodec
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


def test_server_settings_reads_agent_stub_settings_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_URL", "https://agent.example.com/agent-stub/")
    monkeypatch.setenv("DIFY_AGENT_SERVER_SECRET_KEY", _base64url_secret(secrets.token_bytes(32)))

    settings = ServerSettings()

    assert settings.agent_stub_url == "https://agent.example.com/agent-stub"


def test_server_settings_ignores_obsolete_legacy_settings_namespace(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_SHELL_BACK_PROXY_PUBLIC_URL", "https://agent.example.com/back-proxy/")
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_URL", "https://agent.example.com/back-proxy/")

    settings = ServerSettings()

    assert settings.agent_stub_url is None


def test_server_settings_rejects_agent_stub_url_with_query_or_fragment() -> None:
    secret = _base64url_secret(secrets.token_bytes(32))

    with pytest.raises(ValidationError, match="query string or fragment"):
        _ = ServerSettings(
            agent_stub_url="https://agent.example.com/agent-stub?x=1",
            server_secret_key=secret,
        )

    with pytest.raises(ValidationError, match="query string or fragment"):
        _ = ServerSettings(
            agent_stub_url="https://agent.example.com/agent-stub#fragment",
            server_secret_key=secret,
        )


def test_server_settings_rejects_public_agent_stub_url_without_secret_key() -> None:
    with pytest.raises(ValidationError, match="DIFY_AGENT_SERVER_SECRET_KEY"):
        _ = ServerSettings(agent_stub_url="https://agent.example.com/agent-stub")


def test_server_settings_accepts_grpc_agent_stub_url_and_bind_override() -> None:
    settings = ServerSettings(
        agent_stub_url="grpc://agent.example.com:9091",
        agent_stub_grpc_bind_address="0.0.0.0:9191",
        server_secret_key=_base64url_secret(secrets.token_bytes(32)),
    )

    assert settings.agent_stub_url == "grpc://agent.example.com:9091"
    assert settings.agent_stub_grpc_bind_address == "0.0.0.0:9191"


def test_server_settings_rejects_grpc_bind_override_without_grpc_url() -> None:
    with pytest.raises(ValidationError, match="grpc://"):
        _ = ServerSettings(
            agent_stub_url="https://agent.example.com/agent-stub",
            agent_stub_grpc_bind_address="0.0.0.0:9191",
            server_secret_key=_base64url_secret(secrets.token_bytes(32)),
        )


def test_server_settings_rejects_invalid_server_secret_key() -> None:
    with pytest.raises(ValidationError, match="32 decoded bytes"):
        _ = ServerSettings(server_secret_key=_base64url_secret(b"short"))


def test_server_settings_rejects_padded_or_quoted_server_secret_key() -> None:
    secret = _base64url_secret(secrets.token_bytes(32))

    with pytest.raises(ValidationError, match="unpadded base64url"):
        _ = ServerSettings(server_secret_key=f"{secret}=")

    with pytest.raises(ValidationError, match="unpadded base64url"):
        _ = ServerSettings(server_secret_key=f'"{secret}"')


def test_server_settings_normalizes_dify_api_base_url_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_DIFY_API_BASE_URL", "https://api.example.com/")
    monkeypatch.setenv("DIFY_AGENT_DIFY_API_INNER_API_KEY", "inner-secret")

    settings = ServerSettings()

    assert settings.dify_api_base_url == "https://api.example.com"
    assert settings.dify_api_inner_api_key == "inner-secret"


def test_server_settings_requires_dify_api_base_url_and_key_together() -> None:
    with pytest.raises(ValidationError, match="DIFY_AGENT_DIFY_API_BASE_URL"):
        _ = ServerSettings(dify_api_base_url="https://api.example.com")

    with pytest.raises(ValidationError, match="DIFY_AGENT_DIFY_API_BASE_URL"):
        _ = ServerSettings(dify_api_inner_api_key="inner-secret")


def test_server_settings_rejects_dify_api_base_url_with_query_or_fragment() -> None:
    with pytest.raises(ValidationError, match="query string or fragment"):
        _ = ServerSettings(
            dify_api_base_url="https://api.example.com?x=1",
            dify_api_inner_api_key="inner-secret",
        )

    with pytest.raises(ValidationError, match="query string or fragment"):
        _ = ServerSettings(
            dify_api_base_url="https://api.example.com#frag",
            dify_api_inner_api_key="inner-secret",
        )


def test_server_settings_create_agent_stub_token_codec_returns_none_without_secret() -> None:
    assert ServerSettings().create_agent_stub_token_codec() is None


def test_server_settings_create_agent_stub_token_codec_returns_codec_when_secret_is_configured() -> None:
    settings = ServerSettings(server_secret_key=_base64url_secret(secrets.token_bytes(32)))

    codec = settings.create_agent_stub_token_codec()

    assert isinstance(codec, AgentStubTokenCodec)


def test_server_settings_create_agent_stub_file_request_handler_returns_none_without_full_settings() -> None:
    assert ServerSettings().create_agent_stub_file_request_handler() is None


def test_server_settings_create_agent_stub_file_request_handler_returns_handler_when_configured() -> None:
    settings = ServerSettings(
        dify_api_base_url="https://api.example.com",
        dify_api_inner_api_key="inner-secret",
    )

    handler = settings.create_agent_stub_file_request_handler()

    assert isinstance(handler, DifyApiAgentStubFileRequestHandler)
    assert handler.dify_api_base_url == "https://api.example.com"
    assert handler.dify_api_inner_api_key == "inner-secret"
