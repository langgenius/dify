import importlib as _test_importlib
import inspect
import json
import os
import traceback
from collections import deque
from collections.abc import Callable, Iterator, Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from functools import partial
from typing import Never
from unittest.mock import MagicMock, patch
from urllib.parse import quote
from uuid import UUID, uuid4

import grpc  # type: ignore[import-untyped]
import httpx
import mlflow
import opik
import pytest
import wandb
import weave
from dify_trace_aliyun.aliyun_trace import AliyunDataTrace
from dify_trace_arize_phoenix import arize_configuration
from dify_trace_arize_phoenix.arize_configuration import DESTINATION_KEY
from dify_trace_arize_phoenix.config import ArizeConfig
from dify_trace_arize_phoenix.configuration import PhoenixConfigurationError
from dify_trace_mlflow.configuration import DatabricksConfigurationError
from dify_trace_mlflow.mlflow_trace import MLflowDataTrace
from dify_trace_mlflow.oss_configuration import MLflowConfigurationError
from dify_trace_opik.configuration import OpikConfigurationError
from dify_trace_opik.opik_trace import OpikDataTrace
from dify_trace_tencent.configuration import TencentConfigurationError
from dify_trace_weave.configuration import WeaveConfigurationError
from dify_trace_weave.weave_trace import WeaveDataTrace
from flask import Flask
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opik.config import OpikConfig as SDKOpikConfig
from pydantic import ValidationInfo, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from controllers.console.app import ops_trace as controller
from controllers.console.app.error import InvalidTracingConfigError
from core.helper import ssrf_proxy
from core.ops import ops_trace_manager
from core.ops.entities.config_entity import BaseTracingConfig, TracingProviderEnum
from core.ops.exceptions import TraceProviderNotInstalledError
from core.ops.ops_trace_manager import OpsTraceManager, TracingProviderConfigEntry
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from extensions.ext_application_services import ApplicationServices
from machinery.context import RequestContext
from models.application_trace import ApplicationTraceRun
from models.enums import ConversationFromSource
from models.model import App, AppMode
from repositories.app.console_repository import ConsoleAppRepository
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from repositories.application_trace_repository import ApplicationTraceRepository
from services import app_tracing_config_gateway as gateway_module
from services.app_tracing_config_gateway import OpsTraceManagerGateway
from services.app_tracing_config_service import (
    AppTracingConfigInvalidConfigurationError,
    AppTracingConfigInvalidProviderError,
    AppTracingConfigProcessingError,
    AppTracingConfigProviderUnavailableError,
    AppTracingConfigRecord,
    AppTracingConfigService,
    AppTracingConfigVerificationFailedError,
)
from services.tracing.provider_dispatch import export_trace, frozen_project_url
from services.tracing.service import ApplicationTracingService
from tests.helpers.unit.model_factories import make_app, make_message

pytest_plugins = ("tests.unit_tests.core.ops.test_ops_trace_manager",)

"""Real RSA/SQL/controller Aliyun configuration through a recorded HTTP boundary."""


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


class TestAliyunTracingConfigGatewayCases:
    @staticmethod
    @pytest.fixture
    def case(
        workspace: str, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
    ) -> AliyunCase:
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
    @pytest.mark.parametrize("cached_url", [None, "https://wrong.test/stale"])
    def test_historical_get_is_pure_even_for_a_now_invalid_ingestion_url(
        case: AliyunCase, cached_url: str | None
    ) -> None:
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

    @staticmethod
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
        with app.test_request_context():
            with pytest.raises(InvalidTracingConfigError) as caught:
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


class _ProviderConfig(BaseTracingConfig):
    endpoint: str = "https://default.example.com"
    project: str = "default-project"

    @field_validator("endpoint", "project", mode="before")
    @classmethod
    def replace_empty_with_default(cls, value: object, info: ValidationInfo) -> object:
        if value != "":
            return value
        if info.field_name == "endpoint":
            return "https://default.example.com"
        return "default-project"


def _provider_entry(*, other_keys: list[str] | None = None) -> TracingProviderConfigEntry:
    return {
        "config_class": _ProviderConfig,
        "secret_keys": ["api_key"],
        "other_keys": other_keys or [],
        "trace_instance": object,
    }


