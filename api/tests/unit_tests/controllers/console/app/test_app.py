from __future__ import annotations

import inspect
import json
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass, replace
from dataclasses import field as app_field
from datetime import datetime
from inspect import unwrap
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, patch
from uuid import UUID

import pytest
import yaml
from flask import Flask, Response
from flask_restx import Resource
from pydantic import ValidationError
from sqlalchemy import Engine
from sqlalchemy.orm import Session
from werkzeug.datastructures import MultiDict
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from controllers.console import flask_admission
from controllers.console.app import (
    annotation as annotation_module,
)
from controllers.console.app import (
    app as app_module,
)
from controllers.console.app import app as controller
from controllers.console.app import (
    completion as completion_module,
)
from controllers.console.app import (
    message as message_module,
)
from controllers.console.app import (
    ops_trace as ops_trace_module,
)
from controllers.console.app import (
    site as site_module,
)
from controllers.console.app import (
    statistic as statistic_module,
)
from controllers.console.app import (
    workflow_app_log as workflow_app_log_module,
)
from controllers.console.app import (
    workflow_draft_variable as workflow_draft_variable_module,
)
from controllers.console.app import (
    workflow_statistic as workflow_statistic_module,
)
from controllers.console.app import (
    wraps as wraps_module,
)
from controllers.console.app.app import CreateAppPayload
from controllers.console.app.completion import ChatMessagePayload, CompletionMessagePayload
from controllers.console.app.error import (
    AppNotFoundError,
    TracingConfigNotFoundError,
    TracingConfigVerificationFailedError,
)
from controllers.console.app.mcp_server import MCPServerCreatePayload, MCPServerUpdatePayload
from controllers.console.app.ops_trace import TraceConfigPayload, TraceProviderQuery
from controllers.console.app.site import AppSiteUpdatePayload
from controllers.console.app.workflow import AdvancedChatWorkflowRunPayload, SyncDraftWorkflowPayload
from controllers.console.app.workflow_app_log import WorkflowAppLogQuery
from controllers.console.app.workflow_draft_variable import (
    EnvironmentVariableUpdatePayload,
    WorkflowDraftVariableListQuery,
    WorkflowDraftVariableUpdatePayload,
)
from controllers.console.app.workflow_statistic import WorkflowStatisticQuery
from fields import app_fields
from fields.app_model_config_response import AppModelConfigResponse
from libs.login import AccountWithTenant
from libs.pagination import PaginatedResult
from machinery.context import RequestContext
from models import App as _app_apis_App
from models import Site as _app_apis_Site
from models.account import Account, AccountStatus, TenantAccountRole
from models.engine import db
from models.enums import CustomizeTokenStrategy, TagType
from models.model import App as _app_response_models_App
from models.model import AppMode, AppModelConfig, IconType, Tag, TagBinding
from models.model import Site as _app_response_models_Site
from models.workflow import Workflow, WorkflowType
from repositories.app.response import app_record
from services.agent.roster_package_entities import RosterAgentPackageExport
from services.app.console_service import (
    AppExportPaidPlanRequiredError,
    ConsoleAppNotFoundError,
    CreatorsPlatformDisabledError,
    InvalidAppExportError,
)
from services.app_service import AppResponseView
from services.app_site_service import (
    AppSiteAppNotFoundError,
    AppSiteChanges,
    AppSiteCommandResult,
    AppSiteNotFoundError,
)
from services.app_tracing_config_service import (
    AppTraceSettings,
    AppTracingConfigNotFoundError,
    AppTracingConfigVerificationFailedError,
)
from services.entities.app_entities import (
    AppExportOptions,
    AppListParams,
    AppPage,
    AppRecord,
    CopyAppParams,
    CreateAppParams,
    StarredAppListParams,
    UpdateAppParams,
)
from services.entities.dsl_entities import Import, ImportStatus
from tests.helpers.unit.config_override import apply_config_overrides

"""Unit coverage for console app controller contracts and response mapping."""


_APP_APIS_APP_ID = "11111111-1111-1111-1111-111111111111"
_APP_APIS_TENANT_ID = "22222222-2222-2222-2222-222222222222"
USER_ID = "33333333-3333-3333-3333-333333333333"


def _make_account() -> Account:
    account = Account(
        name="tester",
        email="tester@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = USER_ID
    return account


def _make_app(
    app_id: str = _APP_APIS_APP_ID,
    *,
    tenant_id: str = _APP_APIS_TENANT_ID,
    icon_type: app_module.IconType | None = None,
) -> _app_apis_App:
    app = _app_apis_App()
    app.id = app_id
    app.tenant_id = tenant_id
    app.icon_type = icon_type
    return app


def _make_request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id=USER_ID,
        active_workspace_id=_APP_APIS_TENANT_ID,
    )


