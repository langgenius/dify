"""Unit coverage for console app controller contracts and response mapping."""

from __future__ import annotations

import uuid
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import BadRequest, NotFound

from controllers.console import console_ns
from controllers.console.app import (
    annotation as annotation_module,
)
from controllers.console.app import (
    app as app_module,
)
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
    workflow_trigger as workflow_trigger_module,
)
from controllers.console.app import (
    wraps as wraps_module,
)
from controllers.console.app.completion import ChatMessagePayload, CompletionMessagePayload
from controllers.console.app.mcp_server import MCPServerCreatePayload, MCPServerUpdatePayload
from controllers.console.app.ops_trace import TraceConfigPayload, TraceProviderQuery
from controllers.console.app.site import AppSiteUpdatePayload
from controllers.console.app.workflow import AdvancedChatWorkflowRunPayload, SyncDraftWorkflowPayload
from controllers.console.app.workflow_app_log import WorkflowAppLogQuery
from controllers.console.app.workflow_draft_variable import WorkflowDraftVariableUpdatePayload
from controllers.console.app.workflow_statistic import WorkflowStatisticQuery
from controllers.console.app.workflow_trigger import Parser, ParserEnable
from models import Site
from models.account import Account, AccountStatus
from models.enums import CustomizeTokenStrategy
from models.trigger import WorkflowWebhookTrigger

APP_ID = "11111111-1111-1111-1111-111111111111"
TENANT_ID = "22222222-2222-2222-2222-222222222222"
USER_ID = "33333333-3333-3333-3333-333333333333"