class TestAppTracingConfigGatewayCases:
    @staticmethod
    def test_validate_provider_rejects_unknown_provider(monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(gateway_module, "provider_config_map", {})

        with pytest.raises(AppTracingConfigInvalidProviderError, match="Invalid tracing provider: unknown"):
            OpsTraceManagerGateway().validate_provider("unknown")

    @staticmethod
    @pytest.mark.parametrize("provider", TracingProviderEnum)
    def test_validate_provider_does_not_load_optional_dependencies(provider: TracingProviderEnum) -> None:
        with patch.object(OpsTraceManagerGateway, "_provider_config") as load_provider:
            OpsTraceManagerGateway().validate_provider(provider.value)

        load_provider.assert_not_called()

    @staticmethod
    def test_require_provider_available_loads_provider_dependencies() -> None:
        with patch.object(OpsTraceManagerGateway, "_provider_config") as load_provider:
            OpsTraceManagerGateway().require_provider_available("weave")

        load_provider.assert_called_once_with("weave")

    @staticmethod
    def test_require_provider_available_reports_missing_dependency() -> None:
        unavailable = AppTracingConfigProviderUnavailableError()
        with (
            patch.object(OpsTraceManagerGateway, "_provider_config", side_effect=unavailable),
            pytest.raises(AppTracingConfigProviderUnavailableError) as caught,
        ):
            OpsTraceManagerGateway().require_provider_available("weave")

        assert caught.value is unavailable

    @staticmethod
    @pytest.mark.parametrize("update", [False, True])
    def test_prepare_config_reports_missing_provider_dependencies(
        monkeypatch: pytest.MonkeyPatch, update: bool
    ) -> None:
        missing_dependency = TraceProviderNotInstalledError("weave", "wandb")
        providers = MagicMock()
        providers.__getitem__.side_effect = missing_dependency
        monkeypatch.setattr(gateway_module, "provider_config_map", providers)
        gateway = OpsTraceManagerGateway()
        prepare = (
            partial(gateway.prepare_updated_config, current_tracing_config={}) if update else gateway.prepare_new_config
        )

        with pytest.raises(AppTracingConfigProviderUnavailableError) as caught:
            prepare(workspace_id="workspace-1", tracing_provider="weave", tracing_config={})

        assert caught.value.__cause__ is missing_dependency

    @staticmethod
    def test_present_config_reports_missing_provider_dependencies() -> None:
        missing_dependency = TraceProviderNotInstalledError("weave", "wandb")
        with patch.object(gateway_module, "OpsTraceManager") as manager:
            manager.decrypt_tracing_config.side_effect = missing_dependency

            with pytest.raises(AppTracingConfigProviderUnavailableError) as caught:
                OpsTraceManagerGateway().present_config(
                    workspace_id="workspace-1", tracing_provider="weave", tracing_config={"api_key": "encrypted"}
                )

        assert caught.value.__cause__ is missing_dependency
        manager.obfuscated_decrypt_token.assert_not_called()

    @staticmethod
    def test_prepare_new_config_applies_defaults_validates_and_encrypts(monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            gateway_module,
            "provider_config_map",
            {"langsmith": _provider_entry(other_keys=["endpoint", "project"])},
        )
        submitted = {"api_key": "plain", "endpoint": "", "project": ""}

        with patch.object(gateway_module, "OpsTraceManager") as manager:
            manager.check_trace_config_is_effective.return_value = True
            manager.get_trace_config_project_url.return_value = "https://project.example.com"
            manager.encrypt_tracing_config.return_value = {"api_key": "encrypted"}

            result = OpsTraceManagerGateway().prepare_new_config(
                workspace_id="workspace-1",
                tracing_provider="langsmith",
                tracing_config=submitted,
            )

        normalized = {
            "api_key": "plain",
            "endpoint": "https://default.example.com",
            "project": "default-project",
        }
        assert submitted == {"api_key": "plain", "endpoint": "", "project": ""}
        assert result == {"api_key": "encrypted", "project_url": "https://project.example.com"}
        manager.check_trace_config_is_effective.assert_called_once_with(normalized, "langsmith")
        manager.encrypt_tracing_config.assert_called_once_with("workspace-1", "langsmith", normalized)

    @staticmethod
    def test_prepare_new_config_reports_failed_verification_before_encryption(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(gateway_module, "provider_config_map", {"langsmith": _provider_entry()})

        with patch.object(gateway_module, "OpsTraceManager") as manager:
            manager.check_trace_config_is_effective.return_value = False

            with pytest.raises(AppTracingConfigVerificationFailedError):
                OpsTraceManagerGateway().prepare_new_config(
                    workspace_id="workspace-1",
                    tracing_provider="langsmith",
                    tracing_config={"api_key": "plain"},
                )

        manager.encrypt_tracing_config.assert_not_called()

    @staticmethod
    def test_prepare_new_config_keeps_success_when_project_url_lookup_fails(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(gateway_module, "provider_config_map", {"langsmith": _provider_entry()})

        with patch.object(gateway_module, "OpsTraceManager") as manager:
            manager.check_trace_config_is_effective.return_value = True
            manager.get_trace_config_project_url.side_effect = RuntimeError("provider unavailable")
            manager.encrypt_tracing_config.return_value = {"api_key": "encrypted"}

            result = OpsTraceManagerGateway().prepare_new_config(
                workspace_id="workspace-1",
                tracing_provider="langsmith",
                tracing_config={"api_key": "plain"},
            )

        assert result == {"api_key": "encrypted"}

    @staticmethod
    def test_prepare_new_langfuse_config_builds_project_url(monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(gateway_module, "provider_config_map", {"langfuse": _provider_entry()})

        with patch.object(gateway_module, "OpsTraceManager") as manager:
            manager.check_trace_config_is_effective.return_value = True
            manager.get_trace_config_project_key.return_value = "project-key"
            manager.encrypt_tracing_config.return_value = {"secret_key": "encrypted"}

            result = OpsTraceManagerGateway().prepare_new_config(
                workspace_id="workspace-1",
                tracing_provider="langfuse",
                tracing_config={"host": "https://langfuse.example.com"},
            )

        assert result["project_url"] == "https://langfuse.example.com/project/project-key"

    @staticmethod
    def test_prepare_new_config_reports_provider_check_exception_as_failed_verification(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(gateway_module, "provider_config_map", {"langsmith": _provider_entry()})

        with patch.object(gateway_module, "OpsTraceManager") as manager:
            manager.check_trace_config_is_effective.side_effect = ValueError("verification failed")

            with pytest.raises(AppTracingConfigVerificationFailedError) as caught:
                OpsTraceManagerGateway().prepare_new_config(
                    workspace_id="workspace-1",
                    tracing_provider="langsmith",
                    tracing_config={},
                )

        assert isinstance(caught.value.__cause__, ValueError)

    @staticmethod
    def test_prepare_new_config_propagates_unexpected_verification_failure(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(gateway_module, "provider_config_map", {"langsmith": _provider_entry()})
        failure = RuntimeError("unexpected provider bug")

        with patch.object(gateway_module, "OpsTraceManager") as manager:
            manager.check_trace_config_is_effective.side_effect = failure

            with pytest.raises(RuntimeError) as caught:
                OpsTraceManagerGateway().prepare_new_config(
                    workspace_id="workspace-1",
                    tracing_provider="langsmith",
                    tracing_config={},
                )

        assert caught.value is failure
        manager.encrypt_tracing_config.assert_not_called()

    @staticmethod
    def test_prepare_new_config_rejects_invalid_schema_before_verification(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(gateway_module, "provider_config_map", {"langsmith": _provider_entry()})

        with patch.object(gateway_module, "OpsTraceManager") as manager:
            with pytest.raises(AppTracingConfigInvalidConfigurationError):
                OpsTraceManagerGateway().prepare_new_config(
                    workspace_id="workspace-1",
                    tracing_provider="langsmith",
                    tracing_config={"endpoint": {"invalid": "value"}},
                )

        manager.check_trace_config_is_effective.assert_not_called()
        manager.encrypt_tracing_config.assert_not_called()

    @staticmethod
    def test_prepare_new_config_reports_encryption_failure_as_processing_error(monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(gateway_module, "provider_config_map", {"langsmith": _provider_entry()})
        failure = RuntimeError("key provider unavailable")

        with patch.object(gateway_module, "OpsTraceManager") as manager:
            manager.check_trace_config_is_effective.return_value = True
            manager.get_trace_config_project_url.return_value = None
            manager.encrypt_tracing_config.side_effect = failure

            with pytest.raises(AppTracingConfigProcessingError) as caught:
                OpsTraceManagerGateway().prepare_new_config(
                    workspace_id="workspace-1",
                    tracing_provider="langsmith",
                    tracing_config={},
                )

        assert caught.value.__cause__ is failure

    @staticmethod
    def test_prepare_updated_config_preserves_masked_secret_from_current_config(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(gateway_module, "provider_config_map", {"langsmith": _provider_entry()})
        submitted = {"api_key": "******", "project": "new-project"}
        current = {"api_key": "old-encrypted", "project": "old-project"}
        encrypted = {"api_key": "old-encrypted", "project": "new-project"}
        decrypted = {"api_key": "old-plain", "project": "new-project"}

        with patch.object(gateway_module, "OpsTraceManager") as manager:
            manager.encrypt_tracing_config.return_value = encrypted
            manager.decrypt_tracing_config.return_value = decrypted
            manager.check_trace_config_is_effective.return_value = True
            manager.get_trace_config_project_url.return_value = "https://example.com/project/new"

            result = OpsTraceManagerGateway().prepare_updated_config(
                workspace_id="workspace-1",
                tracing_provider="langsmith",
                tracing_config=submitted,
                current_tracing_config=current,
            )

        assert result == encrypted
        assert result["project_url"] == "https://example.com/project/new"
        assert submitted == {"api_key": "******", "project": "new-project"}
        manager.encrypt_tracing_config.assert_called_once_with("workspace-1", "langsmith", submitted, current)
        manager.decrypt_tracing_config.assert_called_once_with("workspace-1", "langsmith", encrypted)
        manager.check_trace_config_is_effective.assert_called_once_with(decrypted, "langsmith")
        manager.get_trace_config_project_url.assert_called_once_with(decrypted, "langsmith")

    @staticmethod
    def test_updated_destination_drops_old_project_when_lookup_fails(monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(gateway_module, "provider_config_map", {"langsmith": _provider_entry()})
        with patch.object(gateway_module, "OpsTraceManager") as manager:
            manager.encrypt_tracing_config.return_value = {"api_key": "encrypted", "project": "new-project"}
            manager.decrypt_tracing_config.return_value = {"api_key": "plain", "project": "new-project"}
            manager.check_trace_config_is_effective.return_value = True
            manager.get_trace_config_project_url.side_effect = RuntimeError("metadata unavailable")
            result = OpsTraceManagerGateway().prepare_updated_config(
                workspace_id="workspace-1",
                tracing_provider="langsmith",
                tracing_config={"project": "new-project"},
                current_tracing_config={"project_url": "https://example.com/project/old", "api_key": "encrypted"},
            )
        assert "project_url" not in result

    @staticmethod
    def test_prepare_updated_config_validates_schema_before_encryption(monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(gateway_module, "provider_config_map", {"langsmith": _provider_entry()})

        with patch.object(gateway_module, "OpsTraceManager") as manager:
            with pytest.raises(AppTracingConfigInvalidConfigurationError):
                OpsTraceManagerGateway().prepare_updated_config(
                    workspace_id="workspace-1",
                    tracing_provider="langsmith",
                    tracing_config={"endpoint": {"invalid": "value"}},
                    current_tracing_config={"api_key": "old-encrypted"},
                )

        manager.encrypt_tracing_config.assert_not_called()
        manager.decrypt_tracing_config.assert_not_called()
        manager.check_trace_config_is_effective.assert_not_called()

    @staticmethod
    def test_prepare_updated_config_reports_decryption_failure_as_processing_error(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(gateway_module, "provider_config_map", {"langsmith": _provider_entry()})
        failure = RuntimeError("stored credential cannot be decrypted")

        with patch.object(gateway_module, "OpsTraceManager") as manager:
            manager.encrypt_tracing_config.return_value = {"api_key": "encrypted"}
            manager.decrypt_tracing_config.side_effect = failure

            with pytest.raises(AppTracingConfigProcessingError) as caught:
                OpsTraceManagerGateway().prepare_updated_config(
                    workspace_id="workspace-1",
                    tracing_provider="langsmith",
                    tracing_config={"project": "new-project"},
                    current_tracing_config={"api_key": "old-encrypted"},
                )

        assert caught.value.__cause__ is failure
        manager.check_trace_config_is_effective.assert_not_called()

    @staticmethod
    @pytest.mark.parametrize(
        ("provider", "fallback_url"),
        [
            ("arize", None),
            ("phoenix", "https://app.phoenix.arize.com/redirects/projects/default"),
            ("langsmith", "https://smith.langchain.com/"),
            ("opik", "https://www.comet.com/opik/"),
            ("weave", "https://wandb.ai/"),
            ("aliyun", "https://arms.console.aliyun.com/#/llm"),
            ("tencent", "https://console.cloud.tencent.com/apm"),
            ("mlflow", "http://localhost:5000/#/experiments/0/traces"),
            ("databricks", "https://www.databricks.com/"),
        ],
    )
    def test_present_config_uses_provider_fallback_when_project_lookup_fails(
        provider: str,
        fallback_url: str | None,
    ) -> None:
        with patch.object(gateway_module, "OpsTraceManager") as manager:
            decrypted_config: dict[str, object] = {}
            presented_config: dict[str, object] = {}
            manager.decrypt_tracing_config.return_value = decrypted_config
            manager.obfuscated_decrypt_token.return_value = presented_config
            manager.get_trace_config_project_url.side_effect = RuntimeError("provider unavailable")

            result = OpsTraceManagerGateway().present_config(
                workspace_id="workspace-1",
                tracing_provider=provider,
                tracing_config={"encrypted": "config"},
            )

            assert result == {"project_url": fallback_url}
            if provider in {"arize", "aliyun", "mlflow", "phoenix"}:
                # Provider defaults produce a pure link; the failing legacy lookup is
                # deliberately not reached, even when no cached URL is present.
                manager.get_trace_config_project_url.assert_not_called()

    @staticmethod
    def test_present_langfuse_config_builds_project_url() -> None:
        with patch.object(gateway_module, "OpsTraceManager") as manager:
            manager.decrypt_tracing_config.return_value = {"host": "https://langfuse.example.com"}
            manager.obfuscated_decrypt_token.return_value = {"host": "https://langfuse.example.com"}
            manager.get_trace_config_project_key.return_value = "project-key"

            result = OpsTraceManagerGateway().present_config(
                workspace_id="workspace-1",
                tracing_provider="langfuse",
                tracing_config={"encrypted": "config"},
            )

        assert result["project_url"] == "https://langfuse.example.com/project/project-key"

    @staticmethod
    def test_present_langfuse_config_falls_back_to_host() -> None:
        with patch.object(gateway_module, "OpsTraceManager") as manager:
            manager.decrypt_tracing_config.return_value = {"host": "https://langfuse.example.com"}
            manager.obfuscated_decrypt_token.return_value = {"host": "https://langfuse.example.com"}
            manager.get_trace_config_project_key.side_effect = RuntimeError("provider unavailable")

            result = OpsTraceManagerGateway().present_config(
                workspace_id="workspace-1",
                tracing_provider="langfuse",
                tracing_config={"encrypted": "config"},
            )

        assert result["project_url"] == "https://langfuse.example.com/"

    @staticmethod
    def test_present_config_rejects_missing_stored_config() -> None:
        with pytest.raises(AppTracingConfigProcessingError, match="processing failed"):
            OpsTraceManagerGateway().present_config(
                workspace_id="workspace-1",
                tracing_provider="langsmith",
                tracing_config=None,
            )

    @staticmethod
    def test_present_config_reports_decryption_failure_as_processing_error() -> None:
        failure = RuntimeError("stored credential cannot be decrypted")

        with patch.object(gateway_module, "OpsTraceManager") as manager:
            manager.decrypt_tracing_config.side_effect = failure

            with pytest.raises(AppTracingConfigProcessingError) as caught:
                OpsTraceManagerGateway().present_config(
                    workspace_id="workspace-1",
                    tracing_provider="langsmith",
                    tracing_config={"encrypted": "config"},
                )

        assert caught.value.__cause__ is failure
        manager.obfuscated_decrypt_token.assert_not_called()

    @staticmethod
    @pytest.mark.parametrize("malformed", [False, True])
    def test_validate_saved_config_decrypts_and_validates_without_vendor_io(
        monkeypatch: pytest.MonkeyPatch, malformed: bool
    ) -> None:
        monkeypatch.setattr(gateway_module, "provider_config_map", {"langsmith": _provider_entry()})
        with patch.object(gateway_module, "OpsTraceManager") as manager:
            manager.decrypt_tracing_config.return_value = {
                "project": ["invalid-project"] if malformed else "saved-project"
            }
            gateway = OpsTraceManagerGateway()
            if malformed:
                with pytest.raises(AppTracingConfigInvalidConfigurationError):
                    gateway.validate_saved_config(
                        workspace_id="workspace", tracing_provider="langsmith", tracing_config={"api_key": "encrypted"}
                    )
            else:
                gateway.validate_saved_config(
                    workspace_id="workspace", tracing_provider="langsmith", tracing_config={"api_key": "encrypted"}
                )
            manager.decrypt_tracing_config.assert_called_once_with("workspace", "langsmith", {"api_key": "encrypted"})
            manager.check_trace_config_is_effective.assert_not_called()

    @staticmethod
    def test_validate_saved_config_rejects_undecryptable_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(gateway_module, "provider_config_map", {"langsmith": _provider_entry()})
        with patch.object(gateway_module, "OpsTraceManager") as manager:
            manager.decrypt_tracing_config.side_effect = ValueError("invalid ciphertext")
            with pytest.raises(AppTracingConfigProcessingError):
                OpsTraceManagerGateway().validate_saved_config(
                    workspace_id="workspace", tracing_provider="langsmith", tracing_config={"api_key": "broken"}
                )


"""Real provider config serialization must retain verified project links on update."""


AccessAPI = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-opik.src.dify_trace_opik.test_configuration"
).AccessAPI


@dataclass
class ProviderBoundary:
    calls: list[tuple[str, str, dict[str, object]]] = field(default_factory=list)
    effective: bool = True
    lookup_fails: bool = False

    def verify(self, config: Mapping[str, object], provider: str) -> bool:
        self.calls.append(("verify", provider, dict(config)))
        return self.effective

    def project_url(self, config: Mapping[str, object], provider: str) -> str:
        self.calls.append(("url", provider, dict(config)))
        if self.lookup_fails:
            raise RuntimeError("Synthetic project lookup failure")
        return f"https://tracing.test/{provider}/{config['project']}"

    def project_key(self, config: Mapping[str, object], provider: str) -> str:
        self.calls.append(("key", provider, dict(config)))
        return "verified-project"


class TestAppTracingConfigProjectUrlCases:
    @staticmethod
    @pytest.fixture
    def boundary(monkeypatch: pytest.MonkeyPatch) -> ProviderBoundary:
        boundary = ProviderBoundary()

        def encrypt(_tenant: str, value: str) -> str:
            return "test-cipher:" + value

        def decrypt(_tenant: str, values: Sequence[str]) -> list[str]:
            assert all(value.startswith("test-cipher:") for value in values)
            return [value.removeprefix("test-cipher:") for value in values]

        monkeypatch.setattr(ops_trace_manager, "encrypt_token", encrypt)
        monkeypatch.setattr(ops_trace_manager, "batch_decrypt_token", decrypt)
        monkeypatch.setattr(OpsTraceManager, "check_trace_config_is_effective", boundary.verify)
        monkeypatch.setattr(OpsTraceManager, "get_trace_config_project_url", boundary.project_url)
        monkeypatch.setattr(OpsTraceManager, "get_trace_config_project_key", boundary.project_key)
        return boundary

    @staticmethod
    @pytest.mark.parametrize("provider", ["langsmith", "opik"])
    @pytest.mark.parametrize("project", ["original", "changed"])
    def test_update_resolves_project_link_using_verified_unmasked_configuration(
        boundary: ProviderBoundary, provider: str, project: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        gateway = OpsTraceManagerGateway()
        workspace = str(uuid4())
        api = AccessAPI()
        if provider == "opik":
            monkeypatch.setattr(ssrf_proxy, "make_request", api.request)
        target = {"workspace": "team", "url": "https://tracing.test/opik/api/"} if provider == "opik" else {}
        current = gateway.prepare_new_config(
            workspace_id=workspace,
            tracing_provider=provider,
            tracing_config={"api_key": "synthetic-key", "project": "original", **target},
        )
        submitted = {"api_key": "******", "project": project, "project_url": "https://untrusted.test/stale", **target}
        updated = gateway.prepare_updated_config(
            workspace_id=workspace, tracing_provider=provider, tracing_config=submitted, current_tracing_config=current
        )

        prefix = f"https://tracing.test/{provider}/" + ("team/redirect/projects?name=" if provider == "opik" else "")
        assert updated["project_url"] == prefix + project
        assert updated["api_key"] == current["api_key"] == "test-cipher:synthetic-key"
        assert current["project_url"] == prefix + "original"
        assert submitted["api_key"] == "******"
        if provider == "opik":
            assert boundary.calls == []
            assert len(api.calls) == 2
            assert api.calls[-1][2]["headers"] == {
                "Authorization": "synthetic-key",
                "Comet-Workspace": "team",
                "Accept": "application/json",
            }
        else:
            assert [call[0] for call in boundary.calls] == ["verify", "url", "verify", "url"]
            assert boundary.calls[-1][2]["api_key"] == "synthetic-key"
            assert boundary.calls[-1][2]["project"] == project

    @staticmethod
    def test_langfuse_update_uses_current_host_and_resolved_project_key(boundary: ProviderBoundary) -> None:
        gateway = OpsTraceManagerGateway()
        workspace = str(uuid4())
        current = gateway.prepare_new_config(
            workspace_id=workspace,
            tracing_provider="langfuse",
            tracing_config={
                "public_key": "synthetic-public",
                "secret_key": "synthetic-secret",
                "host": "https://old.test",
            },
        )
        updated = gateway.prepare_updated_config(
            workspace_id=workspace,
            tracing_provider="langfuse",
            tracing_config={"public_key": "******", "secret_key": "******", "host": "https://new.test"},
            current_tracing_config=current,
        )
        assert updated["project_url"] == "https://new.test/project/verified-project"
        assert current["project_url"] == "https://old.test/project/verified-project"
        assert boundary.calls[-1][0] == "key"
        assert boundary.calls[-1][2]["secret_key"] == "synthetic-secret"

    @staticmethod
    def test_failed_optional_link_lookup_does_not_reuse_stale_project_url(boundary: ProviderBoundary) -> None:
        gateway = OpsTraceManagerGateway()
        workspace = str(uuid4())
        current = gateway.prepare_new_config(
            workspace_id=workspace,
            tracing_provider="langsmith",
            tracing_config={"api_key": "synthetic-key", "project": "original"},
        )
        boundary.lookup_fails = True
        updated = gateway.prepare_updated_config(
            workspace_id=workspace,
            tracing_provider="langsmith",
            tracing_config={"api_key": "******", "project": "changed"},
            current_tracing_config=current,
        )
        assert updated["project"] == "changed"
        assert "project_url" not in updated
        assert boundary.calls[-1][0] == "url"

    @staticmethod
    def test_invalid_updated_configuration_never_resolves_a_project_url(boundary: ProviderBoundary) -> None:
        boundary.effective = False
        with pytest.raises(AppTracingConfigVerificationFailedError):
            OpsTraceManagerGateway().prepare_updated_config(
                workspace_id=str(uuid4()),
                tracing_provider="langsmith",
                tracing_config={"api_key": "synthetic-key", "project": "changed"},
                current_tracing_config=None,
            )
        assert [call[0] for call in boundary.calls] == ["verify"]

    @staticmethod
    def test_updated_project_url_is_frozen_and_used_by_real_langsmith_serializer(
        boundary: ProviderBoundary,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        workspace, app_id, message_id = (str(uuid4()) for _ in range(3))
        with sqlite_session_factory.begin() as session:
            session.add(
                make_app(
                    app_id=app_id,
                    tenant_id=workspace,
                    mode=AppMode.AGENT,
                    tracing=json.dumps({"enabled": True, "tracing_provider": "langsmith"}),
                )
            )
            session.add(
                make_message(
                    message_id=message_id,
                    app_id=app_id,
                    inputs={},
                    query="test input",
                    message={},
                    answer="test output",
                    message_unit_price=Decimal(0),
                    answer_unit_price=Decimal(0),
                    currency="USD",
                    from_source=ConversationFromSource.CONSOLE,
                )
            )
        store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
        configs = AppTracingConfigService(configs=store, provider=OpsTraceManagerGateway())
        context = RequestContext("request", None, "account", workspace)
        configs.create(context, app_id, "langsmith", {"api_key": "synthetic-key", "project": "original"})
        configs.update(context, app_id, "langsmith", {"api_key": "******", "project": "changed"})
        repository = ApplicationTraceRepository(sqlite_session_factory)
        run = repository.start(
            tenant_id=workspace, app_id=app_id, source_kind="message", source_id=message_id, session_id="test-session"
        )
        assert run is not None
        assert run.provider_config["project_url"] == "https://tracing.test/langsmith/changed"
        configs.update(context, app_id, "langsmith", {"api_key": "******", "project": "later"})
        frozen = repository.source_run(tenant_id=workspace, app_id=app_id, source_kind="message", source_id=message_id)
        assert frozen is not None
        assert frozen.provider_config["project_url"] == "https://tracing.test/langsmith/changed"

        requests: list[str] = []

        def send(method: str, url: str, **_kwargs: object) -> httpx.Response:
            requests.append(url)
            return httpx.Response(200, request=httpx.Request(method, url))

        monkeypatch.setattr(ssrf_proxy, "make_request", send)
        config = dict(frozen.provider_config)
        config.update(OpsTraceManager.decrypt_tracing_config(workspace, "langsmith", frozen.provider_config))
        start = datetime(2026, 10, 16, tzinfo=UTC)
        trace = CanonicalTrace(
            trace_id=frozen.trace_id,
            session_id=frozen.session_id,
            root_span_id=frozen.root_span_id,
            spans=(
                CanonicalSpan(
                    id=frozen.root_span_id,
                    name="Agent",
                    kind=CanonicalSpanKind.AGENT,
                    parent_id=None,
                    status=CanonicalSpanStatus.OK,
                    start_time=start,
                    end_time=start + timedelta(seconds=1),
                ),
            ),
        )
        result = export_trace("langsmith", config, trace)
        assert result.status == "accepted"
        assert result.trace_url == f"https://tracing.test/langsmith/changed/r/{result.trace_id}"
        assert result.span_urls[frozen.root_span_id] == result.trace_url
        assert len(requests) == 1
        assert boundary.calls[-1][2]["project"] == "later"


"""Arize project links use verified metadata without changing ingestion permissions."""


DESTINATION = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-arize-phoenix.src.dify_trace_arize_phoenix.test_arize_configuration"
).DESTINATION
SPACE = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-arize-phoenix.src.dify_trace_arize_phoenix.test_arize_configuration"
).SPACE
URL = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-arize-phoenix.src.dify_trace_arize_phoenix.test_arize_configuration"
).URL
VALUES = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-arize-phoenix.src.dify_trace_arize_phoenix.test_arize_configuration"
).VALUES
page = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-arize-phoenix.src.dify_trace_arize_phoenix.test_arize_configuration"
).page
project = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-arize-phoenix.src.dify_trace_arize_phoenix.test_arize_configuration"
).project
_arize_tracing_project_url_response = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-arize-phoenix.src.dify_trace_arize_phoenix.test_arize_configuration"
).response
space = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-arize-phoenix.src.dify_trace_arize_phoenix.test_arize_configuration"
).space
_D0db4e12TestArizeConfigurationCases = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-arize-phoenix.src.dify_trace_arize_phoenix.test_arize_configuration"
).TestArizeConfigurationCases
_D0db4e12TestArizeConfigurationCases = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-arize-phoenix.src.dify_trace_arize_phoenix.test_arize_configuration"
).TestArizeConfigurationCases


class TestArizeTracingProjectUrlCases:
    calls = staticmethod(_D0db4e12TestArizeConfigurationCases.calls)

    responses = staticmethod(_D0db4e12TestArizeConfigurationCases.responses)

    @staticmethod
    @pytest.fixture
    def verified(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
        calls: list[dict[str, object]] = []

        def verify(config: ArizeConfig) -> None:
            calls.append(config.model_dump())

        monkeypatch.setattr(arize_configuration, "verify_configuration", verify)
        return calls

    @staticmethod
    def test_legacy_arize_get_hides_unverified_redirect_without_network_or_rewriting(
        workspace: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        stored = OpsTraceManager.encrypt_tracing_config(
            workspace,
            "arize",
            {"api_key": "synthetic-ingestion-key", "space_id": "U3BhY2U6dGVzdA==", "project": "original"},
        )
        stored["project_url"] = "https://app.arize.com/?redirect_project_name=original"
        untouched = deepcopy(stored)
        calls: list[str] = []

        def forbidden(*_args: object, **_kwargs: object) -> Never:
            calls.append("legacy or network")
            raise AssertionError("Configuration GET must not initialize a tracer or resolve vendor metadata")

        monkeypatch.setattr(OpsTraceManager, "get_trace_config_project_url", forbidden)
        monkeypatch.setattr(ssrf_proxy, "get", forbidden)
        shown = OpsTraceManagerGateway().present_config(
            workspace_id=workspace, tracing_provider="arize", tracing_config=stored
        )

        assert shown["project_url"] is None
        assert calls == []
        assert stored == untouched

    @staticmethod
    def test_real_rsa_create_masked_update_get_and_frozen_history(
        workspace: str,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        verified: list[dict[str, object]],
        calls: list[tuple[str, dict[str, object]]],
        responses: deque[httpx.Response | Exception],
    ) -> None:
        app_id, message_id = str(uuid4()), str(uuid4())
        with sqlite_session_factory.begin() as session:
            session.add(
                make_app(
                    app_id=app_id,
                    tenant_id=workspace,
                    mode=AppMode.AGENT,
                    tracing=json.dumps({"enabled": True, "tracing_provider": "arize"}),
                )
            )
            session.add(
                make_message(
                    message_id=message_id,
                    app_id=app_id,
                    inputs={},
                    query="test",
                    message={},
                    answer="ok",
                    message_unit_price=Decimal(0),
                    answer_unit_price=Decimal(0),
                    currency="USD",
                    from_source=ConversationFromSource.CONSOLE,
                )
            )
        store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
        gateway = OpsTraceManagerGateway()
        service = AppTracingConfigService(configs=store, provider=gateway)
        context = RequestContext("request", None, "account", workspace)
        legacy = OpsTraceManager.encrypt_tracing_config(workspace, "arize", VALUES)
        legacy["project_url"] = "https://app.arize.com/?redirect_project_name=exact"
        assert store.create(workspace_id=workspace, app_id=app_id, tracing_provider="arize", tracing_config=legacy)
        repository = ApplicationTraceRepository(sqlite_session_factory)
        run = repository.start(
            tenant_id=workspace, app_id=app_id, source_kind="message", source_id=message_id, session_id="session"
        )
        assert run is not None
        with sqlite_session_factory.begin() as session:
            accepted = session.get(ApplicationTraceRun, run.id)
            assert accepted is not None
            accepted.state = "accepted"
            accepted.attempts = 1
        with sqlite_session_factory() as session:
            accepted_row = deepcopy(
                dict(
                    session.execute(select(ApplicationTraceRun.__table__).where(ApplicationTraceRun.id == run.id))
                    .mappings()
                    .one()
                )
            )
        frozen_before = deepcopy(run.provider_config)

        # Both legacy secret fields are really encrypted, rather than identity stubs.
        assert legacy["api_key"] != VALUES["api_key"]
        assert legacy["space_id"] != SPACE
        responses.extend([space(), page(project())])
        submitted = {
            **VALUES,
            "api_key": "******",
            "space_id": "******",
            DESTINATION_KEY: {"organization_id": "forged", "project_id": "forged"},
            "project_url": "https://untrusted.test/forged",
        }
        untouched = deepcopy(submitted)
        service.update(context, app_id, "arize", submitted)
        current = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="arize")
        assert current is not None
        assert current.tracing_config is not None
        saved = current.tracing_config
        assert saved["api_key"] == legacy["api_key"]
        assert saved["space_id"] == legacy["space_id"]
        assert saved[DESTINATION_KEY] == {**DESTINATION, "source_digest": saved[DESTINATION_KEY]["source_digest"]}
        assert saved["project_url"] == URL
        assert submitted == untouched
        assert len(calls) == 2
        assert verified[-1]["api_key"] == VALUES["api_key"]
        assert verified[-1]["space_id"] == SPACE

        def forbidden(*_args: object, **_kwargs: object) -> Never:
            raise AssertionError("Reading current configuration or frozen history must not use vendor I/O")

        monkeypatch.setattr(ssrf_proxy, "get", forbidden)
        monkeypatch.setattr(OpsTraceManager, "get_trace_config_project_url", forbidden)
        shown = service.get(context, app_id, "arize")
        assert shown is not None
        assert shown.tracing_config is not None
        assert shown.tracing_config["project_url"] == URL
        assert DESTINATION_KEY not in shown.tracing_config
        frozen = repository.source_run(tenant_id=workspace, app_id=app_id, source_kind="message", source_id=message_id)
        assert frozen is not None
        assert (frozen.state, frozen.attempts, frozen.provider_config) == ("accepted", 1, frozen_before)
        assert frozen_project_url("arize", frozen.provider_config) is None
        assert frozen.provider_config == frozen_before
        monkeypatch.setattr(OpsTraceManager, "decrypt_tracing_config", forbidden)
        status = ApplicationTracingService(repository).status(
            tenant_id=workspace, app_id=app_id, source_kind="message", source_id=message_id
        )
        assert status["project_url"] is None
        assert status["status"] == "accepted"
        with sqlite_session_factory() as session:
            after_row = dict(
                session.execute(select(ApplicationTraceRun.__table__).where(ApplicationTraceRun.id == run.id))
                .mappings()
                .one()
            )
        assert after_row == accepted_row

        # A future source freezes the verified destination; it never repairs the old run.
        later_id = str(uuid4())
        with sqlite_session_factory.begin() as session:
            session.add(
                make_message(
                    message_id=later_id,
                    app_id=app_id,
                    inputs={},
                    query="later",
                    message={},
                    answer="ok",
                    message_unit_price=Decimal(0),
                    answer_unit_price=Decimal(0),
                    currency="USD",
                    from_source=ConversationFromSource.CONSOLE,
                )
            )
        later = repository.start(
            tenant_id=workspace, app_id=app_id, source_kind="message", source_id=later_id, session_id="session"
        )
        assert later is not None
        assert frozen_project_url("arize", later.provider_config) == URL

    @staticmethod
    @pytest.mark.parametrize("status", [401, 403, 404, 500])
    def test_ingest_verified_key_without_metadata_read_permission_still_saves(
        workspace: str,
        verified: list[dict[str, object]],
        calls: list[tuple[str, dict[str, object]]],
        responses: deque[httpx.Response | Exception],
        status: int,
    ) -> None:
        responses.append(_arize_tracing_project_url_response({"message": "private-response"}, status))
        saved = OpsTraceManagerGateway().prepare_new_config(
            workspace_id=workspace, tracing_provider="arize", tracing_config=VALUES
        )
        assert "project_url" not in saved
        assert DESTINATION_KEY not in saved
        assert OpsTraceManager.decrypt_tracing_config(workspace, "arize", saved)["api_key"] == VALUES["api_key"]
        assert len(verified) == len(calls) == 1

    @staticmethod
    def test_changed_destination_cannot_keep_old_or_client_supplied_cache(
        workspace: str,
        verified: list[dict[str, object]],
        calls: list[tuple[str, dict[str, object]]],
        responses: deque[httpx.Response | Exception],
    ) -> None:
        gateway = OpsTraceManagerGateway()
        responses.extend([space(), page(project())])
        before = gateway.prepare_new_config(workspace_id=workspace, tracing_provider="arize", tracing_config=VALUES)
        assert before["project_url"] == URL
        responses.append(_arize_tracing_project_url_response({}, 403))
        after = gateway.prepare_updated_config(
            workspace_id=workspace,
            tracing_provider="arize",
            current_tracing_config=before,
            tracing_config={
                **VALUES,
                "api_key": "******",
                "space_id": "******",
                "project": "later",
                DESTINATION_KEY: before[DESTINATION_KEY],
                "project_url": URL,
            },
        )
        assert after["project"] == "later"
        assert after["api_key"] == before["api_key"]
        assert after["space_id"] == before["space_id"]
        assert "project_url" not in after
        assert DESTINATION_KEY not in after
        assert before["project_url"] == URL
        assert len(calls) == 3
        assert len(verified) == 2

    @staticmethod
    def test_failed_original_ingestion_verification_never_resolves_metadata(
        workspace: str,
        monkeypatch: pytest.MonkeyPatch,
        calls: list[tuple[str, dict[str, object]]],
    ) -> None:
        def rejected(_config: ArizeConfig) -> Never:
            raise arize_configuration.ArizeConfigurationError("permission_denied")

        monkeypatch.setattr(arize_configuration, "verify_configuration", rejected)
        with pytest.raises(AppTracingConfigVerificationFailedError):
            OpsTraceManagerGateway().prepare_new_config(
                workspace_id=workspace, tracing_provider="arize", tracing_config=VALUES
            )
        assert calls == []


"""Databricks config persistence must not initialize a process-global MLflow client."""


ExperimentAPI = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-mlflow.src.dify_trace_mlflow.test_configuration"
).ExperimentAPI
_databricks_tracing_config_gateway_response = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-mlflow.src.dify_trace_mlflow.test_configuration"
).response


@dataclass
class _DatabricksTracingConfigGatewayGatewayenvironment:
    gateway: OpsTraceManagerGateway = field(default_factory=OpsTraceManagerGateway)
    api: ExperimentAPI = field(default_factory=ExperimentAPI)
    forbidden_calls: list[str] = field(default_factory=list)


class TestDatabricksTracingConfigGatewayCases:
    @staticmethod
    @pytest.fixture
    def environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[_DatabricksTracingConfigGatewayGatewayenvironment]:
        environment = _DatabricksTracingConfigGatewayGatewayenvironment()

        def encrypt(_tenant: str, value: str) -> str:
            return "test-cipher:" + value

        def decrypt(_tenant: str, values: Sequence[str]) -> list[str]:
            assert all(value.startswith("test-cipher:") for value in values)
            return [value.removeprefix("test-cipher:") for value in values]

        def forbidden(name: str) -> Callable[..., Never]:
            def block(*_args: object, **_kwargs: object) -> Never:
                environment.forbidden_calls.append(name)
                raise AssertionError("Configuration must not initialize a stateful exporter")

            return block

        monkeypatch.setattr(ops_trace_manager, "encrypt_token", encrypt)
        monkeypatch.setattr(ops_trace_manager, "batch_decrypt_token", decrypt)
        monkeypatch.setattr(ops_trace_manager, "obfuscated_token", lambda value: "******" if value else value)
        monkeypatch.setattr(ssrf_proxy, "get", environment.api.get)
        monkeypatch.setattr(ssrf_proxy, "post", environment.api.post)
        monkeypatch.setattr(MLflowDataTrace, "__init__", forbidden("legacy_constructor"))
        monkeypatch.setattr(mlflow, "set_tracking_uri", forbidden("tracking_uri"))
        monkeypatch.setattr(mlflow, "set_experiment", forbidden("experiment"))
        monkeypatch.setattr(mlflow, "search_experiments", forbidden("search"))
        monkeypatch.setattr(mlflow.config, "enable_async_logging", forbidden("async_logging"))
        yield environment
        assert environment.forbidden_calls == []

    @staticmethod
    @pytest.mark.parametrize("oauth", [False, True])
    def test_create_and_patch_persist_verified_target_without_replacing_masked_credentials(
        environment: _DatabricksTracingConfigGatewayGatewayenvironment,
        sqlite_session_factory: sessionmaker[Session],
        oauth: bool,
    ) -> None:
        workspace, app_id = str(uuid4()), str(uuid4())
        with sqlite_session_factory.begin() as session:
            session.add(make_app(app_id=app_id, tenant_id=workspace))
        store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
        service = AppTracingConfigService(configs=store, provider=environment.gateway)
        context = RequestContext("request", None, "account", workspace)
        credentials = (
            {"client_id": "synthetic-client", "client_secret": "synthetic-secret"}
            if oauth
            else {"personal_access_token": "synthetic-pat"}
        )
        secret_field = "client_secret" if oauth else "personal_access_token"
        service.create(
            context, app_id, "databricks", {"host": " https://first.test/ ", "experiment_id": "00012", **credentials}
        )
        before = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="databricks")
        assert before is not None
        assert before.tracing_config is not None
        assert before.tracing_config["host"] == "https://first.test"
        assert before.tracing_config["experiment_id"] == "12"
        service.update(
            context,
            app_id,
            "databricks",
            {
                "host": " https://second.test/ ",
                "experiment_id": "00034",
                **credentials,
                secret_field: "******",
            },
        )
        after = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="databricks")
        assert after is not None
        assert after.tracing_config is not None
        assert after.tracing_config["host"] == "https://second.test"
        assert after.tracing_config["experiment_id"] == "34"
        assert after.tracing_config[secret_field] == before.tracing_config[secret_field]
        assert after.tracing_config["project_url"] == "https://second.test/ml/experiments/34/traces"
        assert before.tracing_config["project_url"] == "https://first.test/ml/experiments/12/traces"
        before_get = len(environment.api.calls)
        presented = service.get(context, app_id, "databricks")
        assert presented is not None
        assert presented.tracing_config is not None
        assert presented.tracing_config[secret_field] == "******"
        assert presented.tracing_config["project_url"] == after.tracing_config["project_url"]
        environment.gateway.validate_saved_config(
            workspace_id=workspace, tracing_provider="databricks", tracing_config=after.tracing_config
        )
        assert len(environment.api.calls) == before_get

    @staticmethod
    @pytest.mark.parametrize("saved_url", [None, "https://stale.test/old-project"])
    def test_get_is_pure_for_historical_and_current_configs(
        environment: _DatabricksTracingConfigGatewayGatewayenvironment, saved_url: str | None
    ) -> None:
        workspace = str(uuid4())
        encrypted = OpsTraceManager.encrypt_tracing_config(
            workspace,
            "databricks",
            {"host": "https://workspace.test/", "experiment_id": "12", "personal_access_token": "synthetic-pat"},
        )
        if saved_url is not None:
            encrypted["project_url"] = saved_url
        result = environment.gateway.present_config(
            workspace_id=workspace, tracing_provider="databricks", tracing_config=encrypted
        )
        assert result["project_url"] == "https://workspace.test/ml/experiments/12/traces"
        assert result["personal_access_token"] == "******"
        assert environment.api.calls == []

    @staticmethod
    def test_invalid_historical_host_uses_safe_pure_fallback(
        environment: _DatabricksTracingConfigGatewayGatewayenvironment,
    ) -> None:
        workspace = str(uuid4())
        encrypted = OpsTraceManager.encrypt_tracing_config(
            workspace,
            "databricks",
            {
                "host": "https://user:password@workspace.test",
                "experiment_id": "12",
                "personal_access_token": "synthetic-pat",
            },
        )
        result = environment.gateway.present_config(
            workspace_id=workspace, tracing_provider="databricks", tracing_config=encrypted
        )
        assert result["project_url"] == "https://www.databricks.com/"
        assert environment.api.calls == []

    @staticmethod
    def test_failed_patch_keeps_original_destination_and_logs_only_safe_code(
        environment: _DatabricksTracingConfigGatewayGatewayenvironment,
        sqlite_session_factory: sessionmaker[Session],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        workspace, app_id = str(uuid4()), str(uuid4())
        with sqlite_session_factory.begin() as session:
            session.add(make_app(app_id=app_id, tenant_id=workspace))
        store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
        service = AppTracingConfigService(configs=store, provider=environment.gateway)
        context = RequestContext("request", None, "account", workspace)
        original = {
            "host": "https://workspace.test",
            "experiment_id": "12",
            "personal_access_token": "synthetic-private-pat",
        }
        service.create(context, app_id, "databricks", original)
        before = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="databricks")
        assert before is not None
        environment.api.override = lambda _method, url, _options: _databricks_tracing_config_gateway_response(
            url, {"message": "private-vendor-detail"}, 403
        )
        with pytest.raises(AppTracingConfigVerificationFailedError) as caught:
            service.update(
                context, app_id, "databricks", {**original, "experiment_id": "34", "personal_access_token": "******"}
            )
        assert isinstance(caught.value.__cause__, DatabricksConfigurationError)
        assert caught.value.__cause__.code == "permission_denied"
        after = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="databricks")
        assert after is not None
        assert after.tracing_config == before.tracing_config
        assert "permission_denied" in caplog.text
        assert "private-vendor-detail" not in caplog.text
        assert "synthetic-private-pat" not in caplog.text

    @staticmethod
    @pytest.mark.parametrize("start_with_oauth", [False, True])
    def test_switching_auth_clears_unselected_credentials_in_persistence_and_requests(
        environment: _DatabricksTracingConfigGatewayGatewayenvironment,
        sqlite_session_factory: sessionmaker[Session],
        start_with_oauth: bool,
    ) -> None:
        workspace, app_id = str(uuid4()), str(uuid4())
        with sqlite_session_factory.begin() as session:
            session.add(make_app(app_id=app_id, tenant_id=workspace))
        store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
        service = AppTracingConfigService(configs=store, provider=environment.gateway)
        context = RequestContext("request", None, "account", workspace)
        pat = {"personal_access_token": "synthetic-pat", "client_id": None, "client_secret": None}
        oauth = {"personal_access_token": None, "client_id": "synthetic-client", "client_secret": "synthetic-secret"}
        target = {"host": "https://workspace.test", "experiment_id": "12"}
        service.create(context, app_id, "databricks", {**target, **(oauth if start_with_oauth else pat)})
        environment.api.calls.clear()
        service.update(context, app_id, "databricks", {**target, **(pat if start_with_oauth else oauth)})
        stored = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="databricks")
        assert stored is not None
        assert stored.tracing_config is not None
        assert stored.tracing_config["client_secret" if start_with_oauth else "personal_access_token"] is None
        assert [method for method, _url, _options in environment.api.calls] == (
            ["GET"] if start_with_oauth else ["POST", "GET"]
        )
        expected_token = "synthetic-pat" if start_with_oauth else "synthetic-oauth-token"
        assert environment.api.calls[-1][2]["headers"] == {
            "Authorization": f"Bearer {expected_token}",
            "Accept": "application/json",
        }
        presented = service.get(context, app_id, "databricks")
        assert presented is not None
        assert presented.tracing_config is not None
        assert presented.tracing_config["client_secret" if start_with_oauth else "personal_access_token"] is None


