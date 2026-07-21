from __future__ import annotations

from pathlib import Path
import secrets
from typing import cast

import httpx
import pytest
from pydantic import ValidationError

from dify_agent.adapters.shell.enterprise import EnterpriseShellProvider
from dify_agent.adapters.shell.shellctl import ShellctlProvider
from dify_agent.agent_stub.server.agent_stub_drive import DifyApiAgentStubDriveRequestHandler
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


def test_server_settings_reads_shell_home_root_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_SHELL_HOME_ROOT", "/tmp/dify-agent-home/")

    settings = ServerSettings()

    assert settings.shell_home_root == "/tmp/dify-agent-home"


def test_server_settings_rejects_relative_shell_home_root(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_SHELL_HOME_ROOT", "relative/path")

    with pytest.raises(ValidationError, match="DIFY_AGENT_SHELL_HOME_ROOT must be an absolute path"):
        ServerSettings()


def test_server_settings_reads_enterprise_timeouts_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_ENTERPRISE_SANDBOX_GATEWAY_TIMEOUT", "45")
    monkeypatch.setenv("DIFY_AGENT_ENTERPRISE_SANDBOX_PROXY_TIMEOUT", "90")

    settings = ServerSettings()

    assert settings.enterprise_sandbox_gateway_timeout == 45
    assert settings.enterprise_sandbox_proxy_timeout == 90


def test_server_settings_defaults_shellctl_auth_token_to_none(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("DIFY_AGENT_SHELLCTL_AUTH_TOKEN", raising=False)
    monkeypatch.chdir(tmp_path)

    settings = ServerSettings()

    assert settings.shellctl_auth_token is None


def test_server_settings_reads_agent_stub_settings_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub/")
    monkeypatch.setenv("DIFY_AGENT_SERVER_SECRET_KEY", _base64url_secret(secrets.token_bytes(32)))

    settings = ServerSettings()

    assert settings.agent_stub_api_base_url == "https://agent.example.com/agent-stub"


def test_server_settings_normalizes_agent_stub_service_root_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com")
    monkeypatch.setenv("DIFY_AGENT_SERVER_SECRET_KEY", _base64url_secret(secrets.token_bytes(32)))

    settings = ServerSettings()

    assert settings.agent_stub_api_base_url == "https://agent.example.com/agent-stub"


def test_server_settings_ignores_obsolete_legacy_settings_namespace(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_SHELL_BACK_PROXY_PUBLIC_URL", "https://agent.example.com/back-proxy/")
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_URL", "https://agent.example.com/back-proxy/")

    settings = ServerSettings()

    assert settings.agent_stub_api_base_url is None


def test_server_settings_rejects_agent_stub_api_base_url_with_query_or_fragment() -> None:
    secret = _base64url_secret(secrets.token_bytes(32))

    with pytest.raises(ValidationError, match="query string or fragment"):
        _ = ServerSettings(
            agent_stub_api_base_url="https://agent.example.com/agent-stub?x=1",
            server_secret_key=secret,
        )

    with pytest.raises(ValidationError, match="query string or fragment"):
        _ = ServerSettings(
            agent_stub_api_base_url="https://agent.example.com/agent-stub#fragment",
            server_secret_key=secret,
        )


def test_server_settings_rejects_agent_stub_api_base_url_with_unexpected_path() -> None:
    with pytest.raises(ValidationError, match="empty or /agent-stub"):
        _ = ServerSettings(
            agent_stub_api_base_url="https://agent.example.com/foo",
            server_secret_key=_base64url_secret(secrets.token_bytes(32)),
        )


def test_server_settings_rejects_public_agent_stub_api_base_url_without_secret_key() -> None:
    with pytest.raises(ValidationError, match="DIFY_AGENT_SERVER_SECRET_KEY"):
        _ = ServerSettings(agent_stub_api_base_url="https://agent.example.com/agent-stub")


def test_server_settings_accepts_grpc_agent_stub_api_base_url_and_bind_override() -> None:
    settings = ServerSettings(
        agent_stub_api_base_url="grpc://agent.example.com:9091",
        agent_stub_grpc_bind_address="0.0.0.0:9191",
        server_secret_key=_base64url_secret(secrets.token_bytes(32)),
    )

    assert settings.agent_stub_api_base_url == "grpc://agent.example.com:9091"
    assert settings.agent_stub_grpc_bind_address == "0.0.0.0:9191"


def test_server_settings_rejects_grpc_bind_override_without_grpc_url() -> None:
    with pytest.raises(ValidationError, match="grpc://"):
        _ = ServerSettings(
            agent_stub_api_base_url="https://agent.example.com/agent-stub",
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


def test_server_settings_normalizes_inner_api_url_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_INNER_API_URL", "https://api.example.com/")
    monkeypatch.setenv("DIFY_AGENT_INNER_API_KEY", "inner-secret")

    settings = ServerSettings()

    assert settings.inner_api_url == "https://api.example.com"
    assert settings.inner_api_key == "inner-secret"


def test_server_settings_allows_inner_api_url_without_key_until_a_bridge_is_used() -> None:
    settings = ServerSettings(inner_api_key="inner-secret")
    assert settings.inner_api_key == "inner-secret"
    assert settings.inner_api_url == "http://localhost:5001"


def test_server_settings_rejects_inner_api_url_with_query_or_fragment() -> None:
    with pytest.raises(ValidationError, match="query string or fragment"):
        _ = ServerSettings(
            inner_api_url="https://api.example.com?x=1",
            inner_api_key="inner-secret",
        )

    with pytest.raises(ValidationError, match="query string or fragment"):
        _ = ServerSettings(
            inner_api_url="https://api.example.com#frag",
            inner_api_key="inner-secret",
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
        inner_api_url="https://api.example.com",
        inner_api_key="inner-secret",
    )

    handler = settings.create_agent_stub_file_request_handler()

    assert isinstance(handler, DifyApiAgentStubFileRequestHandler)
    assert handler.inner_api_url == "https://api.example.com"
    assert handler.inner_api_key == "inner-secret"


def test_server_settings_create_agent_stub_drive_request_handler_returns_none_without_full_settings() -> None:
    assert ServerSettings().create_agent_stub_drive_request_handler() is None


def test_server_settings_create_agent_stub_drive_request_handler_returns_handler_when_configured() -> None:
    settings = ServerSettings(
        inner_api_url="https://api.example.com",
        inner_api_key="inner-secret",
        outbound_http_connect_timeout=11,
        outbound_http_read_timeout=22,
        outbound_http_write_timeout=33,
        outbound_http_pool_timeout=44,
    )

    handler = settings.create_agent_stub_drive_request_handler()

    assert isinstance(handler, DifyApiAgentStubDriveRequestHandler)
    assert handler.inner_api_url == "https://api.example.com"
    assert handler.inner_api_key == "inner-secret"
    timeout = cast(httpx.Timeout, handler.timeout)
    assert timeout.connect == 11
    assert timeout.read == 22
    assert timeout.write == 33
    assert timeout.pool == 44


def test_build_shell_provider_returns_none_when_shellctl_entrypoint_is_unset(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("DIFY_AGENT_SHELLCTL_ENTRYPOINT", raising=False)
    monkeypatch.chdir(tmp_path)

    assert ServerSettings().build_shell_provider() is None


def test_build_shell_provider_returns_shellctl_provider_when_configured() -> None:
    settings = ServerSettings(
        shell_provider="shellctl",
        shellctl_entrypoint="http://shellctl.example",
        shellctl_auth_token="shell-secret",
    )

    provider = settings.build_shell_provider()

    assert isinstance(provider, ShellctlProvider)
    assert provider.entrypoint == "http://shellctl.example"
    assert provider.token == "shell-secret"


def test_build_shell_provider_returns_enterprise_provider_when_selected() -> None:
    settings = ServerSettings(
        shell_provider="enterprise",
        enterprise_sandbox_gateway_endpoint="https://gateway.example",
        enterprise_sandbox_gateway_auth_token="gateway-secret",
        enterprise_sandbox_gateway_timeout=45,
        enterprise_sandbox_proxy_timeout=90,
    )

    provider = settings.build_shell_provider()

    assert isinstance(provider, EnterpriseShellProvider)
    assert provider.gateway_endpoint == "https://gateway.example"
    assert provider.auth_token == "gateway-secret"
    assert provider.gateway_timeout == 45
    assert provider.proxy_timeout == 90


def test_build_shell_provider_returns_none_when_enterprise_endpoint_is_unset(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("DIFY_AGENT_ENTERPRISE_SANDBOX_GATEWAY_ENDPOINT", raising=False)
    monkeypatch.chdir(tmp_path)

    assert ServerSettings(shell_provider="enterprise").build_shell_provider() is None


def test_build_shell_provider_rejects_blank_shellctl_entrypoint() -> None:
    with pytest.raises(ValidationError, match="shellctl_entrypoint is required"):
        _ = ServerSettings(shell_provider="shellctl", shellctl_entrypoint="   ").build_shell_provider()


def test_server_settings_parses_shell_redact_patterns_json_array(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_SHELL_REDACT_PATTERNS", '["sk-[A-Za-z0-9]+","ghp_[A-Za-z0-9]{36}"]')

    settings = ServerSettings()

    assert settings.get_shell_redact_patterns() == ["sk-[A-Za-z0-9]+", "ghp_[A-Za-z0-9]{36}"]


def test_server_settings_shell_redact_patterns_empty_string_yields_empty_list(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_SHELL_REDACT_PATTERNS", "")

    settings = ServerSettings()

    assert settings.get_shell_redact_patterns() == []


def test_server_settings_shell_redact_patterns_defaults_to_empty_list(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("DIFY_AGENT_SHELL_REDACT_PATTERNS", raising=False)
    monkeypatch.chdir(tmp_path)

    settings = ServerSettings()

    assert settings.get_shell_redact_patterns() == []


def test_server_settings_rejects_non_array_shell_redact_patterns(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_SHELL_REDACT_PATTERNS", '{"key": "value"}')

    settings = ServerSettings()

    with pytest.raises(ValueError, match="must be a JSON array"):
        settings.get_shell_redact_patterns()
