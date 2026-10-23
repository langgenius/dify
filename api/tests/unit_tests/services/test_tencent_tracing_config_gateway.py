"""Tencent configuration persistence uses real RSA and bounded protocol checks."""

import json
import os
from dataclasses import dataclass
from typing import Never
from uuid import uuid4

import grpc  # type: ignore[import-untyped]
import pytest
from dify_trace_tencent.configuration import TencentConfigurationError
from sqlalchemy.orm import Session, sessionmaker

from core.ops.ops_trace_manager import OpsTraceManager
from machinery.context import RequestContext
from repositories.app.console_repository import ConsoleAppRepository
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from services.app_tracing_config_gateway import OpsTraceManagerGateway
from services.app_tracing_config_service import (
    AppTracingConfigInvalidConfigurationError,
    AppTracingConfigRecord,
    AppTracingConfigService,
    AppTracingConfigVerificationFailedError,
)
from tests.unit_tests.model_factories import make_app
from tests.unit_tests.services.tracing.test_tencent_configuration import CollectorBoundary
from tests.unit_tests.services.tracing.test_tencent_configuration import (
    _forbid_provider_io as _forbid_provider_io,  # noqa: PLC0414 - Re-export pytest fixtures only in this module.
)
from tests.unit_tests.services.tracing.test_tencent_configuration import (
    collector as collector,  # noqa: PLC0414 - Re-export pytest fixtures only in this module.
)

pytest_plugins = ("tests.unit_tests.services.tracing.test_nullable_tracing_credentials",)


@dataclass
class ConfigurationCase:
    collector: CollectorBoundary
    gateway: OpsTraceManagerGateway
    service: AppTracingConfigService
    store: SQLAlchemyAppTracingConfigRepository
    reader: ConsoleAppRepository
    context: RequestContext
    app_id: str

    def read(self, provider: str = "tencent") -> AppTracingConfigRecord | None:
        return self.store.get(
            workspace_id=self.context.active_workspace_id, app_id=self.app_id, tracing_provider=provider
        )


@pytest.fixture
def case(
    workspace: str, sqlite_session_factory: sessionmaker[Session], collector: CollectorBoundary
) -> ConfigurationCase:
    app_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(
            make_app(
                app_id=app_id,
                tenant_id=workspace,
                tracing=json.dumps(
                    {
                        "enabled": True,
                        "tracing_provider": "langsmith",
                        "capture_content": True,
                        "capture_agent": False,
                    }
                ),
            )
        )
    gateway = OpsTraceManagerGateway()
    store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
    old_config = OpsTraceManager.encrypt_tracing_config(
        workspace,
        "langsmith",
        {"api_key": "synthetic-existing-key", "project": "existing-project", "endpoint": "https://existing.example"},
    )
    assert store.create(workspace_id=workspace, app_id=app_id, tracing_provider="langsmith", tracing_config=old_config)
    return ConfigurationCase(
        collector,
        gateway,
        AppTracingConfigService(configs=store, provider=gateway),
        store,
        ConsoleAppRepository(session_factory=sqlite_session_factory),
        RequestContext("request", None, "account", workspace),
        app_id,
    )