def _make_account() -> Account:
    account = Account(
        name="tester",
        email="tester@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = USER_ID
    return account


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
            resp = method(api, session, _make_account(), app_model=MagicMock(id=APP_ID))

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
            method(api, session, _make_account(), app_model=MagicMock(id=APP_ID))

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
            method(api, session, _make_account(), app_model=MagicMock(id=APP_ID))

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
            method(api, session, _make_account(), app_model=MagicMock(id=APP_ID))


class TestAppEndpoints:
    def test_app_put_should_preserve_icon_type_when_payload_omits_it(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        api = app_module.AppApi()
        method = unwrap(api.put)
        payload = {
            "name": "Updated App",
            "description": "Updated description",
            "icon": "🤖",
            "icon_background": "#FFFFFF",
        }
        app_service = MagicMock()
        app_service.update_app.return_value = SimpleNamespace()
        response_model = MagicMock()
        response_model.model_dump.return_value = {"id": "app-1"}

        monkeypatch.setattr(app_module, "AppService", lambda: app_service)
        monkeypatch.setattr(app_module.AppDetailWithSite, "model_validate", MagicMock(return_value=response_model))

        with (
            app.test_request_context("/console/api/apps/app-1", method="PUT", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            response = method(api, app_model=SimpleNamespace(icon_type=app_module.IconType.EMOJI))

        assert response == {"id": "app-1"}
        assert app_service.update_app.call_args.args[1]["icon_type"] is None

    def test_update_app_payload_should_reject_empty_icon_type(self):
        with pytest.raises(ValidationError):
            app_module.UpdateAppPayload.model_validate(
                {
                    "name": "Updated App",
                    "description": "Updated description",
                    "icon_type": "",
                    "icon": "🤖",
                    "icon_background": "#FFFFFF",
                }
            )

    def test_app_icon_post_should_forward_icon_type(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        api = app_module.AppIconApi()
        method = unwrap(api.post)
        payload = {
            "icon": "https://example.com/icon.png",
            "icon_type": "image",
            "icon_background": "#FFFFFF",
        }
        app_service = MagicMock()
        app_service.update_app_icon.return_value = SimpleNamespace()
        response_model = MagicMock()
        response_model.model_dump.return_value = {"id": "app-1"}

        monkeypatch.setattr(app_module, "AppService", lambda: app_service)
        monkeypatch.setattr(app_module.AppDetail, "model_validate", MagicMock(return_value=response_model))

        with (
            app.test_request_context("/console/api/apps/app-1/icon", method="POST", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            response = method(api, app_model=SimpleNamespace())

        assert response == {"id": "app-1"}
        assert app_service.update_app_icon.call_args.args[1:] == (
            payload["icon"],
            payload["icon_background"],
            app_module.IconType.IMAGE,
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

        monkeypatch.setattr(
            ops_trace_module.OpsService,
            "get_tracing_app_config",
            lambda **_kwargs: None,
        )

        with app.test_request_context("/?tracing_provider=langfuse"):
            result = method(api, app_model=MagicMock(id="app-1"))

        assert result == {"has_not_configured": True}

    def test_trace_app_config_post_invalid(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        api = ops_trace_module.TraceAppConfigApi()
        method = unwrap(api.post)

        monkeypatch.setattr(
            ops_trace_module.OpsService,
            "create_tracing_app_config",
            lambda **_kwargs: {"error": True},
        )

        with app.test_request_context(
            "/",
            json={"tracing_provider": "langfuse", "tracing_config": {"api_key": "k"}},
        ):
            with pytest.raises(BadRequest):
                method(api, app_model=MagicMock(id="app-1"))

    def test_trace_app_config_delete_not_found(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        api = ops_trace_module.TraceAppConfigApi()
        method = unwrap(api.delete)

        monkeypatch.setattr(
            ops_trace_module.OpsService,
            "delete_tracing_app_config",
            lambda **_kwargs: False,
        )

        with app.test_request_context("/?tracing_provider=langfuse"):
            with pytest.raises(BadRequest):
                method(api, app_model=MagicMock(id="app-1"))


class TestSiteEndpoints:
    @staticmethod
    def _add_site(sqlite_session: Session) -> Site:
        site = Site(
            app_id=APP_ID,
            title="My Site",
            description="Test site",
            default_language="en-US",
            customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
            code="test-code",
        )
        sqlite_session.add(site)
        sqlite_session.commit()
        return site

    def test_site_response_structure(self):
        payload = AppSiteUpdatePayload(
            title="My Site",
            description="Test site",
            input_placeholder="Ask me anything",
        )
        assert payload.title == "My Site"
        assert payload.input_placeholder == "Ask me anything"

    def test_site_default_language_validation(self):
        payload = AppSiteUpdatePayload(default_language="en-US")
        assert payload.default_language == "en-US"

    @pytest.mark.parametrize("sqlite_session", [(Site,)], indirect=True)
    def test_app_site_update_post(
        self,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
    ) -> None:
        api = site_module.AppSite()
        method = unwrap(api.post)
        site = self._add_site(sqlite_session)
        monkeypatch.setattr(site_module, "db", SimpleNamespace(session=sqlite_session))

        with app.test_request_context("/", json={"title": "My Site", "input_placeholder": "Ask me anything"}):
            result = method(api, SimpleNamespace(id=USER_ID), app_model=SimpleNamespace(id=APP_ID))

        sqlite_session.refresh(site)
        assert isinstance(result, dict)
        assert result["title"] == "My Site"
        assert result["input_placeholder"] == "Ask me anything"
        assert site.input_placeholder == "Ask me anything"

    @pytest.mark.parametrize("sqlite_session", [(Site,)], indirect=True)
    def test_app_site_access_token_reset(
        self,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
    ) -> None:
        api = site_module.AppSiteAccessTokenReset()
        method = unwrap(api.post)
        site = self._add_site(sqlite_session)
        monkeypatch.setattr(site_module, "db", SimpleNamespace(session=sqlite_session))
        monkeypatch.setattr(site_module.Site, "generate_code", lambda *_args, **_kwargs: "code")

        with app.test_request_context("/"):
            result = method(api, SimpleNamespace(id=USER_ID), app_model=SimpleNamespace(id=APP_ID))

        sqlite_session.refresh(site)
        assert isinstance(result, dict)
        assert result["access_token"] == "code"
        assert site.code == "code"


class TestWorkflowEndpoints:
    def test_workflow_copy_payload(self):
        payload = SyncDraftWorkflowPayload(graph={}, features={})
        assert payload.graph == {}

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

    def test_workflow_app_log_api_get(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
    ) -> None:
        api = workflow_app_log_module.WorkflowAppLogApi()
        method = unwrap(api.get)
        monkeypatch.setattr(workflow_app_log_module, "db", SimpleNamespace(engine=sqlite_engine))

        def fake_get_paginate(self, *, session: Session, **_kwargs):
            assert session.get_bind() is sqlite_engine
            return {"page": 1, "limit": 20, "total": 0, "has_more": False, "data": []}

        monkeypatch.setattr(
            workflow_app_log_module.WorkflowAppService,
            "get_paginate_workflow_app_logs",
            fake_get_paginate,
        )

        with app.test_request_context("/?page=1&limit=20"):
            result = method(api, app_model=SimpleNamespace(id="app-1"))

        assert result == {"page": 1, "limit": 20, "total": 0, "has_more": False, "data": []}


class TestWorkflowDraftVariableEndpoints:
    def test_workflow_variable_creation(self):
        payload = WorkflowDraftVariableUpdatePayload(name="var1", value="test")
        assert payload.name == "var1"

    def test_workflow_variable_collection_get(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
    ) -> None:
        api = workflow_draft_variable_module.WorkflowVariableCollectionApi()
        method = unwrap(api.get)
        session_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
        monkeypatch.setattr(
            workflow_draft_variable_module,
            "db",
            SimpleNamespace(engine=sqlite_engine, session=session_factory),
        )

        class DummyDraftService:
            def __init__(self, session: Session):
                self.session = session

            def list_variables_without_values(self, **_kwargs):
                assert self.session.get_bind() is sqlite_engine
                return {"items": [], "total": 0}

        class DummyWorkflowService:
            def is_workflow_exist(self, *args, **kwargs):
                return True

        monkeypatch.setattr(workflow_draft_variable_module, "WorkflowDraftVariableService", DummyDraftService)
        monkeypatch.setattr(workflow_draft_variable_module, "WorkflowService", DummyWorkflowService)

        with app.test_request_context("/?page=1&limit=20"):
            result = method(api, _make_account(), app_model=SimpleNamespace(id="app-1"))

        assert result == {"items": [], "total": 0}


class TestWorkflowStatisticEndpoints:
    def test_workflow_statistic_time_range(self):
        query = WorkflowStatisticQuery(start="2024-01-01", end="2024-12-31")
        assert query.start == "2024-01-01"

    def test_workflow_statistic_blank_to_none(self):
        query = WorkflowStatisticQuery(start="", end="")
        assert query.start is None
        assert query.end is None

    def test_workflow_daily_runs_statistic(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
    ) -> None:
        monkeypatch.setattr(workflow_statistic_module, "db", SimpleNamespace(engine=sqlite_engine))
        monkeypatch.setattr(
            workflow_statistic_module.DifyAPIRepositoryFactory,
            "create_api_workflow_run_repository",
            lambda *_args, **_kwargs: SimpleNamespace(get_daily_runs_statistics=lambda **_kw: [{"date": "2024-01-01"}]),
        )
        monkeypatch.setattr(
            workflow_statistic_module,
            "parse_time_range",
            lambda *_args, **_kwargs: (None, None),
        )

        api = workflow_statistic_module.WorkflowDailyRunsStatistic()
        method = unwrap(api.get)

        with app.test_request_context("/"):
            response = method(
                api, SimpleNamespace(timezone="UTC"), app_model=SimpleNamespace(tenant_id="t1", id="app-1")
            )

        assert response.get_json() == {"data": [{"date": "2024-01-01"}]}

    def test_workflow_daily_terminals_statistic(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
    ) -> None:
        monkeypatch.setattr(workflow_statistic_module, "db", SimpleNamespace(engine=sqlite_engine))
        monkeypatch.setattr(
            workflow_statistic_module.DifyAPIRepositoryFactory,
            "create_api_workflow_run_repository",
            lambda *_args, **_kwargs: SimpleNamespace(
                get_daily_terminals_statistics=lambda **_kw: [{"date": "2024-01-02"}]
            ),
        )
        monkeypatch.setattr(
            workflow_statistic_module,
            "parse_time_range",
            lambda *_args, **_kwargs: (None, None),
        )

        api = workflow_statistic_module.WorkflowDailyTerminalsStatistic()
        method = unwrap(api.get)

        with app.test_request_context("/"):
            response = method(
                api, SimpleNamespace(timezone="UTC"), app_model=SimpleNamespace(tenant_id="t1", id="app-1")
            )

        assert response.get_json() == {"data": [{"date": "2024-01-02"}]}


class TestWorkflowTriggerEndpoints:
    def test_webhook_trigger_payload(self):
        payload = Parser(node_id="node-1")
        assert payload.node_id == "node-1"

        enable_payload = ParserEnable(trigger_id="trigger-1", enable_trigger=True)
        assert enable_payload.enable_trigger is True

    @pytest.mark.parametrize("sqlite_session", [(WorkflowWebhookTrigger,)], indirect=True)
    def test_webhook_trigger_api_get(
        self,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_engine: Engine,
        sqlite_session: Session,
    ) -> None:
        api = workflow_trigger_module.WebhookTriggerApi()
        method = unwrap(api.get)
        trigger = WorkflowWebhookTrigger(
            app_id=APP_ID,
            node_id="node-1",
            tenant_id=TENANT_ID,
            webhook_id="webhook-1",
            created_by=USER_ID,
        )
        sqlite_session.add(trigger)
        sqlite_session.commit()
        monkeypatch.setattr(workflow_trigger_module, "db", SimpleNamespace(engine=sqlite_engine))

        with app.test_request_context("/?node_id=node-1"):
            result = method(api, app_model=SimpleNamespace(id=APP_ID))

        assert isinstance(result, dict)
        assert {"id", "webhook_id", "webhook_url", "webhook_debug_url", "node_id", "created_at"} <= set(result.keys())
        assert result["webhook_id"] == "webhook-1"


class TestWrapsEndpoints:
    def test_get_app_model_context(self):
        assert hasattr(wraps_module, "get_app_model")


class TestMCPServerEndpoints:
    def test_mcp_server_connection(self):
        payload = MCPServerCreatePayload(parameters={"url": "http://localhost:3000"})
        assert payload.parameters["url"] == "http://localhost:3000"

    def test_mcp_server_update_payload(self):
        payload = MCPServerUpdatePayload(id="server-1", parameters={"timeout": 30}, status="active")
        assert payload.status == "active"


class TestErrorHandling:
    def test_annotation_list_query_validation(self):
        with pytest.raises(ValueError):
            annotation_module.AnnotationListQuery(page=0)


class TestPayloadIntegration:
    def test_multiple_payload_types(self):
        payloads = [
            annotation_module.AnnotationReplyPayload(
                score_threshold=0.5, embedding_provider_name="openai", embedding_model_name="text-embedding-3-small"
            ),
            message_module.MessageFeedbackPayload(message_id=str(uuid.uuid4()), rating="like"),
            statistic_module.StatisticTimeRangeQuery(start="2024-01-01"),
        ]
        assert len(payloads) == 3
        assert all(p is not None for p in payloads)