"""MLflow config persistence uses real RSA/SQLite without constructing an exporter."""


ExperimentAPI = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-mlflow.src.dify_trace_mlflow.test_configuration"
).ExperimentAPI
_mlflow_tracing_config_gateway_response = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-mlflow.src.dify_trace_mlflow.test_configuration"
).response


@dataclass
class _MlflowTracingConfigGatewayConfigurationcase:
    api: ExperimentAPI
    gateway: OpsTraceManagerGateway
    service: AppTracingConfigService
    store: SQLAlchemyAppTracingConfigRepository
    reader: ConsoleAppRepository
    context: RequestContext
    app_id: str

    def read(self, provider: str = "mlflow") -> AppTracingConfigRecord | None:
        return self.store.get(
            workspace_id=self.context.active_workspace_id, app_id=self.app_id, tracing_provider=provider
        )


class TestMlflowTracingConfigGatewayCases:
    import importlib as _test_importlib

    experiment_api = _test_importlib.import_module(
        "tests.unit_tests.providers.trace.trace-mlflow.src.dify_trace_mlflow.test_oss_configuration"
    ).experiment_api

    experiment_api = staticmethod(experiment_api)

    import importlib as _test_importlib

    isolated_sdk_state = _test_importlib.import_module(
        "tests.unit_tests.providers.trace.trace-mlflow.src.dify_trace_mlflow.test_oss_configuration"
    ).isolated_sdk_state

    isolated_sdk_state = staticmethod(isolated_sdk_state)

    @staticmethod
    @pytest.fixture
    def case(
        workspace: str, sqlite_session_factory: sessionmaker[Session], experiment_api: ExperimentAPI
    ) -> _MlflowTracingConfigGatewayConfigurationcase:
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
        previous = OpsTraceManager.encrypt_tracing_config(
            workspace,
            "langsmith",
            {"api_key": "synthetic-other-key", "project": "other", "endpoint": "https://other.test"},
        )
        assert store.create(
            workspace_id=workspace, app_id=app_id, tracing_provider="langsmith", tracing_config=previous
        )
        return _MlflowTracingConfigGatewayConfigurationcase(
            experiment_api,
            gateway,
            AppTracingConfigService(configs=store, provider=gateway),
            store,
            ConsoleAppRepository(session_factory=sqlite_session_factory),
            RequestContext("request", None, "account", workspace),
            app_id,
        )

    @staticmethod
    def test_post_masked_patch_and_get_preserve_ciphertext_and_exact_destination(
        case: _MlflowTracingConfigGatewayConfigurationcase,
    ) -> None:
        original = case.read("langsmith")
        submitted = {
            "tracking_uri": " HTTP://FIRST.Example:5000/team/ ",
            "experiment_id": "00012",
            "username": "test-user",
            "password": "synthetic-password",
        }
        untouched = dict(submitted)
        case.service.create(case.context, case.app_id, "mlflow", submitted, activate=True)
        before = case.read()
        assert before is not None
        assert before.tracing_config is not None
        config = before.tracing_config
        assert config["tracking_uri"] == "http://first.example:5000/team"
        assert config["experiment_id"] == "12"
        assert config["password"] != "synthetic-password"
        assert OpsTraceManager.decrypt_tracing_config(case.context.active_workspace_id, "mlflow", config)[
            "password"
        ] == ("synthetic-password")
        assert submitted == untouched
        shown = case.service.get(case.context, case.app_id, "mlflow")
        assert shown is not None
        assert shown.tracing_config is not None
        masked = shown.tracing_config["password"]
        assert isinstance(masked, str)
        assert "*" in masked
        assert masked != "synthetic-password"
        assert len(case.api.calls) == 1
        case.service.update(
            case.context,
            case.app_id,
            "mlflow",
            {
                "tracking_uri": "https://SECOND.test/new-prefix/",
                "experiment_id": "00034",
                "username": "test-user",
                "password": masked,
            },
        )
        after = case.read()
        assert after is not None
        assert after.tracing_config is not None
        assert after.tracing_config["password"] == config["password"]
        assert after.tracing_config["tracking_uri"] == "https://second.test/new-prefix"
        assert after.tracing_config["experiment_id"] == "34"
        assert after.tracing_config["project_url"] == "https://second.test/new-prefix/#/experiments/34/traces"
        assert len(case.api.calls) == 2
        assert case.api.calls[-1][1] == "https://second.test/new-prefix/api/2.0/mlflow/experiments/get"
        case.gateway.validate_saved_config(
            workspace_id=case.context.active_workspace_id,
            tracing_provider="mlflow",
            tracing_config=after.tracing_config,
        )
        assert case.service.get(case.context, case.app_id, "mlflow") is not None
        assert len(case.api.calls) == 2
        assert case.read("langsmith") == original
        policy = case.reader.get_trace(case.context, case.app_id)
        assert policy.enabled
        assert policy.tracing_provider == "mlflow"
        assert policy.capture_content is True
        assert policy.capture_agent is False

    @staticmethod
    @pytest.mark.parametrize("clear_with_null", [False, True])
    def test_basic_to_anonymous_and_back_does_not_reuse_credentials(
        case: _MlflowTracingConfigGatewayConfigurationcase, clear_with_null: bool
    ) -> None:
        destination = {"tracking_uri": "https://same.test/prefix", "experiment_id": "12"}
        case.service.create(
            case.context, case.app_id, "mlflow", {**destination, "username": "first", "password": "first-secret"}
        )
        empty = None if clear_with_null else ""
        case.service.update(case.context, case.app_id, "mlflow", {**destination, "username": empty, "password": empty})
        assert case.api.calls[-1][2]["headers"] == {
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "Cookie": "",
        }
        stored = case.read()
        assert stored is not None
        assert stored.tracing_config is not None
        assert (
            OpsTraceManager.decrypt_tracing_config(case.context.active_workspace_id, "mlflow", stored.tracing_config)[
                "password"
            ]
            == empty
        )
        case.service.update(
            case.context, case.app_id, "mlflow", {**destination, "username": "second", "password": "second-secret"}
        )
        assert case.api.calls[-1][2]["headers"] != case.api.calls[0][2]["headers"]

    @staticmethod
    def test_failed_patch_keeps_config_policy_and_other_provider(
        case: _MlflowTracingConfigGatewayConfigurationcase, caplog: pytest.LogCaptureFixture
    ) -> None:
        original = {
            "tracking_uri": "https://first.test",
            "experiment_id": "12",
            "username": "user",
            "password": "private-password",
        }
        case.service.create(case.context, case.app_id, "mlflow", original)
        before, other, policy = case.read(), case.read("langsmith"), case.reader.get_trace(case.context, case.app_id)
        case.api.override = lambda _method, url, _options: _mlflow_tracing_config_gateway_response(
            url, {"message": "private-vendor-response"}, 403
        )
        with pytest.raises(AppTracingConfigVerificationFailedError) as caught:
            case.service.update(
                case.context,
                case.app_id,
                "mlflow",
                {**original, "tracking_uri": "https://second.test", "password": "******"},
                activate=True,
            )
        assert isinstance(caught.value.__cause__, MLflowConfigurationError)
        assert caught.value.__cause__.code == "permission_denied"
        assert case.read() == before
        assert case.read("langsmith") == other
        assert case.reader.get_trace(case.context, case.app_id) == policy
        assert "permission_denied" in caplog.text
        assert "private-vendor-response" not in caplog.text
        assert "private-password" not in caplog.text

    @staticmethod
    def test_failed_auth_pair_patch_does_not_erase_a_password(
        case: _MlflowTracingConfigGatewayConfigurationcase,
    ) -> None:
        original = {
            "tracking_uri": "https://first.test",
            "experiment_id": "12",
            "username": "user",
            "password": "password",
        }
        case.service.create(case.context, case.app_id, "mlflow", original)
        before = case.read()
        with pytest.raises(AppTracingConfigVerificationFailedError) as caught:
            case.service.update(case.context, case.app_id, "mlflow", {**original, "password": None})
        assert isinstance(caught.value.__cause__, MLflowConfigurationError)
        assert caught.value.__cause__.code == "incomplete_basic_auth"
        assert len(case.api.calls) == 1
        assert case.read() == before

    @staticmethod
    @pytest.mark.parametrize("saved_url", [None, "https://stale.test/wrong-experiment"])
    def test_historical_get_is_pure_even_with_partial_auth(
        case: _MlflowTracingConfigGatewayConfigurationcase, saved_url: str | None
    ) -> None:
        stored = OpsTraceManager.encrypt_tracing_config(
            case.context.active_workspace_id,
            "mlflow",
            {
                "tracking_uri": "https://server.test/prefix/",
                "experiment_id": "00012",
                "username": "historical-user",
                "password": None,
            },
        )
        if saved_url is not None:
            stored["project_url"] = saved_url
        shown = case.gateway.present_config(
            workspace_id=case.context.active_workspace_id, tracing_provider="mlflow", tracing_config=stored
        )
        assert shown["project_url"] == "https://server.test/prefix/#/experiments/12/traces"
        assert shown["password"] is None
        case.gateway.validate_saved_config(
            workspace_id=case.context.active_workspace_id, tracing_provider="mlflow", tracing_config=stored
        )
        assert case.api.calls == []

    @staticmethod
    def test_invalid_historical_url_has_no_fabricated_link_or_network(
        case: _MlflowTracingConfigGatewayConfigurationcase,
    ) -> None:
        stored = OpsTraceManager.encrypt_tracing_config(
            case.context.active_workspace_id,
            "mlflow",
            {
                "tracking_uri": "https://user:secret@server.test?token=private",
                "experiment_id": "12",
                "username": None,
                "password": None,
            },
        )
        shown = case.gateway.present_config(
            workspace_id=case.context.active_workspace_id, tracing_provider="mlflow", tracing_config=stored
        )
        assert shown["project_url"] is None
        assert case.api.calls == []

    @staticmethod
    def test_invalid_new_destination_never_reaches_storage_or_network(
        case: _MlflowTracingConfigGatewayConfigurationcase,
    ) -> None:
        with pytest.raises(AppTracingConfigInvalidConfigurationError):
            case.service.create(
                case.context,
                case.app_id,
                "mlflow",
                {
                    "tracking_uri": "https://server.test/prefix/../other",
                    "experiment_id": "12",
                    "username": "user",
                    "password": "secret",
                },
                activate=True,
            )
        assert case.read() is None
        assert case.api.calls == []
        assert case.reader.get_trace(case.context, case.app_id).tracing_provider == "langsmith"