def test_post_get_masked_patch_persist_normalization_and_preserve_real_ciphertext(case: ConfigurationCase) -> None:
    secret = "synthetic-private-tencent-token"
    old_provider = case.read("langsmith")
    submitted = {"token": secret, "endpoint": " HTTPS://FIRST.Example:4320/ ", "service_name": " first-app "}
    original_submission = dict(submitted)

    case.service.create(case.context, case.app_id, "tencent", submitted, activate=True)

    before = case.read()
    assert before is not None
    assert before.tracing_config is not None
    config = before.tracing_config
    assert config["token"] != secret
    assert config["endpoint"] == "https://first.example:4320"
    assert config["service_name"] == "first-app"
    assert config["project_url"] == "https://console.cloud.tencent.com/apm"
    assert (
        OpsTraceManager.decrypt_tracing_config(case.context.active_workspace_id, "tencent", config)["token"] == secret
    )
    assert submitted == original_submission
    assert len(case.collector.channels) == 1
    assert case.collector.channels[0].calls[0].metadata == (("authorization", f"Bearer {secret}"),)
    policy = case.reader.get_trace(case.context, case.app_id)
    assert policy.enabled is True
    assert policy.tracing_provider == "tencent"
    assert policy.capture_content is True
    assert policy.capture_agent is False
    assert case.read("langsmith") == old_provider

    presented = case.service.get(case.context, case.app_id, "tencent")
    assert presented is not None
    assert presented.tracing_config is not None
    masked = presented.tracing_config["token"]
    assert isinstance(masked, str)
    assert masked != secret
    assert "*" in masked
    assert presented.tracing_config["project_url"] == "https://console.cloud.tencent.com/apm"
    assert len(case.collector.channels) == 1

    replacement = {"token": masked, "endpoint": " http://SECOND.Example:4319/ ", "service_name": " second-app "}
    original_replacement = dict(replacement)
    case.service.update(case.context, case.app_id, "tencent", replacement, activate=True)

    after = case.read()
    assert after is not None
    assert after.tracing_config is not None
    assert after.tracing_config["token"] == config["token"]
    assert after.tracing_config["endpoint"] == "http://second.example:4319"
    assert after.tracing_config["service_name"] == "second-app"
    assert after.tracing_config["project_url"] == "https://console.cloud.tencent.com/apm"
    assert replacement == original_replacement
    assert len(case.collector.channels) == 2
    channel = case.collector.channels[-1]
    assert channel.target == "second.example:4319"
    assert channel.secure is False
    assert channel.calls[0].metadata == (("authorization", f"Bearer {secret}"),)
    assert all(channel.close_count == 1 for channel in case.collector.channels)
    case.gateway.validate_saved_config(
        workspace_id=case.context.active_workspace_id, tracing_provider="tencent", tracing_config=after.tracing_config
    )
    assert case.service.get(case.context, case.app_id, "tencent") is not None
    assert len(case.collector.channels) == 2
    assert case.read("langsmith") == old_provider


@pytest.mark.parametrize("saved_url", [None, "https://wrong.example/previous-project"])
def test_historical_name_remains_readable_and_saved_validation_does_not_connect(
    case: ConfigurationCase, saved_url: str | None
) -> None:
    stored = OpsTraceManager.encrypt_tracing_config(
        case.context.active_workspace_id,
        "tencent",
        {"token": "synthetic-historical-token", "endpoint": "https://legacy.example:4320", "service_name": "dify_app"},
    )
    if saved_url is not None:
        stored["project_url"] = saved_url
    assert case.store.create(
        workspace_id=case.context.active_workspace_id,
        app_id=case.app_id,
        tracing_provider="tencent",
        tracing_config=stored,
    )
    before = case.read()
    before_policy = case.reader.get_trace(case.context, case.app_id)

    presented = case.service.get(case.context, case.app_id, "tencent")
    case.gateway.validate_saved_config(
        workspace_id=case.context.active_workspace_id, tracing_provider="tencent", tracing_config=stored
    )

    assert presented is not None
    assert presented.tracing_config is not None
    assert presented.tracing_config["service_name"] == "dify_app"
    assert presented.tracing_config["project_url"] == "https://console.cloud.tencent.com/apm"
    assert presented.tracing_config["token"] != "synthetic-historical-token"
    assert "*" in presented.tracing_config["token"]
    assert case.collector.channels == []
    assert case.read() == before
    assert case.reader.get_trace(case.context, case.app_id) == before_policy


@pytest.mark.parametrize("existing", [False, True])
@pytest.mark.parametrize(
    ("field_name", "invalid_value", "error_code"),
    [
        ("service_name", "dify_app", "invalid_service_name"),
        ("service_name", "", "invalid_service_name"),
        ("endpoint", "https://collector.example:4320/v1/traces", "invalid_endpoint"),
        ("endpoint", "https://collector.example:4320?token=private-endpoint-detail", "invalid_endpoint"),
        ("endpoint", "https://", "invalid_endpoint"),
    ],
)
def test_invalid_create_or_patch_rejects_before_rpc_encryption_or_persistence(
    case: ConfigurationCase,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    existing: bool,
    field_name: str,
    invalid_value: str,
    error_code: str,
) -> None:
    original = {
        "token": "synthetic-private-token",
        "endpoint": "https://original.example:4320",
        "service_name": "original-app",
    }
    if existing:
        case.service.create(case.context, case.app_id, "tencent", original)
    case.collector.channels.clear()
    before = case.read()
    old_provider = case.read("langsmith")
    before_policy = case.reader.get_trace(case.context, case.app_id)
    forbidden_attempts: list[str] = []

    def forbidden(*_args: object, **_kwargs: object) -> Never:
        forbidden_attempts.append("encryption_or_write")
        raise AssertionError("Invalid new input must fail before encryption or persistence")

    monkeypatch.setattr(OpsTraceManager, "encrypt_tracing_config", forbidden)
    monkeypatch.setattr(case.store, "create", forbidden)
    monkeypatch.setattr(case.store, "update", forbidden)
    operation = case.service.update if existing else case.service.create
    with pytest.raises(AppTracingConfigInvalidConfigurationError) as caught:
        operation(case.context, case.app_id, "tencent", {**original, field_name: invalid_value}, activate=True)

    assert isinstance(caught.value.__cause__, TencentConfigurationError)
    assert caught.value.__cause__.code == error_code
    assert forbidden_attempts == []
    assert case.collector.channels == []
    assert case.read() == before
    assert case.read("langsmith") == old_provider
    assert case.reader.get_trace(case.context, case.app_id) == before_policy
    assert "synthetic-private-token" not in caplog.text
    assert "private-endpoint-detail" not in caplog.text


