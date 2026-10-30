import importlib as _test_importlib
import inspect
import json
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass, field
from uuid import UUID, uuid4

import pytest
from dify_trace_arize_phoenix.arize_phoenix_trace import ArizePhoenixDataTrace
from flask import Flask
from flask_restx import Api
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.rbac import AgentId, RBACCheck
from controllers.console import flask_admission, wraps
from controllers.console.agent import tracing
from controllers.console.agent.tracing import AgentTraceConfigApi
from controllers.console.app.app import AppTracePayload
from controllers.console.app.ops_trace import TraceAppConfigApi
from core.helper import ssrf_proxy
from core.ops.ops_trace_manager import OpsTraceManager
from enums import DeploymentEdition
from extensions.ext_application_services import ApplicationServices
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account, AccountStatus, TenantAccountRole
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.model import App, AppMode, TraceAppConfig
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from services.app.agent_app_contracts import AgentAppNotFoundError
from services.app_tracing_config_service import AppTraceSettings, AppTracingConfigRecord
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_app

pytest_plugins = ("tests.unit_tests.core.ops.test_ops_trace_manager",)

"""Agent tracing Console contracts and authorization stay separate from PlainApp."""


AGENT_ID = UUID("1fbc2f02-f7e0-4910-9032-cbe5bf6c65d5")
CONTEXT = RequestContext("request", None, "account", "tenant")


@dataclass
class ConfigCase:
    services: ApplicationServices
    calls: list[tuple[object, ...]] = field(default_factory=list)
    record: AppTracingConfigRecord | None = None
    failure: Exception | None = None