"""Opik configuration transactions use real RSA and never initialize an SDK streamer."""


AccessAPI = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-opik.src.dify_trace_opik.test_configuration"
).AccessAPI


@dataclass
class _OpikTracingConfigGatewayConfigurationcase:
    api: AccessAPI
    gateway: OpsTraceManagerGateway
    service: AppTracingConfigService
    store: SQLAlchemyAppTracingConfigRepository
    reader: ConsoleAppRepository
    context: RequestContext
    app_id: str
    sessions: sessionmaker[Session]


class TestOpikTracingConfigGatewayCases:
    @staticmethod
    @pytest.fixture
    def case(
        workspace: str, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
    ) -> Iterator[_OpikTracingConfigGatewayConfigurationcase]:
        app_id = str(uuid4())
        with sqlite_session_factory.begin() as session:
            session.add(make_app(app_id=app_id, tenant_id=workspace))
        api = AccessAPI()
        gateway = OpsTraceManagerGateway()
        store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
        forbidden_calls: list[str] = []

        def forbidden(*_args: object, **_kwargs: object) -> Never:
            forbidden_calls.append("sdk_constructor")
            raise AssertionError("Configuration must not initialize an SDK client or ambient configuration")

        monkeypatch.setattr(ssrf_proxy, "make_request", api.request)
        monkeypatch.setattr(OpikDataTrace, "__init__", forbidden)
        monkeypatch.setattr(opik.Opik, "__init__", forbidden)
        monkeypatch.setattr(SDKOpikConfig, "__init__", forbidden)
        yield _OpikTracingConfigGatewayConfigurationcase(
            api,
            gateway,
            AppTracingConfigService(configs=store, provider=gateway),
            store,
            ConsoleAppRepository(session_factory=sqlite_session_factory),
            RequestContext("request", None, "account", workspace),
            app_id,
            sqlite_session_factory,
        )
        assert forbidden_calls == []

    @staticmethod
    def test_post_get_patch_preserve_real_ciphertext_and_verified_destination(
        case: _OpikTracingConfigGatewayConfigurationcase,
    ) -> None:
        secret = "synthetic-private-opik-key"
        case.service.create(
            case.context,
            case.app_id,
            "opik",
            {"api_key": secret, "workspace": "", "project": " first ", "url": "https://first.test/prefix/api/"},
            activate=True,
        )
        before = case.store.get(
            workspace_id=case.context.active_workspace_id, app_id=case.app_id, tracing_provider="opik"
        )
        assert before is not None
        assert before.tracing_config is not None
        config = before.tracing_config
        assert config["api_key"] != secret
        assert config["workspace"] == "resolved-team"
        assert config["project"] == "first"
        assert config["project_url"] == "https://first.test/prefix/resolved-team/redirect/projects?name=first"
        assert (
            OpsTraceManager.decrypt_tracing_config(case.context.active_workspace_id, "opik", config)["api_key"]
            == secret
        )
        assert case.reader.get_trace(case.context, case.app_id).tracing_provider == "opik"

        before_get = len(case.api.calls)
        presented = case.service.get(case.context, case.app_id, "opik")
        assert presented is not None
        assert presented.tracing_config is not None
        masked = presented.tracing_config["api_key"]
        assert masked != secret
        assert "*" in masked
        assert len(case.api.calls) == before_get
        case.api.default_workspace = "new-team"
        case.service.update(
            case.context,
            case.app_id,
            "opik",
            {"api_key": masked, "workspace": "default", "project": "A & B", "url": "https://second.test/api/"},
        )
        after = case.store.get(
            workspace_id=case.context.active_workspace_id, app_id=case.app_id, tracing_provider="opik"
        )
        assert after is not None
        assert after.tracing_config is not None
        assert after.tracing_config["api_key"] == config["api_key"]
        assert after.tracing_config["workspace"] == "new-team"
        assert after.tracing_config["project"] == "A & B"
        assert after.tracing_config["url"] == "https://second.test/api/"
        assert after.tracing_config["project_url"] == "https://second.test/new-team/redirect/projects?name=A+%26+B"
        assert case.api.calls[-1][2]["headers"] == {
            "Authorization": secret,
            "Comet-Workspace": "default",
            "Accept": "application/json",
        }
        before_get = len(case.api.calls)
        presented = case.service.get(case.context, case.app_id, "opik")
        assert presented is not None
        assert presented.tracing_config is not None
        assert presented.tracing_config["project_url"] == after.tracing_config["project_url"]
        case.gateway.validate_saved_config(
            workspace_id=case.context.active_workspace_id, tracing_provider="opik", tracing_config=after.tracing_config
        )
        assert len(case.api.calls) == before_get

    @staticmethod
    @pytest.mark.parametrize("saved_url", [None, "https://wrong-global.test/old-project"])
    @pytest.mark.parametrize("workspace_name", ["team", "default", None])
    def test_historical_get_uses_only_configuration_host_without_network(
        case: _OpikTracingConfigGatewayConfigurationcase, saved_url: str | None, workspace_name: str | None
    ) -> None:
        stored = OpsTraceManager.encrypt_tracing_config(
            case.context.active_workspace_id,
            "opik",
            {
                "api_key": "synthetic-key",
                "workspace": workspace_name,
                "project": "A & B",
                "url": "https://private.test/opik/api/",
            },
        )
        if saved_url:
            stored["project_url"] = saved_url
        result = case.gateway.present_config(
            workspace_id=case.context.active_workspace_id, tracing_provider="opik", tracing_config=stored
        )
        expected = (
            "https://private.test/opik/team/redirect/projects?name=A+%26+B"
            if workspace_name == "team"
            else "https://private.test/opik/"
        )
        assert result["project_url"] == expected
        assert result["api_key"] != "synthetic-key"
        assert case.api.calls == []

    @staticmethod
    @pytest.mark.parametrize("status", [401, 403])
    @pytest.mark.parametrize("existing", [False, True])
    def test_bad_key_or_workspace_does_not_save_or_change_active_provider(
        case: _OpikTracingConfigGatewayConfigurationcase, status: int, existing: bool, caplog: pytest.LogCaptureFixture
    ) -> None:
        original = {"api_key": "synthetic-private-key", "workspace": "team", "project": "original"}
        if existing:
            case.service.create(case.context, case.app_id, "opik", original)
        with case.sessions.begin() as session:
            app = session.get(App, case.app_id)
            assert app is not None
            app.tracing = json.dumps({"enabled": True, "tracing_provider": "langsmith", "capture_content": False})
        before_policy = case.reader.get_trace(case.context, case.app_id)
        before = case.store.get(
            workspace_id=case.context.active_workspace_id, app_id=case.app_id, tracing_provider="opik"
        )
        case.api.override = lambda method, url, _options: httpx.Response(
            status, text="private-vendor-details", request=httpx.Request(method, url)
        )
        operation = case.service.update if existing else case.service.create
        with pytest.raises(AppTracingConfigVerificationFailedError) as error:
            operation(case.context, case.app_id, "opik", {**original, "workspace": "inaccessible"}, activate=True)
        assert isinstance(error.value.__cause__, OpikConfigurationError)
        assert error.value.__cause__.code == ("authentication_failed" if status == 401 else "permission_denied")
        after = case.store.get(
            workspace_id=case.context.active_workspace_id, app_id=case.app_id, tracing_provider="opik"
        )
        assert after == before
        assert case.reader.get_trace(case.context, case.app_id) == before_policy
        assert "private-vendor-details" not in caplog.text
        assert "synthetic-private-key" not in caplog.text

    @staticmethod
    def test_clear_optional_api_key_keeps_keyless_self_host_valid(
        case: _OpikTracingConfigGatewayConfigurationcase, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        target = {"url": "http://local.test:5173/api/", "workspace": "team", "project": "sample"}
        case.service.create(case.context, case.app_id, "opik", {**target, "api_key": "synthetic-key"})
        monkeypatch.setenv("OPIK_API_KEY", "unrelated-key")
        case.api.calls.clear()
        case.service.update(case.context, case.app_id, "opik", {**target, "api_key": None})
        stored = case.store.get(
            workspace_id=case.context.active_workspace_id, app_id=case.app_id, tracing_provider="opik"
        )
        assert stored is not None
        assert stored.tracing_config is not None
        assert stored.tracing_config["api_key"] is None
        presented = case.service.get(case.context, case.app_id, "opik")
        assert presented is not None
        assert presented.tracing_config is not None
        assert presented.tracing_config["api_key"] is None
        assert case.api.calls[0][2]["headers"] == {"Comet-Workspace": "team", "Accept": "application/json"}
        assert len(case.api.calls) == 1


"""Persist verified Phoenix configuration while preserving owner policy and masked keys."""


_phoenix_tracing_config_gateway_response = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-arize-phoenix.src.dify_trace_arize_phoenix.test_configuration"
).response