@pytest.mark.parametrize("existing", [False, True])
@pytest.mark.parametrize("endpoint", ["https://collector.example:4320", "http://localhost:4317"])
def test_rpc_failure_never_saves_or_activates_even_for_localhost(
    case: ConfigurationCase, caplog: pytest.LogCaptureFixture, existing: bool, endpoint: str
) -> None:
    secret = "synthetic-private-token"
    original = {"token": secret, "endpoint": "https://original.example:4320", "service_name": "original-app"}
    if existing:
        case.service.create(case.context, case.app_id, "tencent", original)
    case.collector.channels.clear()
    before = case.read()
    old_provider = case.read("langsmith")
    before_policy = case.reader.get_trace(case.context, case.app_id)
    case.collector.failure = grpc.RpcError("private-provider-details synthetic-private-token")
    operation = case.service.update if existing else case.service.create

    with pytest.raises(AppTracingConfigVerificationFailedError) as caught:
        operation(
            case.context,
            case.app_id,
            "tencent",
            {"token": "******" if existing else secret, "endpoint": endpoint, "service_name": "changed-app"},
            activate=True,
        )

    assert isinstance(caught.value.__cause__, TencentConfigurationError)
    assert caught.value.__cause__.code == "connection_failed"
    assert len(case.collector.channels) == 1
    channel = case.collector.channels[0]
    assert channel.close_count == 1
    assert len(channel.calls) == 1
    assert channel.calls[0].metadata == (("authorization", f"Bearer {secret}"),)
    assert case.read() == before
    assert case.read("langsmith") == old_provider
    assert case.reader.get_trace(case.context, case.app_id) == before_policy
    assert "connection_failed" in caplog.text
    assert "private-provider-details" not in caplog.text
    assert secret not in caplog.text
    assert secret not in str(caught.value)
    assert secret not in str(caught.value.__cause__)


def test_explicit_configuration_ignores_and_preserves_otel_environment(
    case: ConfigurationCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    environment = {
        "OTEL_EXPORTER_OTLP_ENDPOINT": "http://ambient.example:4317",
        "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": "http://ambient-traces.example:4317",
        "OTEL_EXPORTER_OTLP_HEADERS": "authorization=Bearer unrelated-token",
        "OTEL_EXPORTER_OTLP_TRACES_HEADERS": "authorization=Bearer unrelated-traces-token",
        "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
        "OTEL_SERVICE_NAME": "unrelated-service",
        "OTEL_RESOURCE_ATTRIBUTES": "token=unrelated-resource-token,service.name=ambient-app",
    }
    for key, value in environment.items():
        monkeypatch.setenv(key, value)

    case.service.create(
        case.context,
        case.app_id,
        "tencent",
        {"token": "explicit-token", "endpoint": "https://explicit.example:4320", "service_name": "explicit-app"},
    )

    assert len(case.collector.channels) == 1
    channel = case.collector.channels[0]
    assert channel.target == "explicit.example:4320"
    assert channel.secure is True
    assert channel.calls[0].metadata == (("authorization", "Bearer explicit-token"),)
    assert channel.calls[0].request.SerializeToString() == b""
    assert channel.close_count == 1
    presented = case.service.get(case.context, case.app_id, "tencent")
    assert presented is not None
    assert presented.tracing_config is not None
    assert presented.tracing_config["service_name"] == "explicit-app"
    assert len(case.collector.channels) == 1
    assert {key: os.environ.get(key) for key in environment} == environment
