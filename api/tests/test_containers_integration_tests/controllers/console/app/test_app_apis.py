"""Testcontainers integration tests for controllers/console/app endpoints."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from pydantic import ValidationError
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


def _unwrap(func):
    bound_self = getattr(func, "__self__", None)
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    if bound_self is not None:
        return func.__get__(bound_self, bound_self.__class__)
    return func


class TestCompletionEndpoints:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

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

    def test_completion_api_success(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        api = completion_module.CompletionMessageApi()
        method = _unwrap(api.post)

        class DummyAccount:
            pass

        dummy_account = DummyAccount()

        monkeypatch.setattr(completion_module, "current_user", dummy_account)
        monkeypatch.setattr(completion_module, "Account", DummyAccount)
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

        with app.test_request_context(
            "/",
            json={"inputs": {}, "model_config": {}, "query": "hi"},
        ):
            resp = method(app_model=MagicMock(id="app-1"))

        assert resp == {"result": {"text": "ok"}}

    def test_completion_api_conversation_not_exists(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        api = completion_module.CompletionMessageApi()
        method = _unwrap(api.post)

        class DummyAccount:
            pass

        dummy_account = DummyAccount()

        monkeypatch.setattr(completion_module, "current_user", dummy_account)
        monkeypatch.setattr(completion_module, "Account", DummyAccount)
        monkeypatch.setattr(
            completion_module.AppGenerateService,
            "generate",
            lambda **_kwargs: (_ for _ in ()).throw(
                completion_module.services.errors.conversation.ConversationNotExistsError()
            ),
        )

        with app.test_request_context(
            "/",
            json={"inputs": {}, "model_config": {}, "query": "hi"},
        ):
            with pytest.raises(NotFound):
                method(app_model=MagicMock(id="app-1"))

    def test_completion_api_provider_not_initialized(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        api = completion_module.CompletionMessageApi()
        method = _unwrap(api.post)

        class DummyAccount:
            pass

        dummy_account = DummyAccount()

        monkeypatch.setattr(completion_module, "current_user", dummy_account)
        monkeypatch.setattr(completion_module, "Account", DummyAccount)
        monkeypatch.setattr(
            completion_module.AppGenerateService,
            "generate",
            lambda **_kwargs: (_ for _ in ()).throw(completion_module.ProviderTokenNotInitError("x")),
        )

        with app.test_request_context(
            "/",
            json={"inputs": {}, "model_config": {}, "query": "hi"},
        ):
            with pytest.raises(completion_module.ProviderNotInitializeError):
                method(app_model=MagicMock(id="app-1"))

    def test_completion_api_quota_exceeded(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        api = completion_module.CompletionMessageApi()
        method = _unwrap(api.post)

        class DummyAccount:
            pass

        dummy_account = DummyAccount()

        monkeypatch.setattr(completion_module, "current_user", dummy_account)
        monkeypatch.setattr(completion_module, "Account", DummyAccount)
        monkeypatch.setattr(
            completion_module.AppGenerateService,
            "generate",
            lambda **_kwargs: (_ for _ in ()).throw(completion_module.QuotaExceededError()),
        )

        with app.test_request_context(
            "/",
            json={"inputs": {}, "model_config": {}, "query": "hi"},
        ):
            with pytest.raises(completion_module.ProviderQuotaExceededError):
                method(app_model=MagicMock(id="app-1"))


class TestAppEndpoints:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_app_put_should_preserve_icon_type_when_payload_omits_it(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        api = app_module.AppApi()
        method = _unwrap(api.put)
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
            response = method(app_model=SimpleNamespace(icon_type=app_module.IconType.EMOJI))

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
        method = _unwrap(api.post)
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
            response = method(app_model=SimpleNamespace())

        assert response == {"id": "app-1"}
        assert app_service.update_app_icon.call_args.args[1:] == (
            payload["icon"],
            payload["icon_background"],
            app_module.IconType.IMAGE,
        )


class TestOpsTraceEndpoints:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_ops_trace_query_basic(self):
        query = TraceProviderQuery(tracing_provider="langfuse")
        assert query.tracing_provider == "langfuse"

    def test_ops_trace_config_payload(self):
        payload = TraceConfigPayload(tracing_provider="langfuse", tracing_config={"api_key": "k"})
        assert payload.tracing_config["api_key"] == "k"

    def test_trace_app_config_get_empty(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        api = ops_trace_module.TraceAppConfigApi()
        method = _unwrap(api.get)

        monkeypatch.setattr(
            ops_trace_module.OpsService,
            "get_tracing_app_config",
            lambda **_kwargs: None,
        )

        with app.test_request_context("/?tracing_provider=langfuse"):
            result = method(app_id="app-1")

        assert result == {"has_not_configured": True}

    def test_trace_app_config_post_invalid(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        api = ops_trace_module.TraceAppConfigApi()
        method = _unwrap(api.post)

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
                method(app_id="app-1")

    def test_trace_app_config_delete_not_found(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        api = ops_trace_module.TraceAppConfigApi()
        method = _unwrap(api.delete)

        monkeypatch.setattr(
            ops_trace_module.OpsService,
            "delete_tracing_app_config",
            lambda **_kwargs: False,
        )

        with app.test_request_context("/?tracing_provider=langfuse"):
            with pytest.raises(BadRequest):
                method(app_id="app-1")


class TestSiteEndpoints:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_site_response_structure(self):
        payload = AppSiteUpdatePayload(title="My Site", description="Test site")
        assert payload.title == "My Site"

    def test_site_default_language_validation(self):
        payload = AppSiteUpdatePayload(default_language="en-US")
        assert payload.default_language == "en-US"

    def test_app_site_update_post(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        api = site_module.AppSite()
        method = _unwrap(api.post)

        site = MagicMock()
        site.app_id = "app-1"
        site.code = "test-code"
        site.title = "My Site"
        site.icon = None
        site.icon_background = None
        site.description = "Test site"
        site.default_language = "en-US"
        site.customize_domain = None
        site.copyright = None
        site.privacy_policy = None
        site.custom_disclaimer = ""
        site.customize_token_strategy = "not_allow"
        site.prompt_public = False
        site.show_workflow_steps = True
        site.use_icon_as_answer_icon = False
        monkeypatch.setattr(
            site_module.db,
            "session",
            MagicMock(scalar=lambda *_args, **_kwargs: site, commit=lambda: None),
        )
        monkeypatch.setattr(
            site_module,
            "current_account_with_tenant",
            lambda: (SimpleNamespace(id="u1"), "t1"),
        )
        monkeypatch.setattr(site_module, "naive_utc_now", lambda: "now")

        with app.test_request_context("/", json={"title": "My Site"}):
            result = method(app_model=SimpleNamespace(id="app-1"))

        assert isinstance(result, dict)
        assert result["title"] == "My Site"

    def test_app_site_access_token_reset(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        api = site_module.AppSiteAccessTokenReset()
        method = _unwrap(api.post)

        site = MagicMock()
        site.app_id = "app-1"
        site.code = "old-code"
        site.title = "My Site"
        site.icon = None
        site.icon_background = None
        site.description = None
        site.default_language = "en-US"
        site.customize_domain = None
        site.copyright = None
        site.privacy_policy = None
        site.custom_disclaimer = ""
        site.customize_token_strategy = "not_allow"
        site.prompt_public = False
        site.show_workflow_steps = True
        site.use_icon_as_answer_icon = False
        monkeypatch.setattr(
            site_module.db,
            "session",
            MagicMock(scalar=lambda *_args, **_kwargs: site, commit=lambda: None),
        )
        monkeypatch.setattr(site_module.Site, "generate_code", lambda *_args, **_kwargs: "code")
        monkeypatch.setattr(
            site_module,
            "current_account_with_tenant",
            lambda: (SimpleNamespace(id="u1"), "t1"),
        )
        monkeypatch.setattr(site_module, "naive_utc_now", lambda: "now")

        with app.test_request_context("/"):
            result = method(app_model=SimpleNamespace(id="app-1"))

        assert isinstance(result, dict)
        assert result["access_token"] == "code"


class TestWorkflowEndpoints:
    def test_workflow_copy_payload(self):
        payload = SyncDraftWorkflowPayload(graph={}, features={})
        assert payload.graph == {}

    def test_workflow_mode_query(self):
        payload = AdvancedChatWorkflowRunPayload(inputs={}, query="hi")
        assert payload.query == "hi"


class TestWorkflowAppLogEndpoints:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_workflow_app_log_query(self):
        query = WorkflowAppLogQuery(keyword="test", page=1, limit=20)
        assert query.keyword == "test"

    def test_workflow_app_log_query_detail_bool(self):
        query = WorkflowAppLogQuery(detail="true")
        assert query.detail is True

    def test_workflow_app_log_api_get(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        api = workflow_app_log_module.WorkflowAppLogApi()
        method = _unwrap(api.get)

        monkeypatch.setattr(workflow_app_log_module, "db", SimpleNamespace(engine=MagicMock()))

        class DummySessionCtx:
            def __enter__(self):
                return "session"

            def __exit__(self, exc_type, exc, tb):
                return False

        class DummySessionMaker:
            def __init__(self, *args, **kwargs):
                pass

            def begin(self):
                return DummySessionCtx()

        monkeypatch.setattr(workflow_app_log_module, "sessionmaker", DummySessionMaker)

        def fake_get_paginate(self, **_kwargs):
            return {"page": 1, "limit": 20, "total": 0, "has_more": False, "data": []}

        monkeypatch.setattr(
            workflow_app_log_module.WorkflowAppService,
            "get_paginate_workflow_app_logs",
            fake_get_paginate,
        )

        with app.test_request_context("/?page=1&limit=20"):
            result = method(app_model=SimpleNamespace(id="app-1"))

        assert result == {"page": 1, "limit": 20, "total": 0, "has_more": False, "data": []}


class TestWorkflowDraftVariableEndpoints:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_workflow_variable_creation(self):
        payload = WorkflowDraftVariableUpdatePayload(name="var1", value="test")
        assert payload.name == "var1"

    def test_workflow_variable_collection_get(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        api = workflow_draft_variable_module.WorkflowVariableCollectionApi()
        method = _unwrap(api.get)

        monkeypatch.setattr(workflow_draft_variable_module, "db", SimpleNamespace(engine=MagicMock()))
        monkeypatch.setattr(workflow_draft_variable_module, "current_user", SimpleNamespace(id="user-1"))

        class DummySessionCtx:
            def __enter__(self):
                return "session"

            def __exit__(self, exc_type, exc, tb):
                return False

        class DummySessionMaker:
            def __init__(self, *args, **kwargs):
                pass

            def begin(self):
                return DummySessionCtx()

        class DummyDraftService:
            def __init__(self, session):
                self.session = session

            def list_variables_without_values(self, **_kwargs):
                return {"items": [], "total": 0}

        monkeypatch.setattr(workflow_draft_variable_module, "sessionmaker", DummySessionMaker)

        class DummyWorkflowService:
            def is_workflow_exist(self, *args, **kwargs):
                return True

        monkeypatch.setattr(workflow_draft_variable_module, "WorkflowDraftVariableService", DummyDraftService)
        monkeypatch.setattr(workflow_draft_variable_module, "WorkflowService", DummyWorkflowService)

        with app.test_request_context("/?page=1&limit=20"):
            result = method(app_model=SimpleNamespace(id="app-1"))

        assert result == {"items": [], "total": 0}


class TestWorkflowStatisticEndpoints:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_workflow_statistic_time_range(self):
        query = WorkflowStatisticQuery(start="2024-01-01", end="2024-12-31")
        assert query.start == "2024-01-01"

    def test_workflow_statistic_blank_to_none(self):
        query = WorkflowStatisticQuery(start="", end="")
        assert query.start is None
        assert query.end is None

    def test_workflow_daily_runs_statistic(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(workflow_statistic_module, "db", SimpleNamespace(engine=MagicMock()))
        monkeypatch.setattr(
            workflow_statistic_module.DifyAPIRepositoryFactory,
            "create_api_workflow_run_repository",
            lambda *_args, **_kwargs: SimpleNamespace(get_daily_runs_statistics=lambda **_kw: [{"date": "2024-01-01"}]),
        )
        monkeypatch.setattr(
            workflow_statistic_module,
            "current_account_with_tenant",
            lambda: (SimpleNamespace(timezone="UTC"), "t1"),
        )
        monkeypatch.setattr(
            workflow_statistic_module,
            "parse_time_range",
            lambda *_args, **_kwargs: (None, None),
        )

        api = workflow_statistic_module.WorkflowDailyRunsStatistic()
        method = _unwrap(api.get)

        with app.test_request_context("/"):
            response = method(app_model=SimpleNamespace(tenant_id="t1", id="app-1"))

        assert response.get_json() == {"data": [{"date": "2024-01-01"}]}

    def test_workflow_daily_terminals_statistic(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(workflow_statistic_module, "db", SimpleNamespace(engine=MagicMock()))
        monkeypatch.setattr(
            workflow_statistic_module.DifyAPIRepositoryFactory,
            "create_api_workflow_run_repository",
            lambda *_args, **_kwargs: SimpleNamespace(
                get_daily_terminals_statistics=lambda **_kw: [{"date": "2024-01-02"}]
            ),
        )
        monkeypatch.setattr(
            workflow_statistic_module,
            "current_account_with_tenant",
            lambda: (SimpleNamespace(timezone="UTC"), "t1"),
        )
        monkeypatch.setattr(
            workflow_statistic_module,
            "parse_time_range",
            lambda *_args, **_kwargs: (None, None),
        )

        api = workflow_statistic_module.WorkflowDailyTerminalsStatistic()
        method = _unwrap(api.get)

        with app.test_request_context("/"):
            response = method(app_model=SimpleNamespace(tenant_id="t1", id="app-1"))

        assert response.get_json() == {"data": [{"date": "2024-01-02"}]}


class TestWorkflowTriggerEndpoints:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_webhook_trigger_payload(self):
        payload = Parser(node_id="node-1")
        assert payload.node_id == "node-1"

        enable_payload = ParserEnable(trigger_id="trigger-1", enable_trigger=True)
        assert enable_payload.enable_trigger is True

    def test_webhook_trigger_api_get(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        api = workflow_trigger_module.WebhookTriggerApi()
        method = _unwrap(api.get)

        monkeypatch.setattr(workflow_trigger_module, "db", SimpleNamespace(engine=MagicMock()))

        trigger = MagicMock()
        session = MagicMock()
        session.scalar.return_value = trigger

        class DummySessionCtx:
            def __enter__(self):
                return session

            def __exit__(self, exc_type, exc, tb):
                return False

        class DummySessionMaker:
            def __init__(self, *args, **kwargs):
                pass

            def begin(self):
                return DummySessionCtx()

        monkeypatch.setattr(workflow_trigger_module, "sessionmaker", DummySessionMaker)

        with app.test_request_context("/?node_id=node-1"):
            result = method(app_model=SimpleNamespace(id="app-1"))

        assert isinstance(result, dict)
        assert {"id", "webhook_id", "webhook_url", "webhook_debug_url", "node_id", "created_at"} <= set(result.keys())


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
