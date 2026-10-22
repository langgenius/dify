"""Real RSA/SQL/controller Aliyun configuration through a recorded HTTP boundary."""

import inspect
import json
import traceback
from dataclasses import dataclass, field, replace
from typing import Never
from urllib.parse import quote
from uuid import UUID, uuid4

import httpx
import pytest
from dify_trace_aliyun.aliyun_trace import AliyunDataTrace
from flask import Flask
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from sqlalchemy.orm import Session, sessionmaker

from controllers.console.app import ops_trace as controller
from controllers.console.app.error import InvalidTracingConfigError
from core.helper import ssrf_proxy
from core.ops.ops_trace_manager import OpsTraceManager
from extensions.ext_application_services import ApplicationServices
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

pytest_plugins = ("tests.unit_tests.services.tracing.test_nullable_tracing_credentials",)


@dataclass
class AliyunCase:
    gateway: OpsTraceManagerGateway
    service: AppTracingConfigService
    store: SQLAlchemyAppTracingConfigRepository
    reader: ConsoleAppRepository
    context: RequestContext
    app_id: str
    verification_calls: list[tuple[str, dict[str, object]]] = field(default_factory=list)
    verification_succeeds: bool = True

    def read(self, provider: str = "aliyun") -> AppTracingConfigRecord | None:
        return self.store.get(
            workspace_id=self.context.active_workspace_id, app_id=self.app_id, tracing_provider=provider
        )