class TestAppApisCases:
    @staticmethod
    @pytest.fixture
    def database_app() -> Iterator[Flask]:
        app = Flask(__name__)
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        db.init_app(app)

        with app.app_context():
            _app_apis_Site.__table__.create(db.engine)
            yield app

    class TestCompletionEndpoints:
        def test_completion_create_payload(self):
            payload = CompletionMessagePayload(inputs={"prompt": "test"}, model_config={})
            assert payload.inputs == {"prompt": "test"}

        def test_chat_message_payload_uuid_validation(self):
            payload = ChatMessagePayload(
                inputs={},
                model_config={},
                query="hi",
                conversation_id=str(uuid.uuid4()),
                parent_message_id=str(uuid.uuid4()),
            )
            assert payload.query == "hi"

        def test_completion_api_success(
            self, app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
        ) -> None:
            api = completion_module.CompletionMessageApi()
            method = unwrap(api.post)

            monkeypatch.setattr(
                completion_module.AppGenerateService,
                "generate",
                lambda **_kwargs: {"text": "ok"},
            )
            monkeypatch.setattr(
                completion_module.helper,
                "compact_generate_response",
                lambda response: {"result": response},
            )

            with (
                Session(sqlite_engine) as session,
                app.test_request_context("/", json={"inputs": {}, "model_config": {}, "query": "hi"}),
            ):
                resp = method(
                    api,
                    CompletionMessagePayload(inputs={}, model_config={}, query="hi"),
                    session,
                    _make_account(),
                    app_model=_make_app(),
                )

            assert resp == {"result": {"text": "ok"}}

        def test_completion_api_conversation_not_exists(
            self, app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
        ) -> None:
            api = completion_module.CompletionMessageApi()
            method = unwrap(api.post)

            monkeypatch.setattr(
                completion_module.AppGenerateService,
                "generate",
                lambda **_kwargs: (_ for _ in ()).throw(
                    completion_module.services.errors.conversation.ConversationNotExistsError()
                ),
            )

            with (
                Session(sqlite_engine) as session,
                app.test_request_context("/", json={"inputs": {}, "model_config": {}, "query": "hi"}),
                pytest.raises(NotFound),
            ):
                method(
                    api,
                    CompletionMessagePayload(inputs={}, model_config={}, query="hi"),
                    session,
                    _make_account(),
                    app_model=_make_app(),
                )

        def test_completion_api_provider_not_initialized(
            self, app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
        ) -> None:
            api = completion_module.CompletionMessageApi()
            method = unwrap(api.post)

            monkeypatch.setattr(
                completion_module.AppGenerateService,
                "generate",
                lambda **_kwargs: (_ for _ in ()).throw(completion_module.ProviderTokenNotInitError("x")),
            )

            with (
                Session(sqlite_engine) as session,
                app.test_request_context("/", json={"inputs": {}, "model_config": {}, "query": "hi"}),
                pytest.raises(completion_module.ProviderNotInitializeError),
            ):
                method(
                    api,
                    CompletionMessagePayload(inputs={}, model_config={}, query="hi"),
                    session,
                    _make_account(),
                    app_model=_make_app(),
                )

        def test_completion_api_quota_exceeded(
            self, app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
        ) -> None:
            api = completion_module.CompletionMessageApi()
            method = unwrap(api.post)

            monkeypatch.setattr(
                completion_module.AppGenerateService,
                "generate",
                lambda **_kwargs: (_ for _ in ()).throw(completion_module.QuotaExceededError()),
            )

            with (
                Session(sqlite_engine) as session,
                app.test_request_context("/", json={"inputs": {}, "model_config": {}, "query": "hi"}),
                pytest.raises(completion_module.ProviderQuotaExceededError),
            ):
                method(
                    api,
                    CompletionMessagePayload(inputs={}, model_config={}, query="hi"),
                    session,
                    _make_account(),
                    app_model=_make_app(),
                )

    class TestOpsTraceEndpoints:
        def test_ops_trace_query_basic(self):
            query = TraceProviderQuery(tracing_provider="langfuse")
            assert query.tracing_provider == "langfuse"

        def test_ops_trace_config_payload(self):
            payload = TraceConfigPayload(tracing_provider="langfuse", tracing_config={"api_key": "k"})
            assert payload.tracing_config["api_key"] == "k"

        def test_trace_app_config_get_empty(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
            api = ops_trace_module.TraceAppConfigApi()
            method = unwrap(api.get)
            tracing_configs = MagicMock()
            tracing_configs.get.return_value = None
            monkeypatch.setattr(
                ops_trace_module,
                "application_services",
                lambda: SimpleNamespace(app_tracing_configs=tracing_configs),
            )

            with app.test_request_context("/?tracing_provider=langfuse"):
                result = method(
                    api,
                    TraceProviderQuery(tracing_provider="langfuse"),
                    _make_request_context(),
                    uuid.UUID(_APP_APIS_APP_ID),
                )

            assert result == {"has_not_configured": True}
            tracing_configs.get.assert_called_once_with(
                context=_make_request_context(),
                app_id=_APP_APIS_APP_ID,
                tracing_provider="langfuse",
            )

        def test_trace_app_config_post_invalid(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
            api = ops_trace_module.TraceAppConfigApi()
            method = unwrap(api.post)
            tracing_configs = MagicMock()
            tracing_configs.create.side_effect = AppTracingConfigVerificationFailedError()
            monkeypatch.setattr(
                ops_trace_module,
                "application_services",
                lambda: SimpleNamespace(app_tracing_configs=tracing_configs),
            )

            with app.test_request_context(
                "/",
                json={"tracing_provider": "langfuse", "tracing_config": {"api_key": "k"}},
            ):
                with pytest.raises(TracingConfigVerificationFailedError):
                    method(
                        api,
                        TraceConfigPayload(tracing_provider="langfuse", tracing_config={"api_key": "k"}),
                        _make_request_context(),
                        uuid.UUID(_APP_APIS_APP_ID),
                    )

        def test_trace_app_config_delete_not_found(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
            api = ops_trace_module.TraceAppConfigApi()
            method = unwrap(api.delete)
            tracing_configs = MagicMock()
            tracing_configs.delete.side_effect = AppTracingConfigNotFoundError()
            monkeypatch.setattr(
                ops_trace_module,
                "application_services",
                lambda: SimpleNamespace(app_tracing_configs=tracing_configs),
            )

            with app.test_request_context("/?tracing_provider=langfuse"):
                with pytest.raises(TracingConfigNotFoundError):
                    method(
                        api,
                        TraceProviderQuery(tracing_provider="langfuse"),
                        _make_request_context(),
                        uuid.UUID(_APP_APIS_APP_ID),
                    )

    class TestSiteEndpoints:
        @staticmethod
        def _command_result(*, code: str = "test-code") -> AppSiteCommandResult:
            return AppSiteCommandResult(
                app_id=_APP_APIS_APP_ID,
                title="My Site",
                description="Test site",
                default_language="en-US",
                input_placeholder="Ask me anything",
                code=code,
                icon=None,
                icon_background=None,
                customize_domain=None,
                copyright=None,
                privacy_policy=None,
                custom_disclaimer="",
                customize_token_strategy="not_allow",
                prompt_public=False,
                show_workflow_steps=True,
                use_icon_as_answer_icon=False,
            )

        def test_site_payload_maps_to_application_changes(self):
            payload = AppSiteUpdatePayload(
                title="My Site",
                description="Test site",
                input_placeholder="Ask me anything",
            )
            assert payload.to_changes() == AppSiteChanges(
                title="My Site",
                description="Test site",
                input_placeholder="Ask me anything",
            )

        def test_site_default_language_validation(self):
            payload = AppSiteUpdatePayload(default_language="en-US")
            assert payload.default_language == "en-US"

        def test_app_site_update_post(
            self,
        ) -> None:
            api = site_module.AppSite()
            method = unwrap(api.post)
            services = MagicMock()
            services.app_sites.update.return_value = self._command_result()
            context = RequestContext("request-1", None, USER_ID, _APP_APIS_TENANT_ID)

            with patch.object(site_module, "application_services", return_value=services):
                result = method(
                    api,
                    AppSiteUpdatePayload(title="My Site", input_placeholder="Ask me anything"),
                    context,
                    app_id=uuid.UUID(_APP_APIS_APP_ID),
                )

            assert isinstance(result, dict)
            assert result["title"] == "My Site"
            assert result["input_placeholder"] == "Ask me anything"
            assert result["access_token"] == "test-code"
            assert result["code"] == "test-code"
            services.app_sites.update.assert_called_once_with(
                context,
                _APP_APIS_APP_ID,
                AppSiteChanges(title="My Site", input_placeholder="Ask me anything"),
            )

        def test_app_site_access_token_reset(
            self,
        ) -> None:
            api = site_module.AppSiteAccessTokenReset()
            method = unwrap(api.post)
            services = MagicMock()
            services.app_sites.reset_access_token.return_value = self._command_result(code="new-code")
            context = RequestContext("request-1", None, USER_ID, _APP_APIS_TENANT_ID)

            with patch.object(site_module, "application_services", return_value=services):
                result = method(api, context, app_id=uuid.UUID(_APP_APIS_APP_ID))

            assert isinstance(result, dict)
            assert result["access_token"] == "new-code"
            assert result["code"] == "new-code"
            services.app_sites.reset_access_token.assert_called_once_with(context, _APP_APIS_APP_ID)

        def test_app_site_update_maps_missing_app(self) -> None:
            api = site_module.AppSite()
            method = unwrap(api.post)
            services = MagicMock()
            services.app_sites.update.side_effect = AppSiteAppNotFoundError()
            context = RequestContext("request-1", None, USER_ID, _APP_APIS_TENANT_ID)

            with (
                patch.object(site_module, "application_services", return_value=services),
                pytest.raises(AppNotFoundError),
            ):
                method(api, AppSiteUpdatePayload(), context, app_id=uuid.UUID(_APP_APIS_APP_ID))

        def test_app_site_reset_maps_missing_site(self) -> None:
            api = site_module.AppSiteAccessTokenReset()
            method = unwrap(api.post)
            services = MagicMock()
            services.app_sites.reset_access_token.side_effect = AppSiteNotFoundError()
            context = RequestContext("request-1", None, USER_ID, _APP_APIS_TENANT_ID)

            with (
                patch.object(site_module, "application_services", return_value=services),
                pytest.raises(NotFound),
            ):
                method(api, context, app_id=uuid.UUID(_APP_APIS_APP_ID))

    class TestWorkflowEndpoints:
        def test_workflow_copy_payload(self):
            payload = SyncDraftWorkflowPayload(graph={}, features={})
            assert payload.graph == {}
            assert payload.model_dump()["is_collaborative"] is False

        def test_workflow_sync_payload_accepts_collaboration_marker(self):
            payload = SyncDraftWorkflowPayload.model_validate({"graph": {}, "features": {}, "_is_collaborative": True})
            assert payload.is_collaborative is True
            assert payload.model_dump()["is_collaborative"] is True

        def test_workflow_mode_query(self):
            payload = AdvancedChatWorkflowRunPayload(inputs={}, query="hi")
            assert payload.query == "hi"

    class TestWorkflowAppLogEndpoints:
        def test_workflow_app_log_query(self):
            query = WorkflowAppLogQuery(keyword="test", page=1, limit=20)
            assert query.keyword == "test"

        def test_workflow_app_log_query_detail_bool(self):
            query = WorkflowAppLogQuery(detail="true")
            assert query.detail is True

        def test_workflow_app_log_api_get(self, database_app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
            api = workflow_app_log_module.WorkflowAppLogApi()
            method = unwrap(api.get)
            workflow_app_logs = MagicMock()
            workflow_app_logs.list_logs.return_value = {
                "page": 1,
                "limit": 20,
                "total": 0,
                "has_more": False,
                "data": [],
            }
            services = MagicMock(workflow_app_logs=workflow_app_logs)
            monkeypatch.setattr(workflow_app_log_module, "application_services", lambda: services)
            context = RequestContext("request-1", None, USER_ID, _APP_APIS_TENANT_ID)
            app_model = _make_app("app-1")

            with database_app.test_request_context("/?page=1&limit=20"):
                result = method(api, WorkflowAppLogQuery(page=1, limit=20), context, app_model=app_model)

            assert result == {"page": 1, "limit": 20, "total": 0, "has_more": False, "data": []}
            workflow_app_logs.list_logs.assert_called_once_with(
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                keyword=None,
                status=None,
                created_at_before=None,
                created_at_after=None,
                page=1,
                limit=20,
                detail=False,
                created_by_end_user_session_id=None,
                created_by_account=None,
            )

    class TestWorkflowDraftVariableEndpoints:
        def test_workflow_variable_creation(self):
            payload = WorkflowDraftVariableUpdatePayload(name="var1", value="test")
            assert payload.name == "var1"

        def test_workflow_variable_collection_get(self, database_app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
            api = workflow_draft_variable_module.WorkflowVariableCollectionApi()
            method = unwrap(api.get)

            class DummyDraftService:
                def __init__(self, session: Session):
                    self.session = session

                def list_variables_without_values(self, **_kwargs):
                    assert self.session.get_bind() is db.engine
                    return {"items": [], "total": 0}

            class DummyWorkflowService:
                def is_workflow_exist(self, *args, **kwargs):
                    return True

            monkeypatch.setattr(workflow_draft_variable_module, "WorkflowDraftVariableService", DummyDraftService)
            monkeypatch.setattr(workflow_draft_variable_module, "WorkflowService", DummyWorkflowService)

            with database_app.test_request_context("/?page=1&limit=20"):
                result = method(
                    api,
                    WorkflowDraftVariableListQuery(page=1, limit=20),
                    _make_account(),
                    app_model=_make_app("app-1"),
                )

            assert result == {"items": [], "total": 0}

        def test_environment_variable_update_payload_preserves_full_replace_default(self) -> None:
            payload = EnvironmentVariableUpdatePayload(environment_variables=[])

            assert payload.patch is False
            assert payload.deleted_environment_variable_ids == []

        @pytest.mark.parametrize(
            "payload",
            [
                {"environment_variables": [], "deleted_environment_variable_ids": ["env-a"]},
                {
                    "environment_variables": [{"name": "a", "value_type": "string", "value": "a"}],
                    "patch": True,
                },
                {
                    "environment_variables": [{"id": "env-a", "name": "a", "value_type": "string", "value": "a"}],
                    "patch": True,
                    "deleted_environment_variable_ids": ["env-a"],
                },
            ],
        )
        def test_environment_variable_patch_payload_rejects_ambiguous_mutations(self, payload: dict) -> None:
            with pytest.raises(ValidationError):
                EnvironmentVariableUpdatePayload.model_validate(payload)

        def test_environment_variable_collection_post_routes_patch_to_service(
            self, database_app: Flask, monkeypatch: pytest.MonkeyPatch
        ) -> None:
            api = workflow_draft_variable_module.EnvironmentVariableCollectionApi()
            method = unwrap(api.post)
            captured: dict = {}

            class DummyWorkflowService:
                def patch_draft_workflow_environment_variables(self, **kwargs) -> None:
                    captured.update(kwargs)

                def update_draft_workflow_environment_variables(self, **_kwargs) -> None:
                    raise AssertionError("patch request must not use full replacement")

            monkeypatch.setattr(workflow_draft_variable_module, "WorkflowService", DummyWorkflowService)

            with database_app.test_request_context(
                "/",
                json={
                    "environment_variables": [{"id": "env-a", "name": "a", "value_type": "string", "value": "new-a"}],
                    "patch": True,
                    "deleted_environment_variable_ids": ["env-b"],
                },
            ):
                result = method(
                    api,
                    EnvironmentVariableUpdatePayload(
                        environment_variables=[{"id": "env-a", "name": "a", "value_type": "string", "value": "new-a"}],
                        patch=True,
                        deleted_environment_variable_ids=["env-b"],
                    ),
                    _make_account(),
                    app_model=_make_app(),
                )

            assert result == {"result": "success"}
            assert [(variable.id, variable.value) for variable in captured["environment_variables"]] == [
                ("env-a", "new-a")
            ]
            assert captured["deleted_environment_variable_ids"] == ["env-b"]
            assert captured["app_model"].id == _APP_APIS_APP_ID
            assert captured["account"].id == USER_ID
            assert captured["session"].get_bind() is db.engine

    class TestWorkflowStatisticEndpoints:
        def test_workflow_statistic_time_range(self):
            query = WorkflowStatisticQuery(start="2024-01-01", end="2024-12-31")
            assert query.start == "2024-01-01"

        def test_workflow_statistic_blank_to_none(self):
            query = WorkflowStatisticQuery(start="", end="")
            assert query.start is None
            assert query.end is None

        def test_workflow_daily_runs_statistic(self, database_app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
            service = MagicMock()
            service.get_daily_runs.return_value = [{"date": "2024-01-01", "runs": 2}]
            monkeypatch.setattr(
                workflow_statistic_module,
                "application_services",
                lambda: SimpleNamespace(workflow_statistics=service),
            )
            self._patch_statistic_time_range(monkeypatch)

            api = workflow_statistic_module.WorkflowDailyRunsStatistic()
            method = unwrap(api.get)
            request_context = _make_request_context()

            with database_app.test_request_context("/"):
                response = method(
                    api,
                    WorkflowStatisticQuery(),
                    request_context,
                    app_model=_make_app("app-1", tenant_id="t1"),
                )

            assert response == {"data": [{"date": "2024-01-01", "runs": 2}]}
            service.get_daily_runs.assert_called_once_with(
                request_context,
                app_id="app-1",
                start_date=None,
                end_date=None,
                timezone="UTC",
            )

        def test_workflow_daily_terminals_statistic(self, database_app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
            service = MagicMock()
            service.get_daily_terminals.return_value = [{"date": "2024-01-02", "terminal_count": 3}]
            monkeypatch.setattr(
                workflow_statistic_module,
                "application_services",
                lambda: SimpleNamespace(workflow_statistics=service),
            )
            self._patch_statistic_time_range(monkeypatch)

            api = workflow_statistic_module.WorkflowDailyTerminalsStatistic()
            method = unwrap(api.get)
            request_context = _make_request_context()

            with database_app.test_request_context("/"):
                response = method(
                    api,
                    WorkflowStatisticQuery(),
                    request_context,
                    app_model=_make_app("app-1", tenant_id="t1"),
                )

            assert response == {"data": [{"date": "2024-01-02", "terminal_count": 3}]}
            service.get_daily_terminals.assert_called_once_with(
                request_context,
                app_id="app-1",
                start_date=None,
                end_date=None,
                timezone="UTC",
            )

        def test_workflow_daily_token_cost_statistic(
            self,
            database_app: Flask,
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            service = MagicMock()
            service.get_daily_token_costs.return_value = [{"date": "2024-01-03", "token_count": 4}]
            monkeypatch.setattr(
                workflow_statistic_module,
                "application_services",
                lambda: SimpleNamespace(workflow_statistics=service),
            )
            self._patch_statistic_time_range(monkeypatch)

            api = workflow_statistic_module.WorkflowDailyTokenCostStatistic()
            method = unwrap(api.get)
            request_context = _make_request_context()

            with database_app.test_request_context("/"):
                response = method(
                    api,
                    WorkflowStatisticQuery(),
                    request_context,
                    app_model=_make_app("app-1", tenant_id="t1"),
                )

            assert response == {"data": [{"date": "2024-01-03", "token_count": 4}]}
            service.get_daily_token_costs.assert_called_once_with(
                request_context,
                app_id="app-1",
                start_date=None,
                end_date=None,
                timezone="UTC",
            )

        def test_workflow_average_app_interaction_statistic(
            self,
            database_app: Flask,
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            service = MagicMock()
            service.get_average_app_interactions.return_value = [{"date": "2024-01-04", "interactions": 2.5}]
            monkeypatch.setattr(
                workflow_statistic_module,
                "application_services",
                lambda: SimpleNamespace(workflow_statistics=service),
            )
            self._patch_statistic_time_range(monkeypatch)

            api = workflow_statistic_module.WorkflowAverageAppInteractionStatistic()
            method = unwrap(api.get)
            request_context = _make_request_context()

            with database_app.test_request_context("/"):
                response = method(
                    api,
                    WorkflowStatisticQuery(),
                    request_context,
                    app_model=_make_app("app-1", tenant_id="t1"),
                )

            assert response == {"data": [{"date": "2024-01-04", "interactions": 2.5}]}
            service.get_average_app_interactions.assert_called_once_with(
                request_context,
                app_id="app-1",
                start_date=None,
                end_date=None,
                timezone="UTC",
            )

        def test_workflow_statistic_invalid_time_range(self, monkeypatch: pytest.MonkeyPatch) -> None:
            account = _make_account()
            account.timezone = "UTC"
            monkeypatch.setattr(
                workflow_statistic_module,
                "current_account_with_tenant",
                lambda: SimpleNamespace(account=account),
            )
            monkeypatch.setattr(
                workflow_statistic_module,
                "parse_time_range",
                MagicMock(side_effect=ValueError("invalid range")),
            )

            with pytest.raises(BadRequest, match="invalid range"):
                workflow_statistic_module._resolve_statistic_time_range(WorkflowStatisticQuery())

        @staticmethod
        def _patch_statistic_time_range(monkeypatch: pytest.MonkeyPatch) -> None:
            account = _make_account()
            account.timezone = "UTC"
            monkeypatch.setattr(
                workflow_statistic_module,
                "current_account_with_tenant",
                lambda: SimpleNamespace(account=account),
            )
            monkeypatch.setattr(
                workflow_statistic_module,
                "parse_time_range",
                lambda *_args, **_kwargs: (None, None),
            )

    class TestWrapsEndpoints:
        def test_get_app_model_context(self):
            assert hasattr(wraps_module, "get_app_model")

    class TestMCPServerEndpoints:
        def test_mcp_server_connection(self):
            payload = MCPServerCreatePayload(parameters={"url": "http://localhost:3000"})
            assert payload.parameters["url"] == "http://localhost:3000"

        def test_mcp_server_update_payload(self):
            payload = MCPServerUpdatePayload(
                id="abcdefab-1234-4567-89ab-abcdefabcdef", parameters={"timeout": 30}, status="active"
            )
            assert payload.status == "active"

    class TestErrorHandling:
        def test_annotation_list_query_validation(self):
            with pytest.raises(ValueError, match="1 validation error for AnnotationListQuery\\\npage"):
                annotation_module.AnnotationListQuery(page=0)

    class TestPayloadIntegration:
        def test_multiple_payload_types(self):
            payloads = [
                annotation_module.AnnotationReplyPayload(
                    score_threshold=0.5, embedding_provider_name="openai", embedding_model_name="text-embedding-3-small"
                ),
                message_module.AppMessageFeedbackPayload(message_id=str(uuid.uuid4()), rating="like"),
                statistic_module.StatisticTimeRangeQuery(start="2024-01-01"),
            ]
            assert len(payloads) == 3
            assert all(p is not None for p in payloads)


"""App request contracts and serialization of materialized response data."""


def _ts(hour: int = 12) -> datetime:
    return datetime(2024, 1, 1, hour, 0, 0)


_APP_RESPONSE_MODELS_TENANT_ID = "00000000-0000-0000-0000-000000000001"
_APP_RESPONSE_MODELS_APP_ID = "00000000-0000-0000-0000-000000000101"
ACCOUNT_ID = "00000000-0000-0000-0000-000000000201"
CONFIG_ID = "00000000-0000-0000-0000-000000000301"
WORKFLOW_ID = "00000000-0000-0000-0000-000000000401"
SITE_ID = "00000000-0000-0000-0000-000000000501"
TAG_ID = "00000000-0000-0000-0000-000000000601"


def _account(*, account_id: str = ACCOUNT_ID) -> Account:
    account = Account(name="Creator", email=f"{account_id}@example.com")
    account.id = account_id
    return account


def _app(
    *,
    app_id: str = _APP_RESPONSE_MODELS_APP_ID,
    tenant_id: str = _APP_RESPONSE_MODELS_TENANT_ID,
    name: str = "My App",
    description: str = "Summary",
    mode: AppMode = AppMode.CHAT,
    icon_type: IconType | None = IconType.IMAGE,
    icon: str | None = "icon-key",
    created_at: datetime | None = None,
) -> _app_response_models_App:
    timestamp = created_at or _ts()
    app = _app_response_models_App(
        id=app_id,
        tenant_id=tenant_id,
        name=name,
        description=description,
        mode=mode,
        icon_type=icon_type,
        icon=icon,
        icon_background="#fff",
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )
    app.created_at = timestamp
    app.updated_at = timestamp
    return app


def _workflow(
    *, app_id: str = _APP_RESPONSE_MODELS_APP_ID, tenant_id: str = _APP_RESPONSE_MODELS_TENANT_ID
) -> Workflow:
    workflow_record = Workflow(
        id=WORKFLOW_ID,
        tenant_id=tenant_id,
        app_id=app_id,
        type=WorkflowType.CHAT,
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps({"nodes": [], "edges": []}),
        _features=json.dumps({}),
        created_by=ACCOUNT_ID,
        updated_by=ACCOUNT_ID,
        _environment_variables=[],
        _conversation_variables=[],
    )
    workflow_record.updated_at = _ts(9)
    workflow_record.created_at = _ts(8)
    return workflow_record


def _persist_response_graph(session: Session) -> _app_response_models_App:
    app = _app(description="Description")
    app.created_by = ACCOUNT_ID
    app.app_model_config_id = CONFIG_ID
    app.workflow_id = WORKFLOW_ID
    app.access_mode = "private"
    app.create_user_name = "Creator"
    app.has_draft_trigger = True
    app.permission_keys = ["app.acl.view_layout"]

    model_config = AppModelConfig(
        app_id=_APP_RESPONSE_MODELS_APP_ID,
        model=json.dumps({"provider": "openai", "name": "gpt-4o"}),
        pre_prompt="hello",
        created_by=ACCOUNT_ID,
        updated_by=ACCOUNT_ID,
    )
    model_config.id = CONFIG_ID
    model_config.created_at = _ts(9)
    model_config.updated_at = _ts(10)

    site = _app_response_models_Site(
        id=SITE_ID,
        app_id=_APP_RESPONSE_MODELS_APP_ID,
        code="site-code",
        title="Public Site",
        icon_type=IconType.IMAGE,
        icon="site-icon",
        icon_background="#fff",
        description="Site description",
        default_language="en-US",
        input_placeholder="Ask anything",
        customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
    )
    site.created_at = _ts(14)
    site.updated_at = _ts(14)
    tag = Tag(tenant_id=_APP_RESPONSE_MODELS_TENANT_ID, type=TagType.APP, name="Utilities", created_by=ACCOUNT_ID)
    tag.id = TAG_ID
    binding = TagBinding(
        tenant_id=_APP_RESPONSE_MODELS_TENANT_ID,
        tag_id=TAG_ID,
        target_id=_APP_RESPONSE_MODELS_APP_ID,
        created_by=ACCOUNT_ID,
    )

    session.add_all([_account(), app, model_config, _workflow(), site, tag, binding])
    session.commit()
    return app


class TestAppResponseModelsCases:
    @staticmethod
    @pytest.fixture
    def app_module():
        return controller

    @staticmethod
    @pytest.fixture
    def app_models(monkeypatch):
        monkeypatch.setattr(
            app_fields, "build_icon_url", lambda kind, icon: f"signed:{icon}" if kind == IconType.IMAGE else None
        )
        return app_fields

    @staticmethod
    def test_app_list_query_reads_repeated_tag_ids(app_module):
        first_tag_id = "8c4ef3d1-58a1-4d94-8a1c-1c171d889e08"
        second_tag_id = "3c39395b-6d1f-4030-8b17-eaa7cc85221c"
        query_args = MultiDict(
            [
                ("page", "1"),
                ("limit", "30"),
                ("tag_ids", first_tag_id),
                ("tag_ids", second_tag_id),
            ]
        )

        query = app_module.query_params_from_request(
            app_module.AppListQuery,
            list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
            args=query_args,
        )

        assert query.tag_ids == [first_tag_id, second_tag_id]

    @staticmethod
    def test_app_list_query_reads_repeated_creator_ids(app_module):
        first_creator_id = "9e8959cf-a67b-4d34-9906-1d687517b248"
        second_creator_id = "1886f96a-5bf0-42bf-961d-8d2129049076"
        query_args = MultiDict(
            [
                ("page", "1"),
                ("limit", "30"),
                ("creator_ids", first_creator_id),
                ("creator_ids", second_creator_id),
            ]
        )

        query = app_module.query_params_from_request(
            app_module.AppListQuery,
            list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
            args=query_args,
        )

        assert query.creator_ids == [first_creator_id, second_creator_id]

    @staticmethod
    def test_app_list_query_preserves_regular_query_params(app_module):
        query_args = MultiDict(
            [
                ("page", "2"),
                ("limit", "50"),
                ("mode", "chat"),
                ("name", "Sales Copilot"),
                ("is_created_by_me", "true"),
            ]
        )

        query = app_module.query_params_from_request(
            app_module.AppListQuery,
            list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
            args=query_args,
        )

        assert query.page == 2
        assert query.limit == 50
        assert query.mode == "chat"
        assert query.name == "Sales Copilot"
        assert query.is_created_by_me is True
        assert query.tag_ids is None

    @staticmethod
    def test_app_list_query_normalizes_empty_repeated_tag_ids_to_none(app_module):
        query_args = MultiDict(
            [
                ("tag_ids", ""),
                ("tag_ids", "   "),
            ]
        )

        query = app_module.query_params_from_request(
            app_module.AppListQuery,
            list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
            args=query_args,
        )

        assert query.tag_ids is None

    @staticmethod
    def test_app_list_query_rejects_invalid_repeated_tag_id(app_module):
        with pytest.raises(ValidationError):
            app_module.query_params_from_request(
                app_module.AppListQuery,
                list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
                args=MultiDict([("tag_ids", "not-a-uuid")]),
            )

    @staticmethod
    def test_app_list_query_rejects_invalid_repeated_creator_id(app_module):
        with pytest.raises(ValidationError):
            app_module.query_params_from_request(
                app_module.AppListQuery,
                list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
                args=MultiDict([("creator_ids", "not-a-uuid")]),
            )

    @staticmethod
    def test_app_list_query_ignores_indexed_tag_ids(app_module):
        tag_id = "8c4ef3d1-58a1-4d94-8a1c-1c171d889e08"
        query_args = MultiDict(
            [
                ("tag_ids[0]", tag_id),
            ]
        )

        query = app_module.query_params_from_request(
            app_module.AppListQuery,
            list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
            args=query_args,
        )

        assert query.tag_ids is None

    @staticmethod
    def test_app_list_query_accepts_single_repeated_tag_id(app_module):
        tag_id = "8c4ef3d1-58a1-4d94-8a1c-1c171d889e08"
        query = app_module.query_params_from_request(
            app_module.AppListQuery,
            list_fields=app_module.APP_LIST_QUERY_ARRAY_FIELDS,
            args=MultiDict([("tag_ids", tag_id)]),
        )

        assert query.tag_ids == [tag_id]

    @staticmethod
    def test_create_app_endpoint_rejects_agent_mode(app_module):
        with pytest.raises(ValidationError):
            app_module.CreateAppPayload.model_validate({"name": "Iris", "mode": "agent", "description": "Agent app"})

    @staticmethod
    def test_app_partial_serialization_uses_aliases(app_models, sqlite_session: Session):
        app_partial = app_models.AppPartial
        app_obj = _persist_response_graph(sqlite_session)
        app_obj.description = "Prompt snippet"

        serialized = app_partial.model_validate(
            replace(app_record(app_obj, session=sqlite_session), permission_keys=app_obj.permission_keys),
            from_attributes=True,
        ).model_dump(mode="json")

        assert serialized["description"] == "Prompt snippet"
        assert serialized["mode"] == "chat"
        assert serialized["icon_url"] == "signed:icon-key"
        assert serialized["created_at"] == int(app_obj.created_at.timestamp())
        assert serialized["updated_at"] == int(app_obj.updated_at.timestamp())
        assert serialized["model_config"]["model"] == {"provider": "openai", "name": "gpt-4o"}
        assert serialized["workflow"]["id"] == WORKFLOW_ID
        assert serialized["tags"][0]["name"] == "Utilities"
        assert serialized["permission_keys"] == ["app.acl.view_layout"]
        assert "role" not in serialized

    @staticmethod
    def test_app_detail_with_site_includes_nested_serialization(
        app: Flask,
        app_models,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
    ):
        app_obj = _persist_response_graph(sqlite_session)
        app_obj.name = "Detailed App"
        app_obj.description = "Desc"
        app_obj.mode = AppMode.ADVANCED_CHAT
        app_obj.icon = "detail-icon"
        app_obj.icon_background = "#123456"
        app_obj.use_icon_as_answer_icon = True
        app_obj.max_active_requests = 5
        app_obj.access_mode = "public"
        app_obj.permission_keys = ["app.acl.view_layout", "app.acl.edit"]
        model_config = sqlite_session.get(AppModelConfig, CONFIG_ID)
        assert model_config is not None
        model_config.opening_statement = "hi"
        model_config.retriever_resource = json.dumps({"enabled": True})
        monkeypatch.setattr(
            "repositories.app.response.load_annotation_reply_config", lambda _session, _app_id: {"enabled": False}
        )

        with app.test_request_context("/"):
            response = controller._app_detail_response(
                replace(
                    app_record(app_obj, session=sqlite_session, projection="detail-with-site"),
                    permission_keys=app_obj.permission_keys,
                ),
            )
            assert isinstance(response, app_models.AppDetailWithSite)
            serialized = response.model_dump(mode="json")

        assert serialized["icon_url"] == "signed:detail-icon"
        assert serialized["model_config"]["retriever_resource"] == {"enabled": True}
        assert serialized["deleted_tools"] == []
        assert serialized["site"]["icon_url"] == "signed:site-icon"
        assert serialized["site"]["input_placeholder"] == "Ask anything"
        assert serialized["site"]["created_at"] == int(_ts(14).timestamp())
        assert serialized["permission_keys"] == ["app.acl.view_layout", "app.acl.edit"]
        assert serialized["bound_agent_id"] is None
        assert "role" not in serialized

    @staticmethod
    def test_app_response_view_uses_the_caller_session_for_query_backed_fields(
        monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
        app_obj = _persist_response_graph(sqlite_session)
        decoy_tenant_id = "00000000-0000-0000-0000-000000000002"
        decoy_tag = Tag(tenant_id=decoy_tenant_id, type=TagType.APP, name="Decoy", created_by=ACCOUNT_ID)
        decoy_tag.id = "00000000-0000-0000-0000-000000000602"
        sqlite_session.add_all(
            [
                decoy_tag,
                TagBinding(
                    tenant_id=decoy_tenant_id,
                    tag_id=decoy_tag.id,
                    target_id=_APP_RESPONSE_MODELS_APP_ID,
                    created_by=ACCOUNT_ID,
                ),
            ]
        )
        sqlite_session.commit()
        calls = []

        def load_annotation_reply(session, app_id):
            calls.append((session, app_id))
            return {"enabled": False}

        monkeypatch.setattr("services.app_service.load_annotation_reply_config", load_annotation_reply)

        view = AppResponseView(app_obj, session=sqlite_session)
        site = view.site
        workflow = view.workflow
        model_config = view.app_model_config

        assert view.desc_or_prompt == "Description"
        assert site is not None
        assert site.id == SITE_ID
        assert workflow is not None
        assert workflow.id == WORKFLOW_ID
        assert view.bound_agent_id is None
        assert view.mode_compatible_with_agent == "chat"
        assert view.deleted_tools == []
        assert [tag.name for tag in view.tags] == ["Utilities"]
        assert view.author_name == "Creator"
        assert model_config is not None
        assert model_config.annotation_reply_dict == {"enabled": False}
        assert calls == [(sqlite_session, _APP_RESPONSE_MODELS_APP_ID)]

    @staticmethod
    def test_app_pagination_aliases_per_page_and_has_next(app_models, sqlite_session: Session):
        app_pagination = app_models.AppPagination
        item_one = _app(
            app_id="00000000-0000-0000-0000-000000000110",
            name="Paginated One",
            icon="first-icon",
            created_at=_ts(15),
        )
        item_one.permission_keys = ["app.acl.edit"]
        item_two = _app(
            app_id="00000000-0000-0000-0000-000000000111",
            name="Paginated Two",
            mode=AppMode.AGENT_CHAT,
            icon_type=IconType.EMOJI,
            icon="🙂",
            created_at=_ts(16),
        )
        pagination = PaginatedResult(
            page=2,
            per_page=10,
            total=50,
            items=[app_record(item, session=sqlite_session) for item in (item_one, item_two)],
        )

        serialized = app_pagination.model_validate(
            pagination,
            from_attributes=True,
        ).model_dump(mode="json")

        assert serialized["page"] == 2
        assert serialized["limit"] == 10
        assert serialized["has_more"] is True
        assert len(serialized["data"]) == 2
        assert serialized["data"][0]["icon_url"] == "signed:first-icon"
        assert serialized["data"][1]["icon_url"] is None

    @staticmethod
    @pytest.mark.parametrize("strategy", [None, "cot", "function-calling"])
    def test_app_detail_preserves_historical_agent_strategy(
        app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, strategy: str | None
    ):
        app_obj = _persist_response_graph(sqlite_session)
        config = sqlite_session.get(AppModelConfig, CONFIG_ID)
        assert config is not None
        agent_mode = {"enabled": True, "tools": []}
        if strategy is not None:
            agent_mode["strategy"] = strategy
        config.agent_mode = json.dumps(agent_mode)
        sqlite_session.commit()
        monkeypatch.setattr(
            "repositories.app.response.load_annotation_reply_config", lambda _session, _app_id: {"enabled": False}
        )

        with app.test_request_context("/"):
            response = controller._app_detail_response(
                app_record(app_obj, session=sqlite_session, projection="detail-with-site")
            ).model_dump(mode="json")

        assert response["model_config"]["agent_mode"] == agent_mode

    @staticmethod
    def test_app_detail_preserves_historical_agent_mode_without_tools(
        app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
        app_obj = _persist_response_graph(sqlite_session)
        app_obj.mode = AppMode.AGENT_CHAT
        config = sqlite_session.get(AppModelConfig, CONFIG_ID)
        assert config is not None
        agent_mode = {"enabled": True, "max_iteration": 5, "strategy": "function_call"}
        config.agent_mode = json.dumps(agent_mode)
        sqlite_session.commit()
        monkeypatch.setattr(
            "repositories.app.response.load_annotation_reply_config", lambda _session, _app_id: {"enabled": False}
        )

        with app.test_request_context("/"):
            response = controller._app_detail_response(
                app_record(app_obj, session=sqlite_session, projection="detail-with-site")
            ).model_dump(mode="json")

        assert response["model_config"]["agent_mode"] == agent_mode

    @staticmethod
    def test_app_model_config_response_round_trips_persisted_dataset_and_external_tool_fields(
        app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
        app_obj = _persist_response_graph(sqlite_session)
        config = sqlite_session.get(AppModelConfig, CONFIG_ID)
        assert config is not None
        dataset_configs = {
            "retrieval_model": "multiple",
            "reranking_enable": True,
            "reranking_enabled": True,
            "metadata_filtering_conditions": {
                "logical_operator": "and",
                "conditions": [
                    {
                        "id": "condition-1",
                        "metadata_id": "metadata-1",
                        "name": "category",
                        "comparison_operator": "is",
                        "value": "books",
                    }
                ],
            },
            "extension_setting": {"value": 1},
        }
        external_form = {
            "external_data_tool": {
                "variable": "customer",
                "label": "Customer",
                "type": "api",
                "enabled": True,
                "icon": "icon-key",
                "icon_background": "#fff",
                "config": {"provider": "crm"},
                "extension_setting": {"value": 2},
            }
        }
        config.dataset_configs = json.dumps(dataset_configs)
        config.user_input_form = json.dumps([external_form])
        sqlite_session.commit()
        monkeypatch.setattr(
            "repositories.app.response.load_annotation_reply_config", lambda _session, _app_id: {"enabled": False}
        )

        with app.test_request_context("/"):
            response = controller._app_detail_response(
                app_record(app_obj, session=sqlite_session, projection="detail-with-site")
            ).model_dump(mode="json")

        model_config = response["model_config"]
        assert model_config["dataset_configs"] == dataset_configs
        assert model_config["user_input_form"] == [external_form]

        reimported = AppModelConfig(app_id=_APP_RESPONSE_MODELS_APP_ID)
        reimported.from_model_config_dict(model_config)
        assert reimported.dataset_configs_dict == dataset_configs
        assert reimported.user_input_form_list == [external_form]

    @staticmethod
    def test_recommended_app_model_configs_keep_all_published_fields():
        catalog_path = Path(__file__).resolve().parents[5] / "constants" / "recommended_apps.json"
        catalog = json.loads(catalog_path.read_text())

        def assert_fields_preserved(source, serialized):
            if isinstance(source, dict):
                for key, value in source.items():
                    assert key in serialized
                    assert_fields_preserved(value, serialized[key])
            elif isinstance(source, list):
                assert len(source) == len(serialized)
                for value, serialized_value in zip(source, serialized, strict=True):
                    assert_fields_preserved(value, serialized_value)
            else:
                assert serialized == source

        for entry in catalog["app_details"].values():
            source = yaml.safe_load(entry["export_data"]).get("model_config") or {}
            if not source:
                continue
            payload = {**source, "created_by": None, "created_at": 1, "updated_by": None, "updated_at": 1}
            response = AppModelConfigResponse.model_validate(payload).model_dump(mode="json")
            assert_fields_preserved(source, response)

    @staticmethod
    def test_app_detail_rejects_invalid_known_configuration_fields(
        app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
        app_obj = _persist_response_graph(sqlite_session)
        monkeypatch.setattr(
            "repositories.app.response.load_annotation_reply_config", lambda _session, _app_id: {"enabled": False}
        )
        with app.test_request_context("/"):
            detail = controller._app_detail_response(
                app_record(app_obj, session=sqlite_session, projection="detail-with-site")
            ).model_dump(mode="json")

        for field in ("mode", "permission_keys", "site", "model_config"):
            with pytest.raises(ValidationError):
                app_fields.AppDetailWithSite.model_validate(
                    {key: value for key, value in detail.items() if key != field}
                )

        with pytest.raises(ValidationError):
            app_fields.AppDetailWithSite.model_validate({**detail, "mode": "unsupported"})

        config = detail["model_config"]
        for invalid in (
            {"speech_to_text": {"enabled": "not-a-boolean"}},
            {"agent_mode": {"enabled": True, "strategy": "unsupported", "tools": []}},
            {"agent_mode": {"enabled": True, "tools": "not-a-list"}},
            {"agent_mode": {"enabled": True, "tools": [{"provider_id": "only-id"}]}},
            {"dataset_configs": {"retrieval_model": "unsupported"}},
            {"dataset_configs": {"retrieval_model": "multiple", "reranking_mode": "unsupported"}},
            {"model": {"provider": "openai", "name": "gpt-4o", "mode": "unsupported"}},
            {"user_input_form": [{"unsupported": {"label": "Name", "variable": "name"}}]},
        ):
            with pytest.raises(ValidationError):
                app_fields.AppDetailWithSite.model_validate({**detail, "model_config": {**config, **invalid}})


"""Transport contracts for the Console app application boundary."""


_CONSOLE_APP_API_APP_ID = UUID("11111111-1111-1111-1111-111111111111")
CONTEXT = RequestContext("request", "trace", "actor", "workspace")
RECORD = AppRecord(
    str(_CONSOLE_APP_API_APP_ID),
    "Example",
    "chat",
    description="",
    created_at=datetime(2024, 1, 1),
    updated_at=datetime(2024, 1, 1),
)
SITE = {
    "code": "site",
    "title": "Example",
    "icon_type": None,
    "icon": None,
    "icon_background": None,
    "description": None,
    "default_language": "en-US",
    "chat_color_theme": None,
    "chat_color_theme_inverted": False,
    "customize_domain": None,
    "copyright": None,
    "privacy_policy": None,
    "input_placeholder": None,
    "custom_disclaimer": "",
    "customize_token_strategy": CustomizeTokenStrategy.NOT_ALLOW,
    "prompt_public": False,
    "show_workflow_steps": False,
    "use_icon_as_answer_icon": False,
    "created_by": None,
    "created_at": datetime(2024, 1, 1),
    "updated_by": None,
    "updated_at": datetime(2024, 1, 1),
}


@dataclass
class AppBoundary:
    calls: list[tuple[object, ...]] = app_field(default_factory=list)
    status: ImportStatus = ImportStatus.COMPLETED
    exported: str | RosterAgentPackageExport = "dsl"
    record: AppRecord = RECORD

    def list_apps(self, context: RequestContext, params: AppListParams | StarredAppListParams) -> AppPage:
        self.calls.append(("list", context, params))
        return AppPage(params.page, params.limit, 1, False, [RECORD])

    def create(self, context: RequestContext, params: CreateAppParams) -> AppRecord:
        self.calls.append(("create", context, params))
        return RECORD

    def get(self, context: RequestContext, app_id: str) -> AppRecord:
        self.calls.append(("get", context, app_id))
        return self.record

    def update(self, context: RequestContext, app_id: str, params: UpdateAppParams) -> AppRecord:
        self.calls.append(("update", context, app_id, params))
        return RECORD

    def update_icon(self, context: RequestContext, app_id: str, **kwargs: object) -> AppRecord:
        self.calls.append(("icon", context, app_id, kwargs))
        return RECORD

    def copy(self, context: RequestContext, app_id: str, params: CopyAppParams) -> tuple[Import, AppRecord | None]:
        self.calls.append(("copy", context, app_id, params))
        return Import(id="import", status=self.status), RECORD

    def export(self, context: RequestContext, app_id: str, options: AppExportOptions) -> str | RosterAgentPackageExport:
        self.calls.append(("export", context, app_id, options))
        return self.exported

    def publish(self, context: RequestContext, app_id: str) -> str:
        self.calls.append(("publish", context, app_id))
        return "https://creators.example.com"

    def delete(self, context: RequestContext, app_id: str) -> None:
        self.calls.append(("delete", context, app_id))

    def set_trace(self, context: RequestContext, app_id: str, settings: AppTraceSettings) -> None:
        self.calls.append(("trace", context, app_id, settings))


@dataclass
class AppServices:
    console: AppBoundary


@dataclass
class Services:
    apps: AppServices


def invoke(resource: type[Resource], method: Callable[..., object], **kwargs: object) -> object:
    return inspect.unwrap(method)(resource(), CONTEXT, **kwargs)


class TestConsoleAppApiCases:
    @staticmethod
    @pytest.fixture
    def boundary(monkeypatch: pytest.MonkeyPatch) -> AppBoundary:
        boundary = AppBoundary()
        monkeypatch.setattr(controller, "application_services", lambda: Services(AppServices(boundary)))
        return boundary

    @staticmethod
    def test_list_parses_repeated_filters_and_serializes_materialized_page(app: Flask, boundary: AppBoundary) -> None:
        tag = str(_CONSOLE_APP_API_APP_ID)
        with app.test_request_context(f"/?page=2&limit=5&tag_ids={tag}&is_created_by_me=true"):
            data, status = cast(tuple[dict[str, object], int], invoke(controller.AppListApi, controller.AppListApi.get))
        assert status == 200
        assert data["page"] == 2
        assert data["limit"] == 5
        assert boundary.calls[0][1] is CONTEXT
        params = boundary.calls[0][2]
        assert isinstance(params, AppListParams)
        assert params.tag_ids == [tag]
        assert params.is_created_by_me is True

    @staticmethod
    @pytest.mark.parametrize("configured", [True, False])
    def test_detail_resolves_urls_at_the_http_boundary(
        app: Flask, boundary: AppBoundary, config_overrides: Callable[..., None], configured: bool
    ) -> None:
        config_overrides(
            SERVICE_API_URL="https://api.example.com" if configured else "",
            APP_WEB_URL="https://apps.example.com" if configured else "",
        )
        boundary.record = replace(RECORD, site=SITE)
        with app.test_request_context("/", base_url="https://console.example.com/"):
            response = cast(
                dict[str, object], invoke(controller.AppApi, controller.AppApi.get, app_id=_CONSOLE_APP_API_APP_ID)
            )
        assert response["api_base_url"] == (
            "https://api.example.com/v1" if configured else "https://console.example.com/v1"
        )
        site = response["site"]
        assert isinstance(site, dict)
        assert site["app_base_url"] == ("https://apps.example.com" if configured else "https://console.example.com")

    @staticmethod
    @pytest.mark.parametrize("icon_type", [None, "image"])
    def test_update_preserves_icon_type_omission_and_forwards_explicit_identity(
        app: Flask, boundary: AppBoundary, icon_type: str | None
    ) -> None:
        payload = {"name": "Updated", "icon": "image-id"}
        if icon_type is not None:
            payload["icon_type"] = icon_type
        with app.test_request_context("/", method="POST", json=payload):
            data = cast(
                dict[str, object], invoke(controller.AppApi, controller.AppApi.put, app_id=_CONSOLE_APP_API_APP_ID)
            )
        assert data["id"] == str(_CONSOLE_APP_API_APP_ID)
        assert boundary.calls[0][1:3] == (CONTEXT, str(_CONSOLE_APP_API_APP_ID))
        params = boundary.calls[0][3]
        assert isinstance(params, UpdateAppParams)
        assert params.icon_type == icon_type

    @staticmethod
    def test_icon_body_and_trace_body_are_parsed(app: Flask, boundary: AppBoundary) -> None:
        with app.test_request_context("/", method="POST", json={"icon_type": "image", "icon": "image-id"}):
            invoke(controller.AppIconApi, controller.AppIconApi.post, app_id=_CONSOLE_APP_API_APP_ID)
        assert boundary.calls[-1][-1] == {"icon_type": "image", "icon": "image-id", "icon_background": ""}
        with app.test_request_context("/", method="POST", json={"enabled": True, "tracing_provider": "langfuse"}):
            assert invoke(controller.AppTraceApi, controller.AppTraceApi.post, app_id=_CONSOLE_APP_API_APP_ID) == {
                "result": "success"
            }
        assert boundary.calls[-1] == (
            "trace",
            CONTEXT,
            str(_CONSOLE_APP_API_APP_ID),
            AppTraceSettings(True, "langfuse"),
        )

    @staticmethod
    @pytest.mark.parametrize(
        ("status", "expected"),
        [
            (ImportStatus.FAILED, 400),
            (ImportStatus.PENDING, 202),
            (ImportStatus.COMPLETED, 201),
            (ImportStatus.COMPLETED_WITH_WARNINGS, 201),
        ],
    )
    def test_copy_preserves_import_status_responses(
        app: Flask, boundary: AppBoundary, status: ImportStatus, expected: int
    ) -> None:
        boundary.status = status
        with app.test_request_context("/", method="POST", json={"name": "Copy"}):
            data, code = cast(
                tuple[dict[str, object], int],
                invoke(controller.AppCopyApi, controller.AppCopyApi.post, app_id=_CONSOLE_APP_API_APP_ID),
            )
        assert code == expected
        assert data["id"] == ("import" if expected != 201 else str(_CONSOLE_APP_API_APP_ID))

    @staticmethod
    def test_export_serializes_yaml_and_closes_archive_on_response_close(app: Flask, boundary: AppBoundary) -> None:
        with app.test_request_context("/?format=yaml&include_secret=true"):
            assert invoke(controller.AppExportApi, controller.AppExportApi.get, app_id=_CONSOLE_APP_API_APP_ID) == {
                "data": "dsl"
            }
        options = boundary.calls[-1][-1]
        assert isinstance(options, AppExportOptions)
        assert options.include_secret is True
        archive = BytesIO(b"zip")
        boundary.exported = RosterAgentPackageExport(archive=archive, filename="example.ifpkg", size=3)
        with app.test_request_context("/"):
            response = invoke(controller.AppExportApi, controller.AppExportApi.get, app_id=_CONSOLE_APP_API_APP_ID)
            assert isinstance(response, Response)
            assert response.mimetype == "application/zip"
            assert "example.ifpkg" in response.headers["Content-Disposition"]
            response.close()
        assert archive.closed

    @staticmethod
    def test_export_closes_archive_when_send_file_fails(
        app: Flask, boundary: AppBoundary, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        archive = BytesIO(b"zip")
        boundary.exported = RosterAgentPackageExport(archive=archive, filename="example.ifpkg", size=3)

        def fail(*_args: object, **_kwargs: object) -> None:
            raise OSError("delivery failed")

        monkeypatch.setattr(controller, "send_file", fail)
        with app.test_request_context("/"), pytest.raises(OSError, match="delivery failed"):
            invoke(controller.AppExportApi, controller.AppExportApi.get, app_id=_CONSOLE_APP_API_APP_ID)
        assert archive.closed

    @staticmethod
    def test_publish_delegates_and_delete_has_no_body(app: Flask, boundary: AppBoundary) -> None:
        with app.test_request_context("/"):
            assert invoke(
                controller.AppPublishToCreatorsPlatformApi,
                controller.AppPublishToCreatorsPlatformApi.post,
                app_id=_CONSOLE_APP_API_APP_ID,
            ) == {
                "redirect_url": "https://creators.example.com",
            }
            assert invoke(controller.AppApi, controller.AppApi.delete, app_id=_CONSOLE_APP_API_APP_ID) == ("", 204)
        assert boundary.calls == [
            ("publish", CONTEXT, str(_CONSOLE_APP_API_APP_ID)),
            ("delete", CONTEXT, str(_CONSOLE_APP_API_APP_ID)),
        ]

    @staticmethod
    @pytest.mark.parametrize(
        ("error", "expected"),
        [
            (ConsoleAppNotFoundError(), AppNotFoundError),
            (InvalidAppExportError("invalid version"), BadRequest),
            (AppExportPaidPlanRequiredError("paid plan required"), Forbidden),
        ],
    )
    def test_application_errors_are_translated_at_transport_boundary(
        monkeypatch: pytest.MonkeyPatch, error: Exception, expected: type[Exception]
    ) -> None:
        def fail(*_args: object, **_kwargs: object) -> None:
            raise error

        monkeypatch.setattr(Resource, "dispatch_request", fail)
        with pytest.raises(expected):
            controller.AppResource().dispatch_request()

    @staticmethod
    def test_disabled_creators_preserves_error_body(monkeypatch: pytest.MonkeyPatch) -> None:
        def fail(*_args: object, **_kwargs: object) -> None:
            raise CreatorsPlatformDisabledError("Creators Platform features are not enabled")

        monkeypatch.setattr(Resource, "dispatch_request", fail)
        assert controller.AppResource().dispatch_request() == (
            {"error": "Creators Platform features are not enabled"},
            403,
        )

    @staticmethod
    @pytest.mark.parametrize(
        "method",
        [
            controller.AppApi.put,
            controller.AppApi.delete,
            controller.AppCopyApi.post,
            controller.AppExportApi.get,
            controller.AppNameApi.post,
            controller.AppIconApi.post,
            controller.AppSiteStatus.post,
            controller.AppApiStatus.post,
            controller.AppTraceApi.post,
        ],
    )
    def test_mutations_reject_read_only_role_at_admission(
        app: Flask, monkeypatch: pytest.MonkeyPatch, method: Callable[..., object]
    ) -> None:
        account = Account(name="Reader", email="reader@example.com")
        account.role = TenantAccountRole.NORMAL
        apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
        monkeypatch.setattr(
            flask_admission,
            "current_account_with_tenant",
            lambda: AccountWithTenant(account=account, tenant_id="workspace"),
        )
        injector = inspect.unwrap(method, stop=lambda f: "allowed_roles" in inspect.getclosurevars(f).nonlocals)
        with app.test_request_context(), pytest.raises(Forbidden):
            injector(None, app_id=_CONSOLE_APP_API_APP_ID)

    @staticmethod
    def test_create_quota_is_part_of_admission_and_precedes_application_call(
        app: Flask, boundary: AppBoundary, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from services.entities.feature_entities import FeatureModel, LimitationModel

        account = Account(name="Editor", email="editor@example.com")
        account.role = TenantAccountRole.EDITOR
        account.id = CONTEXT.account_id
        identity = AccountWithTenant(account=account, tenant_id=CONTEXT.active_workspace_id)
        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION="CLOUD", RBAC_ENABLED=False)
        monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: identity)
        monkeypatch.setattr("controllers.console.wraps.current_account_with_tenant", lambda: identity)
        monkeypatch.setattr(flask_admission, "enforce_rbac_checks", lambda **_kwargs: None)
        monkeypatch.setattr(
            "controllers.console.wraps.FeatureService.get_features",
            lambda *_args, **_kwargs: FeatureModel(apps=LimitationModel(size=1, limit=1)),
        )
        admission = inspect.unwrap(
            controller.AppListApi.post, stop=lambda f: inspect.getclosurevars(f).nonlocals.get("resource") == "apps"
        )
        with (
            app.test_request_context(method="POST", json={"name": "Example", "mode": "chat"}),
            pytest.raises(Forbidden),
        ):
            admission(controller.AppListApi())
        assert boundary.calls == []

    @staticmethod
    def test_request_validation_retains_422_and_redacts_submitted_values(app: Flask, boundary: AppBoundary) -> None:
        from werkzeug.exceptions import UnprocessableEntity

        with app.test_request_context(method="PUT", json={"name": "", "icon": "private-input"}):
            with pytest.raises(UnprocessableEntity) as error:
                invoke(controller.AppApi, controller.AppApi.put, app_id=_CONSOLE_APP_API_APP_ID)
        assert "private-input" not in (error.value.description or "")
        assert boundary.calls == []


"""Regression tests for CreateAppPayload mode validation."""


class TestCreateAppPayloadCases:
    class TestCreateAppPayloadMode:
        @pytest.mark.parametrize(
            "mode",
            ["chat", "agent-chat", "advanced-chat", "workflow", "completion"],
        )
        def test_accepts_supported_modes(self, mode: str):
            payload = CreateAppPayload.model_validate({"name": "X", "mode": mode})
            assert payload.mode == mode

        def test_rejects_agent_mode(self):
            with pytest.raises(ValidationError):
                CreateAppPayload.model_validate({"name": "X", "mode": "agent"})

        def test_rejects_unknown_mode(self):
            with pytest.raises(ValidationError):
                CreateAppPayload.model_validate({"name": "X", "mode": "not-a-mode"})