class TestTracingCases:
    @staticmethod
    @pytest.fixture
    def service(monkeypatch: pytest.MonkeyPatch, account_application_services: ApplicationServices) -> ConfigCase:
        case = ConfigCase(account_application_services)
        target = account_application_services.agent_tracing_configs

        def get_trace(context: RequestContext, agent_id: str) -> AppTraceSettings:
            case.calls.append(("get_trace", context, agent_id))
            if case.failure is not None:
                raise case.failure
            return AppTraceSettings()

        def set_trace(context: RequestContext, agent_id: str, settings: AppTraceSettings) -> None:
            case.calls.append(("set_trace", context, agent_id, settings))

        def get(context: RequestContext, agent_id: str, provider: str) -> AppTracingConfigRecord | None:
            case.calls.append(("get", context, agent_id, provider))
            return case.record

        def delete(context: RequestContext, agent_id: str, provider: str) -> None:
            case.calls.append(("delete", context, agent_id, provider))

        monkeypatch.setattr(target, "get_trace", get_trace)
        monkeypatch.setattr(target, "set_trace", set_trace)
        monkeypatch.setattr(target, "get", get)
        monkeypatch.setattr(target, "delete", delete)
        monkeypatch.setattr(tracing, "application_services", lambda: account_application_services)
        return case

    @staticmethod
    def test_status_round_trips_content_policy(app: Flask, service: ConfigCase) -> None:
        with app.test_request_context(
            json={"enabled": True, "tracing_provider": "langfuse", "capture_content": True, "capture_agent": False}
        ):
            result = inspect.unwrap(tracing.AgentTraceApi.post)(tracing.AgentTraceApi(), CONTEXT, AGENT_ID)
        assert result == {
            "enabled": True,
            "tracing_provider": "langfuse",
            "capture_content": True,
            "capture_agent": False,
        }
        assert service.calls == [("set_trace", CONTEXT, str(AGENT_ID), AppTraceSettings(True, "langfuse", True, False))]

    @staticmethod
    def test_enable_requires_provider_even_when_field_omitted() -> None:
        with pytest.raises(ValidationError, match="tracing_provider is required"):
            AppTracePayload.model_validate({"enabled": True})
        payload = AppTracePayload.model_validate({"enabled": False})
        assert payload.capture_content is False
        assert payload.capture_agent is True

    @staticmethod
    @pytest.mark.parametrize("enabled", [False, True])
    def test_capabilities_reports_current_api_gate_without_claiming_runtime_delivery(
        app: Flask, service: ConfigCase, monkeypatch: pytest.MonkeyPatch, enabled: bool
    ) -> None:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=enabled)
        with app.test_request_context("/?tracing_provider=langfuse"):
            result = inspect.unwrap(tracing.AgentTraceCapabilitiesApi.get)(
                tracing.AgentTraceCapabilitiesApi(), CONTEXT, AGENT_ID
            )
        assert service.calls == [("get_trace", CONTEXT, str(AGENT_ID))]
        assert result["api_collection_enabled"] is enabled
        assert result["agent_spans"] is True
        assert result["export_ack"] == "accepted"
        assert "runtime_enabled" not in result
        assert "queryable" not in result

    @staticmethod
    @pytest.mark.parametrize("enabled", [False, True])
    def test_app_capabilities_reports_api_gate(
        app: Flask, monkeypatch: pytest.MonkeyPatch, enabled: bool, service: ConfigCase
    ) -> None:
        calls: list[tuple[RequestContext, str]] = []

        def get_trace(context: RequestContext, app_id: str) -> AppTraceSettings:
            calls.append((context, app_id))
            return AppTraceSettings()

        monkeypatch.setattr(service.services.apps.console, "get_trace", get_trace)
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=enabled)
        with app.test_request_context("/?tracing_provider=mlflow"):
            result = inspect.unwrap(tracing.AppTraceCapabilitiesApi.get)(
                tracing.AppTraceCapabilitiesApi(), CONTEXT, AGENT_ID
            )
        assert result["api_collection_enabled"] is enabled
        assert result["provider"] == "mlflow"
        assert calls == [(CONTEXT, str(AGENT_ID))]

    @staticmethod
    def test_get_config_absent_and_delete_has_no_body(app: Flask, service: ConfigCase) -> None:
        with app.test_request_context("/?tracing_provider=langfuse"):
            assert inspect.unwrap(tracing.AgentTraceConfigApi.get)(
                tracing.AgentTraceConfigApi(), CONTEXT, AGENT_ID
            ) == {"has_not_configured": True}
            assert inspect.unwrap(tracing.AgentTraceConfigApi.delete)(
                tracing.AgentTraceConfigApi(), CONTEXT, AGENT_ID
            ) == (
                "",
                204,
            )
        assert service.calls == [
            ("get", CONTEXT, str(AGENT_ID), "langfuse"),
            ("delete", CONTEXT, str(AGENT_ID), "langfuse"),
        ]

    @staticmethod
    def test_invalid_agent_returns_not_found(app: Flask, service: ConfigCase) -> None:
        service.failure = AgentAppNotFoundError()
        with app.test_request_context(), pytest.raises(NotFound):
            inspect.unwrap(tracing.AgentTraceApi.get)(tracing.AgentTraceApi(), CONTEXT, AGENT_ID)

    @staticmethod
    @pytest.mark.parametrize(
        "method",
        [
            tracing.AgentTraceApi.post,
            tracing.AgentTraceConfigApi.get,
            tracing.AgentTraceConfigApi.post,
            tracing.AgentTraceConfigApi.patch,
            tracing.AgentTraceConfigApi.delete,
        ],
    )
    @pytest.mark.parametrize("rbac_enabled", [False, True])
    def test_config_requires_editor_role_or_agent_edit_permission(
        app: Flask, monkeypatch: pytest.MonkeyPatch, method: Callable[..., object], rbac_enabled: bool
    ) -> None:
        account = Account(name="Reader", email="reader@example.com", status=AccountStatus.ACTIVE)
        account.id, account.role = "account", TenantAccountRole.NORMAL
        apply_config_overrides(monkeypatch, RBAC_ENABLED=rbac_enabled)
        monkeypatch.setattr(
            flask_admission,
            "current_account_with_tenant",
            lambda: AccountWithTenant(account=account, tenant_id="tenant"),
        )
        denied_calls: list[dict[str, object]] = []

        def denied(**kwargs: object) -> None:
            denied_calls.append(kwargs)
            raise Forbidden()

        monkeypatch.setattr(flask_admission, "enforce_rbac_checks", denied)
        admission = inspect.unwrap(
            method, stop=lambda candidate: "allowed_roles" in inspect.getclosurevars(candidate).nonlocals
        )
        with app.test_request_context(), pytest.raises(Forbidden):
            admission(None, agent_id=AGENT_ID)
        if rbac_enabled:
            checks = denied_calls[0]["checks"]
            assert isinstance(checks, (list, tuple))
            (check,) = checks
            assert isinstance(check, RBACCheck)
            assert check.scene == tracing.RBACPermission.AGENT_EDIT
            assert isinstance(check.locator, AgentId)
            assert denied_calls[0]["path_args"] == {"agent_id": AGENT_ID}
        else:
            assert denied_calls == []

    @staticmethod
    def test_read_settings_and_masked_config_keep_agent_identity(app: Flask, service: ConfigCase) -> None:
        from datetime import UTC, datetime

        now = datetime(2026, 1, 1, tzinfo=UTC)
        service.record = AppTracingConfigRecord(
            id="config",
            app_id="backing-app",
            tracing_provider="langfuse",
            tracing_config={"secret_key": "[__HIDDEN__]", "project_url": "https://example.test/project"},
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        with app.test_request_context("/?tracing_provider=langfuse"):
            settings = inspect.unwrap(tracing.AgentTraceApi.get)(tracing.AgentTraceApi(), CONTEXT, AGENT_ID)
            config = inspect.unwrap(tracing.AgentTraceConfigApi.get)(tracing.AgentTraceConfigApi(), CONTEXT, AGENT_ID)
        assert settings == {"enabled": False, "tracing_provider": None, "capture_content": False, "capture_agent": True}
        assert config["tracing_config"] == service.record.tracing_config
        assert config["app_id"] == "backing-app"
        assert service.calls == [("get_trace", CONTEXT, str(AGENT_ID)), ("get", CONTEXT, str(AGENT_ID), "langfuse")]

    @staticmethod
    @pytest.mark.parametrize("create", [True, False])
    @pytest.mark.parametrize("activate", [False, True])
    def test_config_write_forwards_credentials_but_response_does_not_echo_them(
        app: Flask, service: ConfigCase, monkeypatch: pytest.MonkeyPatch, create: bool, activate: bool
    ) -> None:
        calls: list[tuple[RequestContext, str, str, dict[str, object], bool]] = []

        def write(
            context: RequestContext, agent_id: str, provider: str, config: dict[str, object], *, activate: bool
        ) -> None:
            calls.append((context, agent_id, provider, config, activate))

        target = service.services.agent_tracing_configs
        monkeypatch.setattr(target, "create" if create else "update", write)
        credentials = {"secret_key": "never-echo-this-secret"}
        with app.test_request_context(
            method="POST" if create else "PATCH",
            json={"tracing_provider": "langfuse", "tracing_config": credentials, "activate": activate},
        ):
            api = tracing.AgentTraceConfigApi()
            result = inspect.unwrap(api.post if create else api.patch)(api, CONTEXT, AGENT_ID)
        assert calls == [(CONTEXT, str(AGENT_ID), "langfuse", credentials, activate)]
        assert result == (({"result": "success"}, 201) if create else {"result": "success"})
        assert "never-echo-this-secret" not in str(result)

    @staticmethod
    @pytest.mark.parametrize(
        ("error", "expected"),
        [
            (tracing.ConsoleAppNotFoundError(), NotFound),
            (tracing.AppTracingConfigAppNotFoundError(), tracing.AppNotFoundError),
            (tracing.AppTracingConfigAlreadyExistsError(), tracing.TracingConfigAlreadyExistsError),
            (tracing.AppTracingConfigNotFoundError(), tracing.TracingConfigNotFoundError),
            (tracing.AppTracingConfigConflictError(), tracing.TracingConfigConflictError),
            (
                tracing.AppTracingConfigInvalidProviderError("private-provider-secret"),
                tracing.UnsupportedTracingProviderError,
            ),
            (tracing.AppTracingConfigProviderUnavailableError(), tracing.TracingProviderUnavailableError),
            (tracing.AppTracingConfigInvalidConfigurationError(), tracing.InvalidTracingConfigError),
            (tracing.AppTracingConfigVerificationFailedError(), tracing.TracingConfigVerificationFailedError),
            (tracing.AppTracingConfigProcessingError(), tracing.TracingConfigProcessingError),
        ],
    )
    def test_config_domain_errors_use_public_contract_without_provider_details(
        app: Flask, service: ConfigCase, error: Exception, expected: type[Exception]
    ) -> None:
        service.failure = error
        with app.test_request_context(), pytest.raises(expected) as caught:
            inspect.unwrap(tracing.AgentTraceApi.get)(tracing.AgentTraceApi(), CONTEXT, AGENT_ID)
        assert "private-provider-secret" not in str(caught.value)

    @staticmethod
    def test_unknown_capability_and_missing_app_return_public_errors(
        app: Flask, service: ConfigCase, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with (
            app.test_request_context("/?tracing_provider=unknown"),
            pytest.raises(tracing.UnsupportedTracingProviderError),
        ):
            inspect.unwrap(tracing.AgentTraceCapabilitiesApi.get)(
                tracing.AgentTraceCapabilitiesApi(), CONTEXT, AGENT_ID
            )

        def missing(_context: RequestContext, _app_id: str) -> AppTraceSettings:
            raise tracing.ConsoleAppNotFoundError()

        monkeypatch.setattr(service.services.apps.console, "get_trace", missing)
        with app.test_request_context("/?tracing_provider=langfuse"), pytest.raises(NotFound):
            inspect.unwrap(tracing.AppTraceCapabilitiesApi.get)(tracing.AppTraceCapabilitiesApi(), CONTEXT, AGENT_ID)


"""Both real config Resources reach the same ACK gate before atomic SQL updates.

HTTP dispatch, payload validation, owner resolution, DI services, encryption and
SQLite persistence are real. Login admission supplies a local owner account and
the existing RSA fixture supplies private-key storage; no external account is used.
"""


_324fde08_TestArizeConfigurationAckCases = _test_importlib.import_module(
    "tests.unit_tests.providers.trace.trace-arize-phoenix.src.dify_trace_arize_phoenix.test_arize_configuration"
).TestArizeConfigurationAckCases


class TestArizeTracingAckRoutesCases:
    collector = staticmethod(_324fde08_TestArizeConfigurationAckCases.collector)

    @staticmethod
    @pytest.mark.parametrize("surface", ["app", "agent"])
    @pytest.mark.parametrize("method", ["POST", "PATCH"])
    def test_config_write_rejects_bad_ack_without_changing_old_rows_policy_or_cache(
        workspace: str,
        sqlite_session_factory: sessionmaker[Session],
        account_application_services: ApplicationServices,
        monkeypatch: pytest.MonkeyPatch,
        collector: tuple[str, list[tuple[bytes, dict[str, str]]], dict[str, object]],
        surface: str,
        method: str,
    ) -> None:
        endpoint, calls, _ = collector
        app_id, agent_id, account_id = (str(uuid4()) for _ in range(3))
        old_policy = json.dumps(
            {"enabled": True, "tracing_provider": "langsmith", "capture_content": False, "capture_agent": False}
        )
        with sqlite_session_factory.begin() as session:
            session.add(
                make_app(
                    app_id=app_id,
                    tenant_id=workspace,
                    mode=AppMode.AGENT if surface == "agent" else AppMode.WORKFLOW,
                    tracing=old_policy,
                )
            )
            if surface == "agent":
                session.add(
                    Agent(
                        id=agent_id,
                        tenant_id=workspace,
                        name="ACK test",
                        scope=AgentScope.ROSTER,
                        source=AgentSource.AGENT_APP,
                        app_id=app_id,
                        status=AgentStatus.ACTIVE,
                        created_by=account_id,
                        updated_by=account_id,
                    )
                )
        store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
        original = OpsTraceManager.encrypt_tracing_config(
            workspace, "langsmith", {"api_key": "other-provider-key", "project": "other"}
        )
        assert store.create(
            workspace_id=workspace, app_id=app_id, tracing_provider="langsmith", tracing_config=original
        )
        if method == "PATCH":
            old = OpsTraceManager.encrypt_tracing_config(
                workspace,
                "arize",
                {
                    "endpoint": endpoint,
                    "project": "old-project",
                    "api_key": "synthetic-good",
                    "space_id": "synthetic-space",
                },
            )
            old.update(
                {
                    "project_url": "https://app.arize.com/?redirect_project_name=old-project",
                    "arize_project_destination": {"legacy": "unchanged"},
                }
            )
            assert store.create(workspace_id=workspace, app_id=app_id, tracing_provider="arize", tracing_config=old)
        with sqlite_session_factory() as session:
            before = deepcopy(
                list(
                    session.execute(
                        select(TraceAppConfig.__table__)
                        .where(TraceAppConfig.app_id == app_id)
                        .order_by(TraceAppConfig.id)
                    ).mappings()
                )
            )

        account = Account(name="Owner", email="owner@example.test", status=AccountStatus.ACTIVE)
        account.id, account.role = account_id, TenantAccountRole.OWNER
        identity = AccountWithTenant(account, workspace)
        monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: identity)
        monkeypatch.setattr(wraps, "current_account_with_tenant", lambda: identity)
        apply_config_overrides(
            monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, LOGIN_DISABLED=True, RBAC_ENABLED=False
        )

        def forbidden(*_args: object, **_kwargs: object) -> None:
            pytest.fail("Local custom collector verification must not perform optional Cloud HTTP reads")

        monkeypatch.setattr(ssrf_proxy, "get", forbidden)
        monkeypatch.setattr(ArizePhoenixDataTrace, "__init__", forbidden)
        app = Flask(__name__)
        app.extensions["application_services"] = account_application_services
        api = Api(app)
        api.add_resource(TraceAppConfigApi, "/console/api/apps/<uuid:app_id>/trace-config")
        api.add_resource(AgentTraceConfigApi, "/console/api/agent/<uuid:agent_id>/trace-config")
        url = (
            f"/console/api/apps/{app_id}/trace-config"
            if surface == "app"
            else f"/console/api/agent/{agent_id}/trace-config"
        )
        values = {
            "endpoint": endpoint,
            "project": "not-created-by-verification",
            "api_key": "synthetic-invalid",
            "space_id": "synthetic-space",
        }
        with app.test_client() as client:
            failed = client.open(
                url, method=method, json={"tracing_provider": "arize", "tracing_config": values, "activate": True}
            )
            assert failed.status_code == 400
            body = failed.json
            assert isinstance(body, dict)
            assert body["code"] == "tracing_config_verification_failed"
            assert "private-vendor-details" not in failed.get_data(as_text=True)
            assert "synthetic-invalid" not in failed.get_data(as_text=True)
            with sqlite_session_factory() as session:
                after = list(
                    session.execute(
                        select(TraceAppConfig.__table__)
                        .where(TraceAppConfig.app_id == app_id)
                        .order_by(TraceAppConfig.id)
                    ).mappings()
                )
                assert after == before
                assert session.scalar(select(App.tracing).where(App.id == app_id)) == old_policy
            values["api_key"] = "synthetic-good"
            accepted = client.open(
                url, method=method, json={"tracing_provider": "arize", "tracing_config": values, "activate": True}
            )
            assert accepted.status_code == (201 if method == "POST" else 200)
        saved = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="arize")
        assert saved is not None
        assert saved.tracing_config is not None
        assert (
            OpsTraceManager.decrypt_tracing_config(workspace, "arize", saved.tracing_config)["api_key"]
            == "synthetic-good"
        )
        assert "project_url" not in saved.tracing_config
        assert "arize_project_destination" not in saved.tracing_config
        assert len(calls) == 2
        with sqlite_session_factory() as session:
            policy = json.loads(session.scalar(select(App.tracing).where(App.id == app_id)) or "{}")
        assert policy == {
            "enabled": True,
            "tracing_provider": "arize",
            "capture_content": False,
            "capture_agent": False,
        }
        if method == "PATCH":
            with app.test_client() as client:
                masked = client.patch(
                    url,
                    json={
                        "tracing_provider": "arize",
                        "tracing_config": {
                            **values,
                            "project": "next-project",
                            "api_key": "******",
                            "space_id": "******",
                        },
                    },
                )
                assert masked.status_code == 200
            updated = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="arize")
            assert updated is not None
            assert updated.tracing_config is not None
            assert updated.tracing_config["api_key"] == saved.tracing_config["api_key"]
            assert updated.tracing_config["space_id"] == saved.tracing_config["space_id"]
            assert calls[-1][1]["api_key"] == "synthetic-good"
            assert calls[-1][1]["space_id"] == "synthetic-space"
            assert len(calls) == 3