@dataclass
class PhoenixCase:
    gateway: OpsTraceManagerGateway
    service: AppTracingConfigService
    store: SQLAlchemyAppTracingConfigRepository
    reader: ConsoleAppRepository
    context: RequestContext
    app_id: str

    def read(self, provider: str = "phoenix") -> AppTracingConfigRecord | None:
        return self.store.get(
            workspace_id=self.context.active_workspace_id, app_id=self.app_id, tracing_provider=provider
        )


class TestPhoenixTracingConfigGatewayCases:
    import importlib as _test_importlib

    api_calls = _test_importlib.import_module(
        "tests.unit_tests.providers.trace.trace-arize-phoenix.src.dify_trace_arize_phoenix.test_configuration"
    ).api_calls

    api_calls = staticmethod(api_calls)

    import importlib as _test_importlib

    api_responses = _test_importlib.import_module(
        "tests.unit_tests.providers.trace.trace-arize-phoenix.src.dify_trace_arize_phoenix.test_configuration"
    ).api_responses

    api_responses = staticmethod(api_responses)

    import importlib as _test_importlib

    no_legacy_or_environment_auth = _test_importlib.import_module(
        "tests.unit_tests.providers.trace.trace-arize-phoenix.src.dify_trace_arize_phoenix.test_configuration"
    ).no_legacy_or_environment_auth

    no_legacy_or_environment_auth = staticmethod(no_legacy_or_environment_auth)

    @staticmethod
    @pytest.fixture
    def case(workspace: str, sqlite_session_factory: sessionmaker[Session]) -> PhoenixCase:
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
            workspace,
            "langsmith",
            {"api_key": "synthetic-other-key", "project": "other", "endpoint": "https://other.test"},
        )
        assert store.create(workspace_id=workspace, app_id=app_id, tracing_provider="langsmith", tracing_config=old)
        return PhoenixCase(
            gateway,
            AppTracingConfigService(configs=store, provider=gateway),
            store,
            ConsoleAppRepository(session_factory=sqlite_session_factory),
            RequestContext("request", None, "account", workspace),
            app_id,
        )

    @staticmethod
    def test_post_masked_patch_get_keep_normalized_destination_and_ciphertext(
        case: PhoenixCase,
        api_calls: list[tuple[str, dict[str, object]]],
    ) -> None:
        other = case.read("langsmith")
        submitted = {
            "endpoint": " HTTP://FIRST.Example:6006/reverse/ ",
            "project": " first project ",
            "api_key": "synthetic-secret",
        }
        untouched = dict(submitted)
        case.service.create(case.context, case.app_id, "phoenix", submitted, activate=True)
        before = case.read()
        assert before is not None
        assert before.tracing_config is not None
        stored = before.tracing_config
        assert stored["endpoint"] == "http://first.example:6006/reverse"
        assert stored["project"] == "first project"
        assert stored["api_key"] != "synthetic-secret"
        assert submitted == untouched
        assert OpsTraceManager.decrypt_tracing_config(case.context.active_workspace_id, "phoenix", stored)[
            "api_key"
        ] == ("synthetic-secret")
        shown = case.service.get(case.context, case.app_id, "phoenix")
        assert shown is not None
        assert shown.tracing_config is not None
        masked = shown.tracing_config["api_key"]
        assert isinstance(masked, str)
        assert "*" in masked
        assert masked != "synthetic-secret"
        assert (
            shown.tracing_config["project_url"]
            == "http://first.example:6006/reverse/redirects/projects/first%20project"
        )
        assert len(api_calls) == 1
        case.service.update(
            case.context,
            case.app_id,
            "phoenix",
            {
                "endpoint": " https://SECOND.test/s/space/ ",
                "project": " second & 项目 ",
                "api_key": masked,
            },
        )
        after = case.read()
        assert after is not None
        assert after.tracing_config is not None
        assert after.tracing_config["api_key"] == stored["api_key"]
        assert after.tracing_config["endpoint"] == "https://second.test/s/space"
        assert after.tracing_config["project"] == "second & 项目"
        assert after.tracing_config["project_url"] == (
            "https://second.test/s/space/redirects/projects/second%20%26%20%E9%A1%B9%E7%9B%AE"
        )
        assert api_calls[-1][0] == "https://second.test/s/space/v1/projects"
        headers = api_calls[-1][1]["headers"]
        assert isinstance(headers, dict)
        assert headers["Authorization"] == "Bearer synthetic-secret"
        case.gateway.validate_saved_config(
            workspace_id=case.context.active_workspace_id,
            tracing_provider="phoenix",
            tracing_config=after.tracing_config,
        )
        assert case.service.get(case.context, case.app_id, "phoenix") is not None
        assert len(api_calls) == 2
        assert case.read("langsmith") == other
        policy = case.reader.get_trace(case.context, case.app_id)
        assert policy.enabled
        assert policy.tracing_provider == "phoenix"
        assert policy.capture_content is True
        assert policy.capture_agent is False

    @staticmethod
    @pytest.mark.parametrize("empty", [None, ""])
    def test_bearer_to_keyless_and_back_is_explicit(
        case: PhoenixCase,
        api_calls: list[tuple[str, dict[str, object]]],
        empty: str | None,
    ) -> None:
        destination = {"endpoint": "https://host.test", "project": "project"}
        case.service.create(case.context, case.app_id, "phoenix", {**destination, "api_key": "first-key"})
        case.service.update(case.context, case.app_id, "phoenix", {**destination, "api_key": empty})
        assert api_calls[-1][1]["headers"] == {
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "Cookie": "",
        }
        stored = case.read()
        assert stored is not None
        assert stored.tracing_config is not None
        assert (
            OpsTraceManager.decrypt_tracing_config(case.context.active_workspace_id, "phoenix", stored.tracing_config)[
                "api_key"
            ]
            == empty
        )
        case.service.update(case.context, case.app_id, "phoenix", {**destination, "api_key": "second-key"})
        assert api_calls[-1][1]["headers"] != api_calls[0][1]["headers"]
        assert len(api_calls) == 3

    @staticmethod
    @pytest.mark.parametrize("failure", ["denied", "wrong-path-html"])
    def test_failed_patch_preserves_policy_config_and_other_provider(
        case: PhoenixCase,
        api_calls: list[tuple[str, dict[str, object]]],
        api_responses: deque[httpx.Response | Exception],
        caplog: pytest.LogCaptureFixture,
        failure: str,
    ) -> None:
        original = {"endpoint": "https://host.test", "project": "project", "api_key": "private-secret"}
        case.service.create(case.context, case.app_id, "phoenix", original)
        before, other, policy = case.read(), case.read("langsmith"), case.reader.get_trace(case.context, case.app_id)
        if failure == "denied":
            api_responses.append(_phoenix_tracing_config_gateway_response({"secret": "private-vendor-response"}, 403))
        else:
            api_responses.append(
                httpx.Response(
                    200,
                    text="<html>private-vendor-response</html>",
                    request=httpx.Request("GET", "https://host.test/not-a-collector/v1/projects"),
                )
            )
        with pytest.raises(AppTracingConfigVerificationFailedError) as caught:
            case.service.update(
                case.context,
                case.app_id,
                "phoenix",
                {
                    **original,
                    "endpoint": "https://host.test/not-a-collector",
                    "api_key": "******",
                },
                activate=True,
            )
        assert isinstance(caught.value.__cause__, PhoenixConfigurationError)
        assert caught.value.__cause__.code == ("permission_denied" if failure == "denied" else "malformed_response")
        assert case.read() == before
        assert case.read("langsmith") == other
        assert case.reader.get_trace(case.context, case.app_id) == policy
        assert "private-vendor-response" not in caplog.text
        assert "private-secret" not in caplog.text
        assert len(api_calls) == 2

    @staticmethod
    @pytest.mark.parametrize("saved_url", [None, "https://stale.test/wrong-project"])
    def test_historical_get_calculates_url_without_verification_or_sdk(
        case: PhoenixCase,
        api_calls: list[tuple[str, dict[str, object]]],
        saved_url: str | None,
    ) -> None:
        stored = OpsTraceManager.encrypt_tracing_config(
            case.context.active_workspace_id,
            "phoenix",
            {
                "endpoint": "https://host.test/s/space/",
                "project": "historical project",
                "api_key": None,
            },
        )
        if saved_url:
            stored["project_url"] = saved_url
        shown = case.gateway.present_config(
            workspace_id=case.context.active_workspace_id, tracing_provider="phoenix", tracing_config=stored
        )
        assert shown["project_url"] == "https://host.test/s/space/redirects/projects/historical%20project"
        assert shown["api_key"] is None
        case.gateway.validate_saved_config(
            workspace_id=case.context.active_workspace_id, tracing_provider="phoenix", tracing_config=stored
        )
        assert api_calls == []

    @staticmethod
    @pytest.mark.parametrize(
        "endpoint", ["https://user:private@host.test?token=private", "https://host.test/v1/traces"]
    )
    def test_unsafe_historical_destination_is_readable_without_link_or_io(
        case: PhoenixCase,
        api_calls: list[tuple[str, dict[str, object]]],
        endpoint: str,
    ) -> None:
        stored = OpsTraceManager.encrypt_tracing_config(
            case.context.active_workspace_id,
            "phoenix",
            {
                "endpoint": endpoint,
                "project": "old-project",
                "api_key": None,
            },
        )
        shown = case.gateway.present_config(
            workspace_id=case.context.active_workspace_id, tracing_provider="phoenix", tracing_config=stored
        )
        assert shown["endpoint"] == endpoint
        assert shown["project_url"] is None
        assert api_calls == []

    @staticmethod
    @pytest.mark.parametrize("values", [{"endpoint": "https://host.test/v1/traces"}, {"project": "bad\nproject"}])
    def test_invalid_new_destination_has_no_io_or_storage_effect(
        case: PhoenixCase,
        api_calls: list[tuple[str, dict[str, object]]],
        values: dict[str, str],
    ) -> None:
        policy = case.reader.get_trace(case.context, case.app_id)
        with pytest.raises(AppTracingConfigInvalidConfigurationError):
            case.service.create(
                case.context, case.app_id, "phoenix", {"api_key": "synthetic-key", **values}, activate=True
            )
        assert case.read() is None
        assert case.reader.get_trace(case.context, case.app_id) == policy
        assert api_calls == []


