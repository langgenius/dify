from __future__ import annotations

from pathlib import Path
import os
import secrets

import pytest
from pydantic import ValidationError

from dify_agent.agent_stub.server.agent_stub_files import DifyApiAgentStubFileRequestHandler
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubTokenCodec
from dify_agent.server.settings import (
    DEFAULT_RUN_EVENT_STREAM_MAX_LENGTH,
    DEFAULT_RUN_RETENTION_SECONDS,
    ServerSettings,
)
from dify_agent.runtime.runner import DEFAULT_AGENT_RUN_TIMEOUT_SECONDS
from dify_agent.runtime_backend.e2b import E2B_MAX_ACTIVE_TIMEOUT_SECONDS, E2BExecutionBindingBackend
from dify_agent.runtime_backend.enterprise import EnterpriseExecutionBindingBackend, EnterpriseHomeSnapshotBackend
from dify_agent.runtime_backend.local import LocalExecutionBindingBackend, LocalHomeSnapshotBackend
from dify_agent.runtime_backend.openshell import (
    OpenShellExecutionBindingBackend,
    OpenShellHomeSnapshotBackend,
    OpenShellSDKControlPlane,
)


@pytest.fixture(autouse=True)
def isolate_settings_dotenv(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.chdir(tmp_path)


def _base64url_secret(value: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def test_server_settings_reads_shellctl_entrypoint_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_SHELLCTL_ENTRYPOINT", "http://shellctl.example")

    settings = ServerSettings()

    assert settings.local_sandbox_endpoint == "http://shellctl.example"


def test_server_settings_reads_shellctl_auth_token_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_SHELLCTL_AUTH_TOKEN", "shell-secret")

    settings = ServerSettings()

    assert settings.local_sandbox_auth_token == "shell-secret"


def test_server_settings_reads_enterprise_timeouts_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_ENTERPRISE_SANDBOX_GATEWAY_TIMEOUT", "45")
    monkeypatch.setenv("DIFY_AGENT_ENTERPRISE_SANDBOX_PROXY_TIMEOUT", "90")

    settings = ServerSettings()

    assert settings.enterprise_sandbox_gateway_timeout == 45
    assert settings.enterprise_sandbox_proxy_timeout == 90


def test_server_settings_run_and_e2b_timeouts_default_align_and_override_independently(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("DIFY_AGENT_RUN_TIMEOUT_SECONDS", raising=False)
    monkeypatch.delenv("DIFY_AGENT_E2B_ACTIVE_TIMEOUT_SECONDS", raising=False)
    monkeypatch.chdir(tmp_path)

    settings = ServerSettings()

    assert settings.run_timeout_seconds == DEFAULT_AGENT_RUN_TIMEOUT_SECONDS == 3600
    assert settings.e2b_active_timeout_seconds == E2B_MAX_ACTIVE_TIMEOUT_SECONDS == 3600

    monkeypatch.setenv("DIFY_AGENT_RUN_TIMEOUT_SECONDS", "900.5")

    run_override_settings = ServerSettings()
    assert run_override_settings.run_timeout_seconds == 900.5
    assert run_override_settings.e2b_active_timeout_seconds == 3600

    monkeypatch.delenv("DIFY_AGENT_RUN_TIMEOUT_SECONDS")
    monkeypatch.setenv("DIFY_AGENT_E2B_ACTIVE_TIMEOUT_SECONDS", "900")

    e2b_override_settings = ServerSettings()
    assert e2b_override_settings.run_timeout_seconds == 3600
    assert e2b_override_settings.e2b_active_timeout_seconds == 900


def test_server_settings_rejects_non_positive_run_timeout() -> None:
    with pytest.raises(ValidationError, match="greater than 0"):
        _ = ServerSettings(run_timeout_seconds=0)


def test_server_settings_defaults_to_bounded_short_lived_run_events(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("DIFY_AGENT_RUN_RETENTION_SECONDS", raising=False)
    monkeypatch.delenv("DIFY_AGENT_RUN_EVENT_STREAM_MAX_LENGTH", raising=False)
    monkeypatch.delenv("DIFY_AGENT_STREAM_TEXT_DELTA_COALESCING_ENABLED", raising=False)
    monkeypatch.delenv("DIFY_AGENT_STREAM_TEXT_DELTA_FLUSH_INTERVAL_MS", raising=False)
    monkeypatch.delenv("DIFY_AGENT_STREAM_TEXT_DELTA_MAX_CHARS", raising=False)
    monkeypatch.chdir(tmp_path)

    settings = ServerSettings()

    assert settings.run_retention_seconds == DEFAULT_RUN_RETENTION_SECONDS == 7200
    assert settings.run_event_stream_max_length == DEFAULT_RUN_EVENT_STREAM_MAX_LENGTH == 5000
    assert settings.stream_text_delta_coalescing_enabled is True
    assert settings.stream_text_delta_flush_interval_ms == 100
    assert settings.stream_text_delta_max_chars == 4096


def test_server_settings_reads_run_event_bounds_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_RUN_EVENT_STREAM_MAX_LENGTH", "1234")
    monkeypatch.setenv("DIFY_AGENT_STREAM_TEXT_DELTA_COALESCING_ENABLED", "false")
    monkeypatch.setenv("DIFY_AGENT_STREAM_TEXT_DELTA_FLUSH_INTERVAL_MS", "250")
    monkeypatch.setenv("DIFY_AGENT_STREAM_TEXT_DELTA_MAX_CHARS", "2048")

    settings = ServerSettings()

    assert settings.run_event_stream_max_length == 1234
    assert settings.stream_text_delta_coalescing_enabled is False
    assert settings.stream_text_delta_flush_interval_ms == 250
    assert settings.stream_text_delta_max_chars == 2048


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("run_event_stream_max_length", 0),
        ("stream_text_delta_flush_interval_ms", 0),
        ("stream_text_delta_max_chars", 0),
    ],
)
def test_server_settings_rejects_invalid_run_event_bounds(field: str, value: int) -> None:
    with pytest.raises(ValidationError):
        _ = ServerSettings(**{field: value})  # pyright: ignore[reportArgumentType]


def test_server_settings_reads_binding_file_download_command_timeout_from_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DIFY_AGENT_BINDING_FILE_DOWNLOAD_COMMAND_TIMEOUT_SECONDS", "123.5")

    settings = ServerSettings()

    assert settings.binding_file_download_command_timeout_seconds == 123.5


def test_server_settings_defaults_binding_file_download_command_timeout_to_210_seconds(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("DIFY_AGENT_BINDING_FILE_DOWNLOAD_COMMAND_TIMEOUT_SECONDS", raising=False)
    monkeypatch.chdir(tmp_path)

    assert ServerSettings().binding_file_download_command_timeout_seconds == 210.0


def test_server_settings_rejects_non_positive_binding_file_download_command_timeout() -> None:
    with pytest.raises(ValidationError, match="greater than 0"):
        _ = ServerSettings(binding_file_download_command_timeout_seconds=0)


def test_server_settings_defaults_shellctl_auth_token_to_none(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("DIFY_AGENT_SHELLCTL_AUTH_TOKEN", raising=False)
    monkeypatch.chdir(tmp_path)

    settings = ServerSettings()

    assert settings.local_sandbox_auth_token is None


def test_server_settings_reads_agent_stub_settings_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub/")
    monkeypatch.setenv("DIFY_AGENT_SANDBOX_FILES_BASE_URL", "https://dify.example.com/prefix/")
    monkeypatch.setenv("DIFY_AGENT_STUB_UPLOAD_FILE_SIZE_LIMIT", "72")
    monkeypatch.setenv("DIFY_AGENT_SERVER_SECRET_KEY", _base64url_secret(secrets.token_bytes(32)))

    settings = ServerSettings()

    assert settings.agent_stub_api_base_url == "https://agent.example.com/agent-stub"
    assert settings.sandbox_files_base_url == "https://dify.example.com/prefix"
    assert settings.stub_upload_file_size_limit == 72


def test_server_settings_defaults_stub_upload_file_size_limit_to_50_mib(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("DIFY_AGENT_STUB_UPLOAD_FILE_SIZE_LIMIT", raising=False)
    monkeypatch.chdir(tmp_path)

    assert ServerSettings().stub_upload_file_size_limit == 50


def test_server_settings_accepts_zero_and_rejects_negative_stub_upload_file_size_limit() -> None:
    assert ServerSettings(stub_upload_file_size_limit=0).stub_upload_file_size_limit == 0

    with pytest.raises(ValidationError):
        _ = ServerSettings(stub_upload_file_size_limit=-1)


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


def test_server_settings_requires_sandbox_files_base_url_for_agent_stub_file_operations() -> None:
    with pytest.raises(ValidationError, match="DIFY_AGENT_SANDBOX_FILES_BASE_URL"):
        _ = ServerSettings(
            agent_stub_api_base_url="https://agent.example.com/agent-stub",
            inner_api_key="inner-secret",
            server_secret_key=_base64url_secret(secrets.token_bytes(32)),
        )


def test_server_settings_rejects_sandbox_files_base_url_query_or_fragment() -> None:
    with pytest.raises(ValidationError, match="query string or fragment"):
        _ = ServerSettings(sandbox_files_base_url="https://dify.example.com?x=1")

    with pytest.raises(ValidationError, match="query string or fragment"):
        _ = ServerSettings(sandbox_files_base_url="https://dify.example.com#fragment")


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


@pytest.mark.parametrize(("value", "expected"), [("", None), ("  ", None), (" secret-token ", "secret-token")])
def test_server_settings_normalizes_api_token(value: str, expected: str | None) -> None:
    assert ServerSettings(api_token=value).api_token == expected


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
        sandbox_files_base_url="https://sandbox-files.example.com/dify",
        stub_upload_file_size_limit=72,
    )

    handler = settings.create_agent_stub_file_request_handler()

    assert isinstance(handler, DifyApiAgentStubFileRequestHandler)
    assert handler.inner_api_url == "https://api.example.com"
    assert handler.inner_api_key == "inner-secret"
    assert handler.sandbox_files_base_url == "https://sandbox-files.example.com/dify"
    assert handler.max_upload_size_bytes == 72 * 1024 * 1024


def test_build_runtime_backend_profile_returns_none_when_local_endpoint_is_unset(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("DIFY_AGENT_SHELLCTL_ENTRYPOINT", raising=False)
    monkeypatch.chdir(tmp_path)

    assert ServerSettings().build_runtime_backend_profile() is None


def test_build_runtime_backend_profile_returns_local_drivers_when_configured() -> None:
    settings = ServerSettings(
        runtime_backend="local",
        local_sandbox_endpoint="http://shellctl.example",
        local_sandbox_auth_token="shell-secret",
        local_sandbox_materialized_home_root="/tmp/dify/homes",
        local_sandbox_workspace_root="/tmp/dify/workspaces",
        local_sandbox_home_snapshot_root="/tmp/dify/snapshots",
    )

    profile = settings.build_runtime_backend_profile()

    assert profile is not None
    assert isinstance(profile.execution_bindings, LocalExecutionBindingBackend)
    assert isinstance(profile.home_snapshots, LocalHomeSnapshotBackend)
    assert profile.execution_bindings.endpoint == "http://shellctl.example"
    assert profile.execution_bindings.auth_token == "shell-secret"
    assert profile.execution_bindings.materialized_home_root == "/tmp/dify/homes"
    assert profile.execution_bindings.workspace_root == "/tmp/dify/workspaces"
    assert profile.execution_bindings.snapshot_root == "/tmp/dify/snapshots"
    assert profile.home_snapshots.snapshot_root == "/tmp/dify/snapshots"


def test_build_runtime_backend_profile_returns_enterprise_drivers_when_selected() -> None:
    settings = ServerSettings(
        runtime_backend="enterprise",
        enterprise_sandbox_gateway_endpoint="https://gateway.example",
        enterprise_sandbox_gateway_auth_token="gateway-secret",
        enterprise_sandbox_gateway_timeout=45,
        enterprise_sandbox_proxy_timeout=90,
        enterprise_sandbox_snapshot_timeout=120,
    )

    profile = settings.build_runtime_backend_profile()

    assert profile is not None
    assert isinstance(profile.execution_bindings, EnterpriseExecutionBindingBackend)
    assert profile.execution_bindings.gateway_endpoint == "https://gateway.example"
    assert profile.execution_bindings.auth_token == "gateway-secret"
    assert profile.execution_bindings.gateway_timeout == 45
    assert profile.execution_bindings.proxy_timeout == 90
    assert isinstance(profile.home_snapshots, EnterpriseHomeSnapshotBackend)
    assert profile.home_snapshots.gateway_endpoint == "https://gateway.example"
    assert profile.home_snapshots.auth_token == "gateway-secret"
    assert profile.home_snapshots.snapshot_timeout == 120
    assert profile.execution_bindings.snapshot_timeout == 120


def test_enterprise_snapshot_timeout_defaults_above_the_gateway_budget() -> None:
    settings = ServerSettings(
        runtime_backend="enterprise",
        enterprise_sandbox_gateway_endpoint="https://gateway.example",
    )

    assert settings.enterprise_sandbox_snapshot_timeout > settings.enterprise_sandbox_gateway_timeout


def test_build_runtime_backend_profile_passes_e2b_active_timeout() -> None:
    settings = ServerSettings(
        runtime_backend="e2b",
        e2b_api_key="e2b-secret",
        e2b_active_timeout_seconds=900,
    )

    profile = settings.build_runtime_backend_profile()

    assert profile is not None
    assert isinstance(profile.execution_bindings, E2BExecutionBindingBackend)
    assert profile.execution_bindings.active_timeout_seconds == 900
    assert profile.execution_bindings.template == "difys-default-team/dify-agent-local-sandbox"


_OPENSHELL_DRIVER_CONFIG = (
    '{"docker": {"mounts": [{"type": "volume", "source": "dify-agent-shared", "target": "/mnt/dify-agent-shared"}]}}'
)


def test_build_runtime_backend_profile_returns_openshell_drivers_when_selected() -> None:
    settings = ServerSettings(
        runtime_backend="openshell",
        openshell_gateway_endpoint="gateway.example:17670",
        openshell_driver_config=_OPENSHELL_DRIVER_CONFIG,
        openshell_shared_mount_path="/mnt/shared",
        openshell_shellctl_auth_token="token-1",
        openshell_shellctl_port=6006,
        openshell_exec_timeout_seconds=90,
        openshell_egress_allow="agent.example.com:5050",
    )

    profile = settings.build_runtime_backend_profile()

    assert profile is not None
    assert isinstance(profile.execution_bindings, OpenShellExecutionBindingBackend)
    assert isinstance(profile.home_snapshots, OpenShellHomeSnapshotBackend)
    control_plane = profile.execution_bindings.control_plane
    assert isinstance(control_plane, OpenShellSDKControlPlane)
    assert control_plane.endpoint == "gateway.example:17670"
    assert control_plane.shared_mount_path == "/mnt/shared"
    assert control_plane.exec_timeout_seconds == 90
    assert control_plane.egress_allow == (("agent.example.com", 5050),)
    assert profile.execution_bindings.shellctl_auth_token == "token-1"
    assert profile.execution_bindings.shellctl_port == 6006


def test_build_runtime_backend_profile_rejects_empty_openshell_driver_config() -> None:
    with pytest.raises(ValidationError, match="must mount the shared Home Snapshot volume"):
        _ = ServerSettings(
            runtime_backend="openshell",
            openshell_gateway_endpoint="gateway.example:17670",
            openshell_driver_config="{}",
            openshell_shellctl_auth_token="token-1",
        ).build_runtime_backend_profile()


def test_build_runtime_backend_profile_rejects_missing_enterprise_endpoint(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("DIFY_AGENT_ENTERPRISE_SANDBOX_GATEWAY_ENDPOINT", raising=False)
    monkeypatch.chdir(tmp_path)

    with pytest.raises(ValidationError, match="enterprise_sandbox_gateway_endpoint is required"):
        _ = ServerSettings(runtime_backend="enterprise").build_runtime_backend_profile()


def test_build_runtime_backend_profile_rejects_blank_local_endpoint() -> None:
    with pytest.raises(ValidationError, match="local_sandbox_endpoint is required"):
        _ = ServerSettings(runtime_backend="local", local_sandbox_endpoint="   ").build_runtime_backend_profile()


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
        _ = settings.get_shell_redact_patterns()


def _isolate_trajectory_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.chdir(tmp_path)
    for key in (
        "DIFY_AGENT_TRAJECTORY_ENABLED",
        "DIFY_AGENT_TRAJECTORY_OTLP_TRACES_ENDPOINT",
        "DIFY_AGENT_TRAJECTORY_OTLP_HEADERS",
        "DIFY_AGENT_TRAJECTORY_SERVICE_NAME",
        "DIFY_AGENT_TRAJECTORY_INCLUDE_CONTENT",
        "DIFY_AGENT_TRAJECTORY_MAX_QUEUE_SIZE",
        "DIFY_AGENT_TRAJECTORY_MAX_EXPORT_BATCH_SIZE",
        "DIFY_AGENT_TRAJECTORY_SCHEDULE_DELAY_MS",
        "DIFY_AGENT_TRAJECTORY_EXPORT_TIMEOUT_MS",
        "DIFY_AGENT_TRAJECTORY_TRACE_CONTEXT_MODE",
    ):
        monkeypatch.delenv(key, raising=False)


def test_server_settings_trajectory_defaults_disabled(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _isolate_trajectory_env(monkeypatch, tmp_path)

    settings = ServerSettings()

    assert settings.trajectory_enabled is False
    assert settings.trajectory_otlp_traces_endpoint is None
    assert settings.trajectory_otlp_headers == {}
    assert settings.trajectory_service_name == "dify-agent-trajectory"
    assert settings.trajectory_include_content is False
    assert settings.trajectory_max_queue_size == 2048
    assert settings.trajectory_max_export_batch_size == 512
    assert settings.trajectory_schedule_delay_ms == 5000
    assert settings.trajectory_export_timeout_ms == 5000
    assert settings.trajectory_trace_context_mode == "isolated"


def test_server_settings_reads_trajectory_opt_in_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_TRAJECTORY_ENABLED", "true")
    monkeypatch.setenv("DIFY_AGENT_TRAJECTORY_OTLP_TRACES_ENDPOINT", "http://127.0.0.1:4318/v1/traces")
    monkeypatch.setenv("DIFY_AGENT_TRAJECTORY_OTLP_HEADERS", '{"Authorization": "Bearer test-only"}')
    monkeypatch.setenv("DIFY_AGENT_TRAJECTORY_SERVICE_NAME", "custom-trajectory")
    monkeypatch.setenv("DIFY_AGENT_TRAJECTORY_INCLUDE_CONTENT", "true")

    settings = ServerSettings()

    assert settings.trajectory_enabled is True
    assert str(settings.trajectory_otlp_traces_endpoint) == "http://127.0.0.1:4318/v1/traces"
    assert settings.trajectory_otlp_headers["Authorization"].get_secret_value() == "Bearer test-only"
    assert "test-only" not in repr(settings.trajectory_otlp_headers)
    assert settings.trajectory_service_name == "custom-trajectory"
    assert settings.trajectory_include_content is True


def test_server_settings_trajectory_enabled_requires_endpoint(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _isolate_trajectory_env(monkeypatch, tmp_path)

    with pytest.raises(ValidationError, match="trajectory_otlp_traces_endpoint"):
        _ = ServerSettings(trajectory_enabled=True)


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://user:pass@collector.example/v1/traces",
        "http://collector.example/v1/traces#frag",
    ],
)
def test_server_settings_rejects_trajectory_endpoint_with_credentials_or_fragment(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    endpoint: str,
) -> None:
    _isolate_trajectory_env(monkeypatch, tmp_path)

    with pytest.raises(ValidationError, match="credentials or a fragment"):
        _ = ServerSettings(trajectory_enabled=True, trajectory_otlp_traces_endpoint=endpoint)


def test_server_settings_reads_trajectory_batch_processor_limits_from_env(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _isolate_trajectory_env(monkeypatch, tmp_path)
    monkeypatch.setenv("DIFY_AGENT_TRAJECTORY_MAX_QUEUE_SIZE", "1024")
    monkeypatch.setenv("DIFY_AGENT_TRAJECTORY_MAX_EXPORT_BATCH_SIZE", "128")
    monkeypatch.setenv("DIFY_AGENT_TRAJECTORY_SCHEDULE_DELAY_MS", "250")
    monkeypatch.setenv("DIFY_AGENT_TRAJECTORY_EXPORT_TIMEOUT_MS", "1500")

    settings = ServerSettings()

    assert settings.trajectory_max_queue_size == 1024
    assert settings.trajectory_max_export_batch_size == 128
    assert settings.trajectory_schedule_delay_ms == 250
    assert settings.trajectory_export_timeout_ms == 1500


def test_server_settings_reads_trajectory_batch_processor_limits_from_dotenv(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _isolate_trajectory_env(monkeypatch, tmp_path)
    (tmp_path / ".env").write_text(
        "DIFY_AGENT_TRAJECTORY_MAX_QUEUE_SIZE=1024\n"
        "DIFY_AGENT_TRAJECTORY_MAX_EXPORT_BATCH_SIZE=128\n"
        "DIFY_AGENT_TRAJECTORY_SCHEDULE_DELAY_MS=250\n"
        "DIFY_AGENT_TRAJECTORY_EXPORT_TIMEOUT_MS=1500\n"
    )

    settings = ServerSettings()

    assert settings.trajectory_max_queue_size == 1024
    assert settings.trajectory_max_export_batch_size == 128
    assert settings.trajectory_schedule_delay_ms == 250
    assert settings.trajectory_export_timeout_ms == 1500


@pytest.mark.parametrize(
    "field",
    [
        "trajectory_max_queue_size",
        "trajectory_max_export_batch_size",
        "trajectory_schedule_delay_ms",
        "trajectory_export_timeout_ms",
    ],
)
@pytest.mark.parametrize("bad_value", [0, -1])
def test_server_settings_rejects_non_positive_trajectory_batch_processor_limits(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    field: str,
    bad_value: int,
) -> None:
    _isolate_trajectory_env(monkeypatch, tmp_path)

    with pytest.raises(ValidationError, match=field):
        _ = ServerSettings.model_validate({field: bad_value})


def test_server_settings_rejects_trajectory_batch_size_above_queue_size(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _isolate_trajectory_env(monkeypatch, tmp_path)

    with pytest.raises(ValidationError, match="must not exceed"):
        _ = ServerSettings(trajectory_max_queue_size=1024, trajectory_max_export_batch_size=1025)


def test_server_settings_accepts_equal_trajectory_batch_and_queue_size(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _isolate_trajectory_env(monkeypatch, tmp_path)

    settings = ServerSettings(trajectory_max_queue_size=64, trajectory_max_export_batch_size=64)

    assert settings.trajectory_max_queue_size == 64
    assert settings.trajectory_max_export_batch_size == 64


@pytest.mark.parametrize("mode", ["isolated", "shared"])
def test_server_settings_reads_trajectory_trace_context_mode_from_env(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    mode: str,
) -> None:
    _isolate_trajectory_env(monkeypatch, tmp_path)
    monkeypatch.setenv("DIFY_AGENT_TRAJECTORY_TRACE_CONTEXT_MODE", mode)

    assert ServerSettings().trajectory_trace_context_mode == mode


def test_server_settings_reads_trajectory_trace_context_mode_from_dotenv(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _isolate_trajectory_env(monkeypatch, tmp_path)
    (tmp_path / ".env").write_text("DIFY_AGENT_TRAJECTORY_TRACE_CONTEXT_MODE=shared\n")

    assert ServerSettings().trajectory_trace_context_mode == "shared"


@pytest.mark.parametrize("bad_mode", ["auto", "SHARED", ""])
def test_server_settings_rejects_unknown_trajectory_trace_context_mode(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    bad_mode: str,
) -> None:
    _isolate_trajectory_env(monkeypatch, tmp_path)

    with pytest.raises(ValidationError, match="trajectory_trace_context_mode"):
        _ = ServerSettings.model_validate({"trajectory_trace_context_mode": bad_mode})


def test_server_settings_observability_dotenv_snapshot_only_captures_sdk_keys(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    monkeypatch.delenv("LOGFIRE_EMPTY", raising=False)
    monkeypatch.delenv("LOGFIRE_TOKEN", raising=False)
    dotenv = tmp_path / "otel.env"
    dotenv.write_text(
        "OTEL_EXPORTER_OTLP_ENDPOINT=http://snap:4318\n"
        "LOGFIRE_EMPTY=\n"
        "LOGFIRE_TOKEN=dotenv-test-only-secret\n"
        "OTEL_UNSET\n"
        "DIFY_AGENT_API_TOKEN=not-captured\n"
        "UNRELATED=not-captured\n"
    )

    settings = ServerSettings(_env_file=dotenv)

    snapshot = settings.observability_dotenv
    assert set(snapshot) == {"OTEL_EXPORTER_OTLP_ENDPOINT", "LOGFIRE_EMPTY", "LOGFIRE_TOKEN"}
    assert snapshot["OTEL_EXPORTER_OTLP_ENDPOINT"].get_secret_value() == "http://snap:4318"
    assert snapshot["LOGFIRE_EMPTY"].get_secret_value() == ""
    assert snapshot["LOGFIRE_TOKEN"].get_secret_value() == "dotenv-test-only-secret"
    assert "OTEL_EXPORTER_OTLP_ENDPOINT" not in os.environ
    assert "LOGFIRE_TOKEN" not in os.environ
    assert "observability_dotenv" not in settings.model_dump()
    assert "observability_dotenv" not in settings.model_dump_json()
    assert "http://snap:4318" not in repr(settings)
    assert "http://snap:4318" not in repr(snapshot)
    assert "dotenv-test-only-secret" not in repr(settings)
    assert "dotenv-test-only-secret" not in repr(snapshot)
    assert "dotenv-test-only-secret" not in settings.model_dump_json()
    assert "dotenv-test-only-secret" not in repr(settings.model_dump())


def test_server_settings_observability_dotenv_snapshots_are_independent(tmp_path: Path) -> None:
    first = tmp_path / "first.env"
    first.write_text("OTEL_EXPORTER_OTLP_ENDPOINT=http://first:4318\n")
    second = tmp_path / "second.env"
    second.write_text("OTEL_EXPORTER_OTLP_ENDPOINT=http://second:4318\n")

    settings_first = ServerSettings(_env_file=first)
    settings_second = ServerSettings(_env_file=second)
    settings_none = ServerSettings(_env_file=None)

    assert settings_first.observability_dotenv["OTEL_EXPORTER_OTLP_ENDPOINT"].get_secret_value() == "http://first:4318"
    assert (
        settings_second.observability_dotenv["OTEL_EXPORTER_OTLP_ENDPOINT"].get_secret_value() == "http://second:4318"
    )
    assert settings_none.observability_dotenv == {}


def test_server_settings_observability_dotenv_canonicalizes_names_by_case_sensitivity(tmp_path: Path) -> None:
    dotenv = tmp_path / "otel.env"
    dotenv.write_text("otel_exporter_otlp_endpoint=http://lower:4318\nLOGFIRE_SERVICE_NAME=upper\n")

    insensitive = ServerSettings(_env_file=dotenv)
    assert set(insensitive.observability_dotenv) == {"OTEL_EXPORTER_OTLP_ENDPOINT", "LOGFIRE_SERVICE_NAME"}

    sensitive = ServerSettings(_env_file=dotenv, _case_sensitive=True)
    assert set(sensitive.observability_dotenv) == {"LOGFIRE_SERVICE_NAME"}


@pytest.mark.parametrize(
    "overrides",
    [{"runtime_backend": "local"}, {"e2b_api_key": None}, {"e2b_project_id": " "}, {"inner_api_key": None}],
)
def test_metering_configuration_is_checked_only_by_collection_endpoint(overrides: dict[str, object]) -> None:
    config: dict[str, object] = {
        "sandbox_metering_enabled": True,
        "runtime_backend": "e2b",
        "e2b_api_key": "provider-key",
        "e2b_project_id": "project",
        "inner_api_key": "inner-key",
        "_env_file": None,
    }
    config.update(overrides)
    # Optional accounting must not prevent unrelated runtime startup. Missing
    # project/credentials/backend compatibility are checked by the one-shot route.
    settings = ServerSettings(**config)
    assert settings.sandbox_metering_enabled


def test_metering_defaults_off_and_reads_env_when_explicitly_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    assert not ServerSettings(_env_file=None).sandbox_metering_enabled
    monkeypatch.setenv("DIFY_AGENT_SANDBOX_METERING_ENABLED", "true")
    monkeypatch.setenv("DIFY_AGENT_RUNTIME_BACKEND", "e2b")
    monkeypatch.setenv("DIFY_AGENT_E2B_API_KEY", "provider-key")
    monkeypatch.setenv("DIFY_AGENT_E2B_PROJECT_ID", "project")
    monkeypatch.setenv("DIFY_AGENT_INNER_API_KEY", "inner-key")
    settings = ServerSettings(_env_file=None)
    assert settings.sandbox_metering_enabled
    assert settings.sandbox_metering_max_pages == 1000
    assert settings.sandbox_metering_overlap_seconds == 900


@pytest.mark.parametrize("value", ["0", "-1", "not-a-number"])
@pytest.mark.parametrize("enabled", ["true", "false"])
def test_invalid_optional_metering_number_does_not_block_settings_startup(
    monkeypatch: pytest.MonkeyPatch, value: str, enabled: str
) -> None:
    monkeypatch.setenv("DIFY_AGENT_SANDBOX_METERING_ENABLED", enabled)
    monkeypatch.setenv("DIFY_AGENT_SANDBOX_METERING_MAX_PAGES", value)
    settings = ServerSettings(_env_file=None)
    assert settings.sandbox_metering_max_pages == value
