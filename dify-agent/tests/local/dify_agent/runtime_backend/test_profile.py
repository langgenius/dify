from __future__ import annotations

import base64

import pytest
from pydantic import ValidationError

from dify_agent.runtime_backend.e2b import E2B_MAX_ACTIVE_TIMEOUT_SECONDS
from dify_agent.runtime_backend.profile import DEFAULT_E2B_TEMPLATE, RuntimeBackendSettings


def _secret() -> str:
    return base64.urlsafe_b64encode(b"s" * 32).rstrip(b"=").decode("ascii")


def test_e2b_backend_uses_prepared_dify_template_by_default() -> None:
    settings = RuntimeBackendSettings(runtime_backend="e2b", e2b_api_key="secret")

    assert settings.e2b_template == "difys-default-team/dify-agent-local-sandbox"
    assert settings.e2b_template == DEFAULT_E2B_TEMPLATE
    assert settings.e2b_active_timeout_seconds == E2B_MAX_ACTIVE_TIMEOUT_SECONDS


def test_e2b_backend_requires_api_key() -> None:
    with pytest.raises(ValidationError, match="e2b_api_key"):
        _ = RuntimeBackendSettings(runtime_backend="e2b")


def test_e2b_backend_rejects_active_timeout_above_platform_limit() -> None:
    with pytest.raises(ValidationError, match="less than or equal"):
        _ = RuntimeBackendSettings(
            runtime_backend="e2b",
            e2b_api_key="secret",
            e2b_active_timeout_seconds=E2B_MAX_ACTIVE_TIMEOUT_SECONDS + 1,
        )


def test_local_backend_requires_shellctl_endpoint() -> None:
    with pytest.raises(ValidationError, match="local_sandbox_endpoint"):
        _ = RuntimeBackendSettings(runtime_backend="local")


def test_e2b_s3_requires_uri_http_gateway_and_server_secret() -> None:
    with pytest.raises(ValidationError, match="e2b_s3_uri"):
        _ = RuntimeBackendSettings(
            runtime_backend="e2b_s3",
            e2b_api_key="secret",
            agent_stub_api_base_url="https://agent.example/agent-stub",
            server_secret_key=_secret(),
        )
    with pytest.raises(ValidationError, match="agent_stub_api_base_url"):
        _ = RuntimeBackendSettings(
            runtime_backend="e2b_s3",
            e2b_api_key="secret",
            e2b_s3_uri="s3://bucket/dify-agent",
            server_secret_key=_secret(),
        )
    with pytest.raises(ValidationError, match="http\\(s\\)"):
        _ = RuntimeBackendSettings(
            runtime_backend="e2b_s3",
            e2b_api_key="secret",
            e2b_s3_uri="s3://bucket/dify-agent",
            agent_stub_api_base_url="grpc://agent.example:9091",
            server_secret_key=_secret(),
        )
    with pytest.raises(ValidationError, match="server_secret_key"):
        _ = RuntimeBackendSettings(
            runtime_backend="e2b_s3",
            e2b_api_key="secret",
            e2b_s3_uri="s3://bucket/dify-agent",
            agent_stub_api_base_url="https://agent.example/agent-stub",
        )


def test_e2b_s3_normalizes_uri() -> None:
    settings = RuntimeBackendSettings(
        runtime_backend="e2b_s3",
        e2b_api_key="secret",
        e2b_s3_uri="  s3://bucket/dify-agent?region=us-east-1  ",
        agent_stub_api_base_url="https://agent.example/agent-stub",
        server_secret_key=_secret(),
    )

    assert settings.e2b_s3_uri == "s3://bucket/dify-agent?region=us-east-1"