"""Tencent configuration persistence uses real RSA and bounded protocol checks."""


CollectorBoundary = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-tencent.src.dify_trace_tencent.test_configuration"
).CollectorBoundary


@dataclass
class _TencentTracingConfigGatewayConfigurationcase:
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


class TestTencentTracingConfigGatewayCases:
    import importlib as _test_importlib

    _forbid_provider_io = _test_importlib.import_module(
        "tests.unit_tests.providers.trace.trace-tencent.src.dify_trace_tencent.test_configuration"
    )._forbid_provider_io

    _forbid_provider_io = staticmethod(_forbid_provider_io)

    import importlib as _test_importlib

    collector = _test_importlib.import_module(
        "tests.unit_tests.providers.trace.trace-tencent.src.dify_trace_tencent.test_configuration"
    ).collector

    collector = staticmethod(collector)

    @staticmethod
    @pytest.fixture
    def case(
        workspace: str, sqlite_session_factory: sessionmaker[Session], collector: CollectorBoundary
    ) -> _TencentTracingConfigGatewayConfigurationcase:
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
            {
                "api_key": "synthetic-existing-key",
                "project": "existing-project",
                "endpoint": "https://existing.example",
            },
        )
        assert store.create(
            workspace_id=workspace, app_id=app_id, tracing_provider="langsmith", tracing_config=old_config
        )
        return _TencentTracingConfigGatewayConfigurationcase(
            collector,
            gateway,
            AppTracingConfigService(configs=store, provider=gateway),
            store,
            ConsoleAppRepository(session_factory=sqlite_session_factory),
            RequestContext("request", None, "account", workspace),
            app_id,
        )

    @staticmethod
    def test_post_get_masked_patch_persist_normalization_and_preserve_real_ciphertext(
        case: _TencentTracingConfigGatewayConfigurationcase,
    ) -> None:
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
            OpsTraceManager.decrypt_tracing_config(case.context.active_workspace_id, "tencent", config)["token"]
            == secret
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
            workspace_id=case.context.active_workspace_id,
            tracing_provider="tencent",
            tracing_config=after.tracing_config,
        )
        assert case.service.get(case.context, case.app_id, "tencent") is not None
        assert len(case.collector.channels) == 2
        assert case.read("langsmith") == old_provider

    @staticmethod
    @pytest.mark.parametrize("saved_url", [None, "https://wrong.example/previous-project"])
    def test_historical_name_remains_readable_and_saved_validation_does_not_connect(
        case: _TencentTracingConfigGatewayConfigurationcase, saved_url: str | None
    ) -> None:
        stored = OpsTraceManager.encrypt_tracing_config(
            case.context.active_workspace_id,
            "tencent",
            {
                "token": "synthetic-historical-token",
                "endpoint": "https://legacy.example:4320",
                "service_name": "dify_app",
            },
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

    @staticmethod
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
        case: _TencentTracingConfigGatewayConfigurationcase,
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

    @staticmethod
    @pytest.mark.parametrize("existing", [False, True])
    @pytest.mark.parametrize("endpoint", ["https://collector.example:4320", "http://localhost:4317"])
    def test_rpc_failure_never_saves_or_activates_even_for_localhost(
        case: _TencentTracingConfigGatewayConfigurationcase,
        caplog: pytest.LogCaptureFixture,
        existing: bool,
        endpoint: str,
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

    @staticmethod
    def test_explicit_configuration_ignores_and_preserves_otel_environment(
        case: _TencentTracingConfigGatewayConfigurationcase, monkeypatch: pytest.MonkeyPatch
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


"""Config reads and writes must not construct Weave's stateful legacy exporter."""


ReadAPI = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-weave.src.dify_trace_weave.test_configuration"
).ReadAPI


@dataclass
class _WeaveTracingConfigGatewayGatewayenvironment:
    gateway: OpsTraceManagerGateway = field(default_factory=OpsTraceManagerGateway)
    api: ReadAPI = field(default_factory=ReadAPI)
    forbidden_calls: list[str] = field(default_factory=list)


class TestWeaveTracingConfigGatewayCases:
    @staticmethod
    @pytest.fixture
    def environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[_WeaveTracingConfigGatewayGatewayenvironment]:
        environment = _WeaveTracingConfigGatewayGatewayenvironment()

        def encrypt(_tenant: str, value: str) -> str:
            return "test-cipher:" + value

        def decrypt(_tenant: str, values: Sequence[str]) -> list[str]:
            assert all(value.startswith("test-cipher:") for value in values)
            return [value.removeprefix("test-cipher:") for value in values]

        def mask(_value: str) -> str:
            return "******"

        def forbidden(name: str) -> Callable[..., Never]:
            def block(*_args: object, **_kwargs: object) -> Never:
                environment.forbidden_calls.append(name)
                raise AssertionError("Configuration must not initialize a stateful exporter")

            return block

        monkeypatch.setattr(ops_trace_manager, "encrypt_token", encrypt)
        monkeypatch.setattr(ops_trace_manager, "batch_decrypt_token", decrypt)
        monkeypatch.setattr(ops_trace_manager, "obfuscated_token", mask)
        monkeypatch.setattr(ssrf_proxy, "post", environment.api.post)
        monkeypatch.setattr(WeaveDataTrace, "__init__", forbidden("legacy_constructor"))
        monkeypatch.setattr(wandb, "login", forbidden("wandb_login"))
        monkeypatch.setattr(weave, "init", forbidden("weave_init"))
        yield environment
        assert environment.forbidden_calls == []

    @staticmethod
    def test_create_persists_resolved_default_entity_and_canonical_project(
        environment: _WeaveTracingConfigGatewayGatewayenvironment,
    ) -> None:
        submitted = {"api_key": "synthetic-key", "project": " demo "}
        stored = environment.gateway.prepare_new_config(
            workspace_id=str(uuid4()), tracing_provider="weave", tracing_config=submitted
        )
        assert stored["entity"] == "default-team"
        assert stored["project"] == "demo"
        assert stored["project_url"] == "https://wandb.ai/default-team/demo"
        assert stored["api_key"] == "test-cipher:synthetic-key"
        assert submitted == {"api_key": "synthetic-key", "project": " demo "}
        assert len(environment.api.calls) == 3

    @staticmethod
    def test_patch_persists_verified_destination_with_the_existing_ciphertext(
        environment: _WeaveTracingConfigGatewayGatewayenvironment, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        workspace, app_id = str(uuid4()), str(uuid4())
        with sqlite_session_factory.begin() as session:
            session.add(make_app(app_id=app_id, tenant_id=workspace))
        store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
        service = AppTracingConfigService(configs=store, provider=environment.gateway)
        context = RequestContext("request", None, "account", workspace)
        service.create(context, app_id, "weave", {"api_key": "synthetic-key", "entity": "old", "project": "original"})
        before = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="weave")
        assert before is not None
        assert before.tracing_config is not None

        submitted = {"api_key": "******", "project": "new-team/changed"}
        service.update(context, app_id, "weave", submitted)
        after = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="weave")
        assert after is not None
        assert after.tracing_config is not None
        assert after.tracing_config["entity"] == "new-team"
        assert after.tracing_config["project"] == "changed"
        assert after.tracing_config["project_url"] == "https://wandb.ai/new-team/changed"
        assert after.tracing_config["api_key"] == before.tracing_config["api_key"] == "test-cipher:synthetic-key"
        assert before.tracing_config["project_url"] == "https://wandb.ai/old/original"
        assert submitted == {"api_key": "******", "project": "new-team/changed"}
        assert len(environment.api.calls) == 4

        presented = service.get(context, app_id, "weave")
        assert presented is not None
        assert presented.tracing_config is not None
        assert presented.tracing_config["api_key"] == "******"
        assert presented.tracing_config["project_url"] == after.tracing_config["project_url"]
        environment.gateway.validate_saved_config(
            workspace_id=workspace, tracing_provider="weave", tracing_config=after.tracing_config
        )
        assert len(environment.api.calls) == 4

    @staticmethod
    @pytest.mark.parametrize(
        ("entity", "project", "host", "expected"),
        [
            ("team", "demo", None, "https://wandb.ai/team/demo"),
            (None, "team/demo", None, "https://wandb.ai/team/demo"),
            (None, "demo", None, "https://wandb.ai"),
            (None, "demo", "http://private.test/wandb", "http://private.test/wandb"),
            ("team", "a & b", "https://private.test/wandb", "https://private.test/wandb/team/a%20%26%20b"),
        ],
    )
    def test_get_computes_project_or_console_link_without_vendor_requests(
        environment: _WeaveTracingConfigGatewayGatewayenvironment,
        entity: str | None,
        project: str,
        host: str | None,
        expected: str,
    ) -> None:
        workspace = str(uuid4())
        encrypted = OpsTraceManager.encrypt_tracing_config(
            workspace, "weave", {"api_key": "synthetic-key", "entity": entity, "project": project, "host": host}
        )
        encrypted["project_url"] = "https://stale.test/previous-project"
        result = environment.gateway.present_config(
            workspace_id=workspace, tracing_provider="weave", tracing_config=encrypted
        )
        assert result["project_url"] == expected
        assert result["api_key"] == "******"
        assert environment.api.calls == []

    @staticmethod
    def test_inaccessible_project_is_a_sanitized_domain_error_and_is_not_saved(
        environment: _WeaveTracingConfigGatewayGatewayenvironment,
        sqlite_session_factory: sessionmaker[Session],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        workspace, app_id = str(uuid4()), str(uuid4())
        with sqlite_session_factory.begin() as session:
            session.add(make_app(app_id=app_id, tenant_id=workspace))
        environment.api.project_exists = False
        store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
        service = AppTracingConfigService(configs=store, provider=environment.gateway)
        with pytest.raises(AppTracingConfigVerificationFailedError) as caught:
            service.create(
                RequestContext("request", None, "account", workspace),
                app_id,
                "weave",
                {
                    "api_key": "synthetic-private-key",
                    "entity": "team",
                    "project": "missing",
                },
            )
        assert isinstance(caught.value.__cause__, WeaveConfigurationError)
        assert caught.value.__cause__.code == "project_not_found_or_inaccessible"
        assert store.get(workspace_id=workspace, app_id=app_id, tracing_provider="weave") is None
        assert "synthetic-private-key" not in caplog.text
        assert "project_not_found_or_inaccessible" in caplog.text
        assert len(environment.api.calls) == 1
