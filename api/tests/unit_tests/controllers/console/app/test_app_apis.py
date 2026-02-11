"""
Additional tests to improve coverage for low-coverage modules in controllers/console/app.
Target: increase coverage for files with <75% coverage.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from werkzeug.exceptions import BadRequest, NotFound

from controllers.console.app import (
    annotation as annotation_module,
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


class _ConnContext:
    def __init__(self, rows):
        self._rows = rows

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, _query, _args):
        return self._rows


# ========== Completion Tests ==========
class TestCompletionEndpoints:
    """Tests for completion API endpoints."""

    def test_completion_create_payload(self):
        """Test completion creation payload."""
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

    def test_completion_api_success(self, app, monkeypatch):
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

    def test_completion_api_conversation_not_exists(self, app, monkeypatch):
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

    def test_completion_api_provider_not_initialized(self, app, monkeypatch):
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

    def test_completion_api_quota_exceeded(self, app, monkeypatch):
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


# ========== OpsTrace Tests ==========
class TestOpsTraceEndpoints:
    """Tests for ops_trace endpoint."""

    def test_ops_trace_query_basic(self):
        """Test ops_trace query."""
        query = TraceProviderQuery(tracing_provider="langfuse")
        assert query.tracing_provider == "langfuse"

    def test_ops_trace_config_payload(self):
        payload = TraceConfigPayload(tracing_provider="langfuse", tracing_config={"api_key": "k"})
        assert payload.tracing_config["api_key"] == "k"

    def test_trace_app_config_get_empty(self, app, monkeypatch):
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

    def test_trace_app_config_post_invalid(self, app, monkeypatch):
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

    def test_trace_app_config_delete_not_found(self, app, monkeypatch):
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


# ========== Site Tests ==========
class TestSiteEndpoints:
    """Tests for site endpoint."""

    def test_site_response_structure(self):
        """Test site response structure."""
        payload = AppSiteUpdatePayload(title="My Site", description="Test site")
        assert payload.title == "My Site"

    def test_site_default_language_validation(self):
        payload = AppSiteUpdatePayload(default_language="en-US")
        assert payload.default_language == "en-US"

    def test_app_site_update_post(self, app, monkeypatch):
        api = site_module.AppSite()
        method = _unwrap(api.post)

        site = MagicMock()
        query = MagicMock()
        query.where.return_value.first.return_value = site
        monkeypatch.setattr(
            site_module.db,
            "session",
            MagicMock(query=lambda *_args, **_kwargs: query, commit=lambda: None),
        )
        monkeypatch.setattr(
            site_module,
            "current_account_with_tenant",
            lambda: (SimpleNamespace(id="u1"), "t1"),
        )
        monkeypatch.setattr(site_module, "naive_utc_now", lambda: "now")

        with app.test_request_context("/", json={"title": "My Site"}):
            result = method(app_model=SimpleNamespace(id="app-1"))

        assert result is site

    def test_app_site_access_token_reset(self, app, monkeypatch):
        api = site_module.AppSiteAccessTokenReset()
        method = _unwrap(api.post)

        site = MagicMock()
        query = MagicMock()
        query.where.return_value.first.return_value = site
        monkeypatch.setattr(
            site_module.db,
            "session",
            MagicMock(query=lambda *_args, **_kwargs: query, commit=lambda: None),
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

        assert result is site


# ========== Workflow Tests ==========
class TestWorkflowEndpoints:
    """Tests for workflow endpoints."""

    def test_workflow_copy_payload(self):
        """Test workflow copy payload."""
        payload = SyncDraftWorkflowPayload(graph={}, features={})
        assert payload.graph == {}

    def test_workflow_mode_query(self):
        """Test workflow mode query."""
        payload = AdvancedChatWorkflowRunPayload(inputs={}, query="hi")
        assert payload.query == "hi"


# ========== Workflow App Log Tests ==========
class TestWorkflowAppLogEndpoints:
    """Tests for workflow app log endpoints."""

    def test_workflow_app_log_query(self):
        """Test workflow app log query."""
        query = WorkflowAppLogQuery(keyword="test", page=1, limit=20)
        assert query.keyword == "test"

    def test_workflow_app_log_query_detail_bool(self):
        query = WorkflowAppLogQuery(detail="true")
        assert query.detail is True

    def test_workflow_app_log_api_get(self, app, monkeypatch):
        api = workflow_app_log_module.WorkflowAppLogApi()
        method = _unwrap(api.get)

        monkeypatch.setattr(workflow_app_log_module, "db", SimpleNamespace(engine=MagicMock()))

        class DummySession:
            def __enter__(self):
                return "session"

            def __exit__(self, exc_type, exc, tb):
                return False

        monkeypatch.setattr(workflow_app_log_module, "Session", lambda *args, **kwargs: DummySession())

        def fake_get_paginate(self, **_kwargs):
            return {"items": [], "total": 0}

        monkeypatch.setattr(
            workflow_app_log_module.WorkflowAppService,
            "get_paginate_workflow_app_logs",
            fake_get_paginate,
        )

        with app.test_request_context("/?page=1&limit=20"):
            result = method(app_model=SimpleNamespace(id="app-1"))

        assert result == {"items": [], "total": 0}


# ========== Workflow Draft Variable Tests ==========
class TestWorkflowDraftVariableEndpoints:
    """Tests for workflow draft variable endpoints."""

    def test_workflow_variable_creation(self):
        """Test workflow variable creation."""
        payload = WorkflowDraftVariableUpdatePayload(name="var1", value="test")
        assert payload.name == "var1"

    def test_workflow_variable_collection_get(self, app, monkeypatch):
        api = workflow_draft_variable_module.WorkflowVariableCollectionApi()
        method = _unwrap(api.get)

        monkeypatch.setattr(workflow_draft_variable_module, "db", SimpleNamespace(engine=MagicMock()))

        class DummySession:
            def __enter__(self):
                return "session"

            def __exit__(self, exc_type, exc, tb):
                return False

        class DummyDraftService:
            def __init__(self, session):
                self.session = session

            def list_variables_without_values(self, **_kwargs):
                return {"items": [], "total": 0}

        monkeypatch.setattr(workflow_draft_variable_module, "Session", lambda *args, **kwargs: DummySession())

        class DummyWorkflowService:
            def is_workflow_exist(self, *args, **kwargs):
                return True

        monkeypatch.setattr(workflow_draft_variable_module, "WorkflowDraftVariableService", DummyDraftService)
        monkeypatch.setattr(workflow_draft_variable_module, "WorkflowService", DummyWorkflowService)

        with app.test_request_context("/?page=1&limit=20"):
            result = method(app_model=SimpleNamespace(id="app-1"))

        assert result == {"items": [], "total": 0}


# ========== Workflow Statistic Tests ==========
class TestWorkflowStatisticEndpoints:
    """Tests for workflow statistic endpoints."""

    def test_workflow_statistic_time_range(self):
        """Test workflow statistic time range query."""
        query = WorkflowStatisticQuery(start="2024-01-01", end="2024-12-31")
        assert query.start == "2024-01-01"

    def test_workflow_statistic_blank_to_none(self):
        query = WorkflowStatisticQuery(start="", end="")
        assert query.start is None
        assert query.end is None

    def test_workflow_daily_runs_statistic(self, app, monkeypatch):
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

    def test_workflow_daily_terminals_statistic(self, app, monkeypatch):
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


# ========== Workflow Trigger Tests ==========
class TestWorkflowTriggerEndpoints:
    """Tests for workflow trigger endpoints."""

    def test_webhook_trigger_payload(self):
        """Test webhook trigger payload."""
        payload = Parser(node_id="node-1")
        assert payload.node_id == "node-1"

        enable_payload = ParserEnable(trigger_id="trigger-1", enable_trigger=True)
        assert enable_payload.enable_trigger is True

    def test_webhook_trigger_api_get(self, app, monkeypatch):
        api = workflow_trigger_module.WebhookTriggerApi()
        method = _unwrap(api.get)

        monkeypatch.setattr(workflow_trigger_module, "db", SimpleNamespace(engine=MagicMock()))

        trigger = MagicMock()
        session = MagicMock()
        session.query.return_value.where.return_value.first.return_value = trigger

        class DummySession:
            def __enter__(self):
                return session

            def __exit__(self, exc_type, exc, tb):
                return False

        monkeypatch.setattr(workflow_trigger_module, "Session", lambda *_args, **_kwargs: DummySession())

        with app.test_request_context("/?node_id=node-1"):
            result = method(app_model=SimpleNamespace(id="app-1"))

        assert result is trigger


# ========== Wraps Tests ==========
class TestWrapsEndpoints:
    """Tests for wraps utility functions."""

    def test_get_app_model_context(self):
        """Test get_app_model wrapper context."""
        # These are decorator functions, so we test their availability
        assert hasattr(wraps_module, "get_app_model")


# ========== MCP Server Tests ==========
class TestMCPServerEndpoints:
    """Tests for MCP server endpoints."""

    def test_mcp_server_connection(self):
        """Test MCP server connection."""
        payload = MCPServerCreatePayload(parameters={"url": "http://localhost:3000"})
        assert payload.parameters["url"] == "http://localhost:3000"

    def test_mcp_server_update_payload(self):
        payload = MCPServerUpdatePayload(id="server-1", parameters={"timeout": 30}, status="active")
        assert payload.status == "active"


# ========== Error Handling Tests ==========
class TestErrorHandling:
    """Tests for error handling in various endpoints."""

    def test_annotation_list_query_validation(self):
        """Test annotation list query validation."""
        with pytest.raises(ValueError):
            annotation_module.AnnotationListQuery(page=0)


# ========== Integration-like Tests ==========
class TestPayloadIntegration:
    """Integration tests for payload handling."""

    def test_multiple_payload_types(self):
        """Test handling of multiple payload types."""
        payloads = [
            annotation_module.AnnotationReplyPayload(
                score_threshold=0.5, embedding_provider_name="openai", embedding_model_name="text-embedding-3-small"
            ),
            message_module.MessageFeedbackPayload(message_id=str(uuid.uuid4()), rating="like"),
            statistic_module.StatisticTimeRangeQuery(start="2024-01-01"),
        ]
        assert len(payloads) == 3
        assert all(p is not None for p in payloads)