@pytest.fixture
def case(workspace: str, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> AliyunCase:
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
    old = OpsTraceManager.encrypt_tracing_config(
        workspace, "langsmith", {"api_key": "synthetic-other", "project": "other", "endpoint": "https://other.test"}
    )
    assert store.create(workspace_id=workspace, app_id=app_id, tracing_provider="langsmith", tracing_config=old)
    result = AliyunCase(
        gateway,
        AppTracingConfigService(configs=store, provider=gateway),
        store,
        ConsoleAppRepository(session_factory=sqlite_session_factory),
        RequestContext("request", None, "account", workspace),
        app_id,
    )

    def verification_boundary(method: str, url: str, **options: object) -> httpx.Response:
        assert method == "POST"
        content = options["content"]
        assert isinstance(content, bytes)
        payload = ExportTraceServiceRequest.FromString(content)
        assert len(payload.resource_spans) == 1
        assert len(payload.resource_spans[0].scope_spans) == 0
        assert [attribute.key for attribute in payload.resource_spans[0].resource.attributes] == ["service.name"]
        result.verification_calls.append((url, dict(options)))
        status = 200 if result.verification_succeeds else 403
        return httpx.Response(status, content=b'"success"', request=httpx.Request(method, url))

    def forbidden(*_args: object, **_kwargs: object) -> Never:
        raise AssertionError("Configuration must not initialize a legacy exporter or fetch its console link")

    monkeypatch.setattr(ssrf_proxy, "make_request", verification_boundary)
    monkeypatch.setattr(OpsTraceManager, "check_trace_config_is_effective", forbidden)
    monkeypatch.setattr(OpsTraceManager, "get_trace_config_project_url", forbidden)
    monkeypatch.setattr(AliyunDataTrace, "__init__", forbidden)
    return result


def test_post_masked_patch_and_get_preserve_real_ciphertext_and_policy(case: AliyunCase) -> None:
    other = case.read("langsmith")
    submitted = {
        "endpoint": " HTTP://TRACING-ANALYSIS-DC-QD.ALIYUNCS.COM/reverse/ ",
        "app_name": " 中文 app_Name ",
        "license_key": "literal%2F@synthetic",
    }
    original = dict(submitted)
    case.service.create(case.context, case.app_id, "aliyun", submitted, activate=True)
    before = case.read()
    assert before is not None
    assert before.tracing_config is not None
    stored = before.tracing_config
    assert submitted == original
    assert stored["endpoint"] == "http://tracing-analysis-dc-qd.aliyuncs.com/reverse"
    assert stored["app_name"] == "中文 app_Name"
    assert stored["license_key"] != submitted["license_key"]
    assert OpsTraceManager.decrypt_tracing_config(case.context.active_workspace_id, "aliyun", stored)[
        "license_key"
    ] == ("literal%2F@synthetic")
    shown = case.service.get(case.context, case.app_id, "aliyun")
    assert shown is not None
    assert shown.tracing_config is not None
    masked = shown.tracing_config["license_key"]
    assert isinstance(masked, str)
    assert "*" in masked
    assert masked != submitted["license_key"]
    assert shown.tracing_config["project_url"] == "https://arms.console.aliyun.com/#/llm"
    assert len(case.verification_calls) == 1
    case.service.update(
        case.context,
        case.app_id,
        "aliyun",
        {
            "endpoint": "https://project.region.log.aliyuncs.com/prefix/",
            "app_name": " second_app ",
            "license_key": masked,
        },
    )
    after = case.read()
    assert after is not None
    assert after.tracing_config is not None
    assert after.tracing_config["license_key"] == stored["license_key"]
    assert after.tracing_config["app_name"] == "second_app"
    assert after.tracing_config["endpoint"] == "https://project.region.log.aliyuncs.com/prefix"
    assert case.verification_calls[-1][0] == (
        "https://project.region.log.aliyuncs.com/prefix/adapt_literal%252F@synthetic/api/v1/traces"
    )
    assert case.service.get(case.context, case.app_id, "aliyun") is not None
    assert len(case.verification_calls) == 2
    assert case.read("langsmith") == other
    policy = case.reader.get_trace(case.context, case.app_id)
    assert policy.tracing_provider == "aliyun"
    assert policy.enabled
    assert policy.capture_content is True
    assert policy.capture_agent is False


@pytest.mark.parametrize("update", [False, True])
@pytest.mark.parametrize("failure", ["invalid-schema", "verification-failed"])
def test_failed_save_preserves_rows_and_active_policy(case: AliyunCase, update: bool, failure: str) -> None:
    original = {"endpoint": "https://host.test", "app_name": "original", "license_key": "synthetic-secret"}
    if update:
        case.service.create(case.context, case.app_id, "aliyun", original)
    before, other, policy = case.read(), case.read("langsmith"), case.reader.get_trace(case.context, case.app_id)
    submitted = {**original, "app_name": "changed"}
    if failure == "invalid-schema":
        submitted["endpoint"] = "https://host.test/adapt_DO-NOT-PERSIST/api/otlp/traces"
        expected = AppTracingConfigInvalidConfigurationError
    else:
        case.verification_succeeds = False
        expected = AppTracingConfigVerificationFailedError
    save = case.service.update if update else case.service.create
    if update:
        submitted["license_key"] = "******"
    with pytest.raises(expected):
        save(case.context, case.app_id, "aliyun", submitted, activate=True)
    assert case.read() == before
    assert case.read("langsmith") == other
    assert case.reader.get_trace(case.context, case.app_id) == policy


@pytest.mark.parametrize("cached_url", [None, "https://wrong.test/stale"])
def test_historical_get_is_pure_even_for_a_now_invalid_ingestion_url(case: AliyunCase, cached_url: str | None) -> None:
    stored = OpsTraceManager.encrypt_tracing_config(
        case.context.active_workspace_id,
        "aliyun",
        {
            "endpoint": "https://host.test/adapt_old/api/otlp/traces",
            "app_name": "historical_name",
            "license_key": "synthetic-key",
        },
    )
    if cached_url:
        stored["project_url"] = cached_url
    before = dict(stored)
    result = case.gateway.present_config(
        workspace_id=case.context.active_workspace_id, tracing_provider="aliyun", tracing_config=stored
    )
    assert result["project_url"] == "https://arms.console.aliyun.com/#/llm"
    assert isinstance(result["license_key"], str)
    assert "*" in result["license_key"]
    assert stored == before
    assert case.verification_calls == []


@pytest.mark.parametrize("update", [False, True])
@pytest.mark.parametrize("encoded", [False, True])
def test_controller_rejects_embedded_license_without_echo_or_state_change(
    case: AliyunCase,
    app: Flask,
    account_application_services: ApplicationServices,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    update: bool,
    encoded: bool,
) -> None:
    old_key = "SYNTHETIC_OLD_LICENSE"
    original = {"endpoint": "https://host.test", "app_name": "old-app", "license_key": old_key}
    if update:
        case.service.create(case.context, case.app_id, "aliyun", original, activate=True)
    before, other, policy = case.read(), case.read("langsmith"), case.reader.get_trace(case.context, case.app_id)
    before_checks = len(case.verification_calls)
    services = replace(account_application_services, app_tracing_configs=case.service)
    monkeypatch.setattr(controller, "application_services", lambda: services)
    key = "SYNTHETIC_PRIVATE_LICENSE@+/%2F"
    url_key = quote(key, safe="") if encoded else key
    payload = controller.TraceConfigPayload(
        tracing_provider="aliyun",
        tracing_config={
            "endpoint": f"https://host.test/adapt_{url_key}/api/otlp/traces",
            "app_name": "should-not-save",
            "license_key": "******" if update else key,
        },
        activate=True,
    )
    save = inspect.unwrap(controller.TraceAppConfigApi.patch if update else controller.TraceAppConfigApi.post)
    with app.test_request_context(), pytest.raises(InvalidTracingConfigError) as caught:
        save(controller.TraceAppConfigApi(), payload, case.context, UUID(case.app_id))
    # The real controller exposes this fixed BaseHTTPException body. Neither
    # Pydantic inputs nor a credential-bearing exception chain reaches it.
    assert caught.value.data == {
        "code": "invalid_tracing_config",
        "message": "The tracing configuration is invalid.",
        "status": 400,
    }
    rendered = json.dumps(caught.value.data) + str(caught.value) + repr(caught.value)
    rendered += "".join(traceback.format_exception(caught.value)) + caplog.text
    assert key not in rendered
    assert quote(key, safe="") not in rendered
    assert old_key not in rendered
    assert case.read() == before
    assert case.read("langsmith") == other
    assert case.reader.get_trace(case.context, case.app_id) == policy
    assert len(case.verification_calls) == before_checks
