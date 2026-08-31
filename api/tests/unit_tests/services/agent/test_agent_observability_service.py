import json
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from graphon.enums import WorkflowNodeExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.agent import WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.agent_config_entities import WorkflowNodeJobConfig
from models.enums import (
    ConversationFromSource,
    CreatorUserRole,
    FeedbackFromSource,
    FeedbackRating,
    MessageStatus,
)
from models.model import App, AppMode, Conversation, IconType, Message, MessageFeedback
from models.workflow import (
    WorkflowExecutionStatus,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowRunTriggeredFrom,
    WorkflowType,
)
from services.agent import observability_service as observability_service_module
from services.agent.observability_service import AgentLogQueryParams, AgentObservabilityService
from tests.unit_tests.config_override import apply_config_overrides


def _app(*, app_id: str = "app-1", name: str = "Iris", mode: AppMode = AppMode.AGENT_CHAT) -> App:
    return App(
        id=app_id,
        tenant_id="tenant-1",
        name=name,
        mode=mode,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#fff",
        enable_site=False,
        enable_api=False,
    )


def _conversation(*, conversation_id: str = "conversation-1", app_id: str = "app-1") -> Conversation:
    return Conversation(
        id=conversation_id,
        app_id=app_id,
        mode=AppMode.AGENT_CHAT,
        name="Debug conversation",
        inputs={},
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id="end-user-1",
    )


def _message(
    *,
    message_id: str = "message-1",
    conversation_id: str = "conversation-1",
    app_id: str = "app-1",
    created_at: datetime | None = None,
) -> Message:
    timestamp = created_at or naive_utc_now()
    return Message(
        id=message_id,
        app_id=app_id,
        conversation_id=conversation_id,
        inputs={},
        query="hello",
        message={},
        answer="hi",
        status=MessageStatus.NORMAL,
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        total_price=Decimal("0.0001"),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id="account-1",
        invoke_from=InvokeFrom.EXPLORE,
        message_tokens=3,
        answer_tokens=4,
        provider_response_latency=1.25,
        created_at=timestamp,
        updated_at=timestamp,
    )


def _feedback(
    *,
    message_id: str = "message-1",
    conversation_id: str = "conversation-1",
    source: FeedbackFromSource = FeedbackFromSource.USER,
    rating: FeedbackRating = FeedbackRating.LIKE,
    content: str | None = "Useful",
) -> MessageFeedback:
    return MessageFeedback(
        app_id="app-1",
        conversation_id=conversation_id,
        message_id=message_id,
        rating=rating,
        from_source=source,
        content=content,
    )


def _workflow_run(*, workflow_type: WorkflowType = WorkflowType.WORKFLOW) -> WorkflowRun:
    created_at = datetime(2026, 7, 21, 7, 0, 19)
    return WorkflowRun(
        id="workflow-run-1",
        tenant_id="tenant-1",
        app_id="workflow-app-1",
        workflow_id="workflow-1",
        type=workflow_type,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="v1",
        graph="{}",
        inputs="{}",
        status=WorkflowExecutionStatus.SUCCEEDED,
        outputs="{}",
        error=None,
        elapsed_time=59.93,
        total_tokens=454_064,
        total_steps=1,
        created_by_role=CreatorUserRole.END_USER,
        created_by="end-user-1",
        created_at=created_at,
        finished_at=created_at,
    )


def _node_execution(
    *,
    execution_id: str = "node-execution-1",
    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.SUCCEEDED,
) -> WorkflowNodeExecutionModel:
    created_at = datetime(2026, 7, 23, 7, 0, 19, tzinfo=UTC)
    return WorkflowNodeExecutionModel(
        id=execution_id,
        tenant_id="tenant-1",
        app_id="workflow-app-1",
        workflow_id="workflow-1",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id="workflow-run-1",
        index=1,
        predecessor_node_id=None,
        node_execution_id=execution_id,
        node_id="node-1",
        node_type="agent",
        title="Agent",
        inputs="{}",
        process_data="{}",
        outputs="{}",
        status=status,
        error=None,
        elapsed_time=59.93,
        execution_metadata=json.dumps(
            {
                "agent_log": {
                    "agent_backend": {
                        "usage": {
                            "prompt_tokens": 451_938,
                            "completion_tokens": 2_126,
                            "total_tokens": 454_064,
                            "total_price": "2.323470",
                            "currency": "USD",
                            "latency": 59.93,
                        }
                    }
                }
            }
        ),
        created_at=created_at,
        created_by_role=CreatorUserRole.END_USER,
        created_by="end-user-1",
        finished_at=None,
    )


def _workflow_binding(
    *, app_id: str = "workflow-app-1", binding_id: str | None = None, node_id: str = "node-1"
) -> WorkflowAgentNodeBinding:
    return WorkflowAgentNodeBinding(
        id=binding_id or f"binding-{app_id}-{node_id}",
        tenant_id="tenant-1",
        app_id=app_id,
        workflow_id="workflow-1",
        workflow_version="v1",
        node_id=node_id,
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=WorkflowNodeJobConfig(),
        created_by="account-1",
    )


def test_resolve_source_accepts_frontend_aliases() -> None:
    assert AgentObservabilityService.resolve_source(None) is None
    assert AgentObservabilityService.resolve_source("all") is None
    assert AgentObservabilityService.resolve_source("console") == InvokeFrom.EXPLORE
    assert AgentObservabilityService.resolve_source("api") == InvokeFrom.SERVICE_API
    assert AgentObservabilityService.resolve_source("web_app") == InvokeFrom.WEB_APP

    with pytest.raises(ValueError, match="Unsupported source"):
        AgentObservabilityService.resolve_source("unknown")


def test_resolve_source_filter_accepts_structured_sources() -> None:
    assert AgentObservabilityService.resolve_source_filter(None).kind == "all"
    assert AgentObservabilityService.resolve_source_filter("webapp").kind == "webapp"
    assert AgentObservabilityService.resolve_source_filter("webapp:app-1").app_id == "app-1"

    workflow_app_filter = AgentObservabilityService.resolve_source_filter("workflow:app-2")
    assert workflow_app_filter.kind == "workflow"
    assert workflow_app_filter.app_id == "app-2"
    assert workflow_app_filter.workflow_id is None

    workflow_filter = AgentObservabilityService.resolve_source_filter("workflow:app-2:workflow-1:v1:node-1")
    assert workflow_filter.kind == "workflow"
    assert workflow_filter.app_id == "app-2"
    assert workflow_filter.workflow_id == "workflow-1"
    assert workflow_filter.workflow_version == "v1"
    assert workflow_filter.node_id == "node-1"

    timestamp_version_filter = AgentObservabilityService.resolve_source_filter(
        "workflow:app-2:workflow-1:2026-07-06 02:17:12.910515:node-1"
    )
    assert timestamp_version_filter.workflow_version == "2026-07-06 02:17:12.910515"
    assert timestamp_version_filter.node_id == "node-1"

    legacy_filter = AgentObservabilityService.resolve_source_filter("console")
    assert legacy_filter.kind == "webapp"
    assert legacy_filter.invoke_from == InvokeFrom.EXPLORE

    with pytest.raises(ValueError, match="Unsupported source"):
        AgentObservabilityService.resolve_source_filter("workflow:")
    with pytest.raises(ValueError, match="Unsupported source"):
        AgentObservabilityService.resolve_source_filter("workflow:app-2:incomplete")


def test_resolve_source_filters_accepts_multiple_structured_sources() -> None:
    filters = AgentObservabilityService.resolve_source_filters(("webapp:app-1", "workflow:app-2:workflow-1:v1:node-1"))

    assert [source_filter.kind for source_filter in filters] == ["webapp", "workflow"]
    assert filters[0].app_id == "app-1"
    assert filters[1].node_id == "node-1"
    assert AgentObservabilityService.resolve_source_filters(())[0].kind == "all"
    assert AgentObservabilityService.resolve_source_filters(("all", "webapp:app-1"))[0].kind == "all"


def test_statistics_all_source_includes_debugger_messages() -> None:
    source_filter = AgentObservabilityService.resolve_source_filter("all")

    scope_sql = AgentObservabilityService._statistics_webapp_message_scope_sql(source_filter)

    assert "m.app_id = :app_id" in scope_sql
    assert "m.invoke_from != :debugger" not in scope_sql


def test_statistics_explicit_source_filters_invoke_from() -> None:
    source_filter = AgentObservabilityService.resolve_source_filter("debugger")

    scope_sql = AgentObservabilityService._statistics_webapp_message_scope_sql(source_filter)

    assert "m.invoke_from = :source" in scope_sql


def test_statistics_workflow_app_source_covers_all_versions_and_nodes() -> None:
    source_filter = AgentObservabilityService.resolve_source_filter("workflow:app-2")

    scope_sql = AgentObservabilityService._statistics_workflow_binding_filters_sql(source_filter)

    assert "wanb.app_id = :source_app_id" in scope_sql
    assert "wanb.workflow_id = :workflow_id" not in scope_sql
    assert "wanb.workflow_version = :workflow_version" not in scope_sql
    assert "wanb.node_id = :node_id" not in scope_sql


def test_statistics_workflow_chat_context_only_uses_chat_runs() -> None:
    source_filter = AgentObservabilityService.resolve_source_filter("workflow:app-2")

    scope_sql = AgentObservabilityService._statistics_workflow_message_scope_sql(source_filter)

    assert "wr.id = m.workflow_run_id" in scope_sql
    assert "wr.type = :chat_workflow_type" in scope_sql


def test_workflow_metadata_numeric_sql_supports_postgresql_and_mysql(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, DB_TYPE="postgresql")

    postgres_sql = AgentObservabilityService._workflow_execution_metadata_numeric_sql(
        ("agent_log", "agent_backend", "usage", "total_tokens"), "BIGINT"
    )

    assert "CAST(wne.execution_metadata AS JSONB)" in postgres_sql
    assert "#>> '{agent_log,agent_backend,usage,total_tokens}'" in postgres_sql

    apply_config_overrides(monkeypatch, DB_TYPE="mysql")

    mysql_sql = AgentObservabilityService._workflow_execution_metadata_numeric_sql(("total_tokens",), "BIGINT")

    assert "JSON_EXTRACT(wne.execution_metadata, '$.total_tokens')" in mysql_sql
    assert " AS UNSIGNED)" in mysql_sql


def test_workflow_statistics_include_run_without_message(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    workflow_app = _app(app_id="workflow-app-1", name="Workflow App", mode=AppMode.WORKFLOW)
    sqlite_session.add_all([workflow_app, _workflow_run(), _node_execution(), _workflow_binding()])
    sqlite_session.commit()

    apply_config_overrides(monkeypatch, DB_TYPE="mysql")
    monkeypatch.setattr(observability_service_module, "convert_datetime_to_date", lambda field: f"DATE({field})")
    monkeypatch.setattr(
        AgentObservabilityService,
        "_workflow_execution_metadata_numeric_sql",
        staticmethod(
            lambda path, numeric_type: (
                f"CAST(json_extract(wne.execution_metadata, '$.{'.'.join(path)}') AS {numeric_type})"
            )
        ),
    )
    service = AgentObservabilityService(sqlite_session)

    payload = service.get_statistics_summary(
        app=_app(app_id="agent-app"),
        agent_id="agent-1",
        params=observability_service_module.AgentStatisticsQueryParams(source="workflow:workflow-app-1"),
    )

    assert payload["summary"]["total_messages"] == 1
    assert payload["summary"]["total_conversations"] == 1
    assert payload["summary"]["total_end_users"] == 1
    assert payload["summary"]["total_tokens"] == 454_064
    assert Decimal(payload["summary"]["total_price"]) == Decimal("2.323470")


def test_merge_daily_statistics_combines_webapp_and_workflow_rows() -> None:
    rows = [
        {
            "date": "2026-07-21",
            "message_count": 2,
            "conversation_count": 1,
            "end_user_count": 1,
            "token_count": 30,
            "total_price": Decimal("0.003"),
            "avg_latency": 1.5,
            "latency_sum": 3,
            "answer_tokens": 12,
            "like_count": 1,
        },
        {
            "date": "2026-07-21",
            "message_count": 1,
            "conversation_count": 1,
            "end_user_count": 1,
            "token_count": 20,
            "total_price": Decimal("0.002"),
            "avg_latency": 2,
            "latency_sum": 2,
            "answer_tokens": 8,
            "like_count": 0,
        },
    ]

    merged = AgentObservabilityService._merge_daily_statistics(rows)

    assert merged == [
        {
            "date": "2026-07-21",
            "message_count": 3,
            "conversation_count": 2,
            "end_user_count": 2,
            "token_count": 50,
            "total_price": Decimal("0.005"),
            "avg_latency": pytest.approx(5 / 3),
            "latency_sum": 5.0,
            "answer_tokens": 20,
            "like_count": 1,
        }
    ]


def test_apply_status_filter_accepts_multiple_statuses() -> None:
    stmt = select(Message)

    result = AgentObservabilityService._apply_status_filter(stmt, ("success", "failed", "paused"))

    assert isinstance(result, Select)
    assert len(result._where_criteria) == 1
    with pytest.raises(ValueError, match="Unsupported status"):
        AgentObservabilityService._apply_status_filter(select(Message), ("unknown",))


def test_list_logs_sorts_by_requested_field(monkeypatch: pytest.MonkeyPatch) -> None:
    service = AgentObservabilityService(session=None)
    app = _app()
    rows = [
        {"id": "old", "source": {"id": "webapp:app-1"}, "created_at": 10, "updated_at": 100},
        {"id": "new", "source": {"id": "webapp:app-1"}, "created_at": 20, "updated_at": 50},
    ]
    monkeypatch.setattr(service, "_list_webapp_conversation_logs", lambda **kwargs: rows)
    monkeypatch.setattr(service, "_list_workflow_conversation_logs", lambda **kwargs: [])

    payload = service.list_logs(
        app=app,
        agent_id="agent-1",
        params=AgentLogQueryParams(sources=("webapp:app-1",), sort_by="created_at", sort_order="asc"),
    )

    assert [item["id"] for item in payload["data"]] == ["old", "new"]


def test_list_log_messages_merges_deduplicates_and_sorts_sources(monkeypatch: pytest.MonkeyPatch) -> None:
    service = AgentObservabilityService(session=None)
    webapp_message = _message(message_id="shared")
    webapp_row = {"id": "shared", "created_at": 10, "updated_at": 30}
    workflow_rows = [
        {"id": "shared", "created_at": 10, "updated_at": 20},
        {"id": "workflow-only", "created_at": 20, "updated_at": 10},
    ]
    monkeypatch.setattr(service, "_list_webapp_messages", lambda **kwargs: [webapp_message])
    monkeypatch.setattr(service, "_list_message_feedbacks", lambda **kwargs: {})
    monkeypatch.setattr(service, "serialize_log_message", lambda message, feedbacks=(): webapp_row)
    monkeypatch.setattr(service, "_list_workflow_messages", lambda **kwargs: workflow_rows)

    payload = service.list_log_messages(
        app=_app(app_id="agent-app"),
        agent_id="agent-1",
        conversation_id="execution-1",
        params=AgentLogQueryParams(
            sources=("webapp:agent-app", "workflow:workflow-app"),
            sort_by="created_at",
            sort_order="asc",
        ),
    )

    assert payload == {
        "data": [workflow_rows[0], workflow_rows[1]],
        "page": 1,
        "limit": 20,
        "total": 2,
        "has_more": False,
    }


def test_list_webapp_conversation_logs_includes_feedback_rates(sqlite_session: Session) -> None:
    timestamp = datetime(2026, 7, 23, 7, 0, 19)
    app = _app(name="Agent WebApp")
    conversation = _conversation()
    conversation.name = "Feedback conversation"
    first_message = _message(created_at=timestamp)
    second_message = _message(message_id="message-2", created_at=timestamp)
    sqlite_session.add_all(
        [
            app,
            conversation,
            first_message,
            second_message,
            _feedback(message_id=first_message.id),
            _feedback(message_id=second_message.id, rating=FeedbackRating.DISLIKE),
            _feedback(message_id=first_message.id, source=FeedbackFromSource.ADMIN),
        ]
    )
    sqlite_session.commit()
    service = AgentObservabilityService(sqlite_session)

    rows = service._list_webapp_conversation_logs(
        app=app,
        params=AgentLogQueryParams(),
        source_filter=AgentObservabilityService.resolve_source_filter("webapp"),
    )

    assert rows[0]["user_rate"] == 0.5
    assert rows[0]["operation_rate"] == 1.0


def test_list_workflow_logs_uses_node_executions_without_messages(sqlite_session: Session) -> None:
    workflow_app = _app(app_id="workflow-app-1", name="Marketing Department", mode=AppMode.WORKFLOW)
    sqlite_session.add_all([workflow_app, _workflow_run(), _node_execution(), _workflow_binding()])
    sqlite_session.commit()
    service = AgentObservabilityService(sqlite_session)

    rows = service._list_workflow_conversation_logs(
        app=_app(app_id="agent-app"),
        agent_id="agent-1",
        params=AgentLogQueryParams(),
        source_filter=AgentObservabilityService.resolve_source_filter("workflow:workflow-app-1"),
    )

    assert rows[0]["id"] == "node-execution-1"
    assert rows[0]["source"]["app_name"] == "Marketing Department"


def test_list_workflow_messages_uses_node_execution_identity(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    node_execution = _node_execution()
    sqlite_session.add_all(
        [
            _app(app_id="workflow-app-1", name="Workflow App", mode=AppMode.WORKFLOW),
            _workflow_run(),
            node_execution,
            _workflow_binding(),
        ]
    )
    sqlite_session.commit()
    service = AgentObservabilityService(sqlite_session)
    serialized = {"id": "node-execution-1", "conversation_id": "node-execution-1"}
    monkeypatch.setattr(service, "serialize_workflow_node_message", lambda execution: serialized)

    rows = service._list_workflow_messages(
        app=_app(app_id="agent-app"),
        agent_id="agent-1",
        conversation_id="node-execution-1",
        params=AgentLogQueryParams(),
        source_filter=AgentObservabilityService.resolve_source_filter("workflow:workflow-app-1"),
    )

    assert rows == [serialized]


def test_apply_workflow_node_filters_supports_time_keyword_and_status() -> None:
    stmt = select(WorkflowNodeExecutionModel)
    params = AgentLogQueryParams(
        start=datetime(2026, 7, 1, tzinfo=UTC),
        end=datetime(2026, 8, 1, tzinfo=UTC),
        keyword="meeting_100%",
        statuses=("success",),
    )

    result = AgentObservabilityService._apply_workflow_node_filters(
        stmt,
        params=params,
        workflow_app=observability_service_module.App,
    )

    assert isinstance(result, Select)
    assert len(result._where_criteria) == 4


def test_apply_workflow_node_status_filter_supports_all_status_groups() -> None:
    stmt = select(WorkflowNodeExecutionModel)

    result = AgentObservabilityService._apply_workflow_node_status_filter(stmt, ("normal", "error", "paused"))

    assert isinstance(result, Select)
    assert len(result._where_criteria) == 1
    empty_stmt = select(WorkflowNodeExecutionModel)
    assert AgentObservabilityService._apply_workflow_node_status_filter(empty_stmt, ()) is empty_stmt
    assert empty_stmt._where_criteria == ()
    with pytest.raises(ValueError, match="Unsupported status"):
        AgentObservabilityService._apply_workflow_node_status_filter(select(WorkflowNodeExecutionModel), ("unknown",))


def test_source_serializers_return_structured_frontend_shape() -> None:
    app = _app()

    webapp_source = AgentObservabilityService._serialize_webapp_source(app)
    workflow_app_source = AgentObservabilityService._serialize_workflow_app_source(app=app)
    workflow_source = AgentObservabilityService._serialize_workflow_source(
        app=app,
        workflow_id="workflow-1",
        workflow_version="v1",
        node_id="node-1",
    )

    assert webapp_source == {
        "id": "webapp:app-1",
        "type": "webapp",
        "app_id": "app-1",
        "app_name": "Iris",
        "app_icon_type": "emoji",
        "app_icon": "robot",
        "app_icon_background": "#fff",
        "workflow_id": None,
        "workflow_version": None,
        "node_id": None,
    }
    assert workflow_app_source == {
        "id": "workflow:app-1",
        "type": "workflow",
        "app_id": "app-1",
        "app_name": "Iris",
        "app_icon_type": "emoji",
        "app_icon": "robot",
        "app_icon_background": "#fff",
        "workflow_id": None,
        "workflow_version": None,
        "node_id": None,
    }
    assert workflow_source["id"] == "workflow:app-1:workflow-1:v1:node-1"
    assert workflow_source["type"] == "workflow"
    assert workflow_source["workflow_id"] == "workflow-1"


def test_list_workflow_sources_deduplicates_versions_and_nodes_by_app(sqlite_session: Session) -> None:
    app_a = _app(app_id="app-a", name="Alpha", mode=AppMode.WORKFLOW)
    app_b = _app(app_id="app-b", name="Beta", mode=AppMode.WORKFLOW)
    sqlite_session.add_all(
        [
            app_a,
            app_b,
            _workflow_binding(app_id="app-a", node_id="node-a-1"),
            _workflow_binding(app_id="app-a", node_id="node-a-2"),
            _workflow_binding(app_id="app-b", node_id="node-b-1"),
        ]
    )
    sqlite_session.commit()
    service = AgentObservabilityService(sqlite_session)

    sources = service._list_workflow_sources(
        app=_app(app_id="agent-app"),
        agent_id="agent-1",
    )

    assert [source["id"] for source in sources] == ["workflow:app-a", "workflow:app-b"]


def test_serialize_log_message_returns_frontend_log_shape() -> None:
    created_at = datetime(2026, 6, 17, 1, 2, 3, tzinfo=UTC)
    updated_at = datetime(2026, 6, 17, 1, 3, 3, tzinfo=UTC)
    message = _message(created_at=created_at)
    message.updated_at = updated_at
    conversation = _conversation()
    feedbacks = [
        _feedback(),
        _feedback(
            rating=FeedbackRating.DISLIKE,
            content="Needs more detail",
            source=FeedbackFromSource.ADMIN,
        ),
    ]

    payload = AgentObservabilityService.serialize_log_message(message, conversation, feedbacks)

    assert payload == {
        "id": "message-1",
        "message_id": "message-1",
        "conversation_id": "conversation-1",
        "conversation_name": "Debug conversation",
        "query": "hello",
        "answer": "hi",
        "status": "success",
        "error": None,
        "source": "explore",
        "from_source": "console",
        "from_end_user_id": None,
        "from_account_id": "account-1",
        "feedback_enabled": True,
        "feedbacks": [
            {"rating": "like", "content": "Useful", "from_source": "user"},
            {"rating": "dislike", "content": "Needs more detail", "from_source": "admin"},
        ],
        "message_tokens": 3,
        "answer_tokens": 4,
        "total_tokens": 7,
        "total_price": "0.0001",
        "currency": "USD",
        "latency": 1.25,
        "created_at": int(created_at.timestamp()),
        "updated_at": int(updated_at.timestamp()),
    }


def test_serialize_workflow_node_message_returns_frontend_log_shape() -> None:
    created_at = datetime(2026, 7, 23, 7, 0, 19, tzinfo=UTC)
    finished_at = datetime(2026, 7, 23, 7, 0, 28, tzinfo=UTC)
    node_execution = _node_execution()
    node_execution.inputs = (
        '{"agent_backend_request":{"composition":{"layers":['
        '{"name":"workflow_node_job_prompt","config":{"user":"Summarize the meeting"}},'
        '{"name":"workflow_user_prompt","config":{"user":"Focus on action items"}}]}}}'
    )
    node_execution.outputs = '{"output":"Alice owns the follow-up."}'
    node_execution.execution_metadata = (
        '{"agent_log":{"agent_backend":{"usage":{"prompt_tokens":10,"completion_tokens":5,'
        '"total_tokens":15,"total_price":"0.0015","currency":"USD","latency":1.25}}}}'
    )
    node_execution.elapsed_time = 1.5
    node_execution.created_at = created_at
    node_execution.finished_at = finished_at

    payload = AgentObservabilityService.serialize_workflow_node_message(node_execution)

    assert payload == {
        "id": "node-execution-1",
        "message_id": "node-execution-1",
        "conversation_id": "node-execution-1",
        "query": "Summarize the meeting\n\nFocus on action items",
        "answer": "Alice owns the follow-up.",
        "status": "success",
        "error": None,
        "from_end_user_id": "end-user-1",
        "from_account_id": None,
        "feedback_enabled": False,
        "feedbacks": [],
        "message_tokens": 10,
        "answer_tokens": 5,
        "total_tokens": 15,
        "total_price": "0.0015",
        "currency": "USD",
        "latency": 1.25,
        "created_at": int(created_at.timestamp()),
        "updated_at": int(finished_at.timestamp()),
    }


def test_serialize_workflow_node_message_handles_sparse_runtime_data() -> None:
    created_at = datetime(2026, 7, 23, 7, 0, 19, tzinfo=UTC)
    node_execution = _node_execution(execution_id="node-execution-2", status=WorkflowNodeExecutionStatus.PAUSED)
    node_execution.title = "Fallback prompt"
    node_execution.inputs = json.dumps(
        {
            "agent_backend_request": {
                "composition": {
                    "layers": [
                        None,
                        {"name": "unrelated", "config": {"user": "ignored"}},
                        {"name": "workflow_user_prompt", "config": {"user": "  "}},
                    ]
                }
            }
        }
    )
    node_execution.outputs = json.dumps({"output": {"structured": True}})
    node_execution.execution_metadata = json.dumps(
        {
            "agent_log": {
                "agent_backend": {
                    "usage": {
                        "prompt_tokens": "2",
                        "completion_tokens": 3,
                    }
                }
            }
        }
    )
    node_execution.elapsed_time = 2
    node_execution.created_by_role = CreatorUserRole.ACCOUNT
    node_execution.created_by = "account-1"
    node_execution.created_at = created_at
    node_execution.finished_at = None

    payload = AgentObservabilityService.serialize_workflow_node_message(node_execution)

    assert payload["query"] == "Fallback prompt"
    assert payload["answer"] == '{"output": {"structured": true}}'
    assert payload["status"] == "paused"
    assert payload["from_end_user_id"] is None
    assert payload["from_account_id"] == "account-1"
    assert payload["total_tokens"] == 5
    assert payload["total_price"] == "0"
    assert payload["currency"] == ""
    assert payload["latency"] == 2.0
    assert payload["updated_at"] == int(created_at.timestamp())


def test_positive_feedback_rate_uses_rated_messages_as_denominator() -> None:
    assert AgentObservabilityService._positive_feedback_rate(like_count=2, total_count=4) == 0.5
    assert AgentObservabilityService._positive_feedback_rate(like_count=0, total_count=1) == 0
    assert AgentObservabilityService._positive_feedback_rate(like_count=None, total_count=0) is None


def test_list_message_feedbacks_groups_feedbacks_by_message(sqlite_session: Session) -> None:
    first_message = _message()
    second_message = _message(message_id="message-2")
    feedbacks = [
        _feedback(),
        _feedback(rating=FeedbackRating.DISLIKE),
        _feedback(message_id="message-2"),
    ]
    sqlite_session.add_all([_app(), _conversation(), first_message, second_message, *feedbacks])
    sqlite_session.commit()
    service = AgentObservabilityService(sqlite_session)

    grouped_feedbacks = service._list_message_feedbacks(
        app=_app(),
        messages=[first_message, second_message],
    )

    assert {feedback.id for feedback in grouped_feedbacks["message-1"]} == {
        feedbacks[0].id,
        feedbacks[1].id,
    }
    assert grouped_feedbacks["message-2"] == [feedbacks[2]]
    assert service._list_message_feedbacks(app=_app(), messages=[]) == {}


def test_list_conversation_feedback_rates_maps_user_and_admin_sources(sqlite_session: Session) -> None:
    messages = [_message(message_id=f"message-{index}") for index in range(1, 5)]
    feedbacks = [
        _feedback(message_id="message-1"),
        _feedback(message_id="message-2"),
        _feedback(message_id="message-3", rating=FeedbackRating.DISLIKE),
        _feedback(message_id="message-4", rating=FeedbackRating.DISLIKE),
        _feedback(message_id="message-1", source=FeedbackFromSource.ADMIN),
    ]
    sqlite_session.add_all([_app(), _conversation(), *messages, *feedbacks])
    sqlite_session.commit()
    service = AgentObservabilityService(sqlite_session)

    rates = service._list_conversation_feedback_rates(
        app=_app(),
        conversation_ids=["conversation-1"],
    )

    assert rates == {"conversation-1": {"user_rate": 0.5, "operation_rate": 1.0}}
    assert (
        service._list_conversation_feedback_rates(
            app=_app(),
            conversation_ids=[],
        )
        == {}
    )


def test_workflow_node_serialization_helpers_handle_invalid_values() -> None:
    assert AgentObservabilityService._json_mapping(None) == {}
    assert AgentObservabilityService._json_mapping("not-json") == {}
    assert AgentObservabilityService._json_mapping("[]") == {}
    assert AgentObservabilityService._mapping_value({"value": []}, "value") == {}
    assert AgentObservabilityService._int_value(None) == 0
    assert AgentObservabilityService._int_value("not-a-number") == 0
    assert (
        AgentObservabilityService._workflow_node_query(
            {"agent_backend_request": {"composition": {"layers": "invalid"}}}, fallback="fallback"
        )
        == "fallback"
    )
    assert AgentObservabilityService._workflow_node_answer({"output": 1, "text": "fallback text"}) == "fallback text"
    assert AgentObservabilityService._workflow_node_answer({}) == ""


def test_serialize_workflow_execution_log_uses_node_execution_identity() -> None:
    created_at = datetime(2026, 7, 23, 7, 0, 19, tzinfo=UTC)
    node_execution = _node_execution(status=WorkflowNodeExecutionStatus.FAILED)
    node_execution.created_by_role = CreatorUserRole.ACCOUNT
    node_execution.created_by = "account-1"
    node_execution.created_at = created_at

    payload = AgentObservabilityService._serialize_workflow_execution_log(
        node_execution_id=node_execution.id,
        title=node_execution.title,
        status=node_execution.status,
        created_by_role=node_execution.created_by_role,
        created_by=node_execution.created_by,
        created_at=node_execution.created_at,
        finished_at=node_execution.finished_at,
        source={"id": "workflow:app-1:workflow-1:v1:node-1"},
    )

    assert payload["id"] == "node-execution-1"
    assert payload["conversation_id"] == "node-execution-1"
    assert payload["message_count"] == 1
    assert payload["end_user_id"] is None
    assert payload["status"] == "failed"
    assert payload["unread"] is False


def test_build_charts_and_summary_match_monitoring_metrics() -> None:
    rows = [
        {
            "date": "2026-06-16",
            "message_count": 2,
            "conversation_count": 1,
            "end_user_count": 1,
            "token_count": 30,
            "total_price": Decimal("0.003"),
            "avg_latency": 1.5,
            "latency_sum": 3,
            "answer_tokens": 12,
            "like_count": 1,
        },
        {
            "date": "2026-06-17",
            "message_count": 1,
            "conversation_count": 1,
            "end_user_count": 1,
            "token_count": 20,
            "total_price": Decimal("0.002"),
            "avg_latency": 2,
            "latency_sum": 2,
            "answer_tokens": 8,
            "like_count": 1,
        },
    ]

    charts = AgentObservabilityService._build_charts(rows)
    summary = AgentObservabilityService._build_summary(rows)

    assert charts["token_usage"] == [
        {"date": "2026-06-16", "token_count": 30, "total_price": "0.003", "currency": "USD"},
        {"date": "2026-06-17", "token_count": 20, "total_price": "0.002", "currency": "USD"},
    ]
    assert charts["average_response_time"] == [
        {"date": "2026-06-16", "latency": 1500.0},
        {"date": "2026-06-17", "latency": 2000.0},
    ]
    assert summary == {
        "total_messages": 3,
        "total_conversations": 2,
        "total_end_users": 2,
        "total_tokens": 50,
        "total_price": "0.005",
        "currency": "USD",
        "average_session_interactions": 1.5,
        "average_response_time": 1666.6667,
        "tokens_per_second": 4.0,
        "user_satisfaction_rate": 66.67,
    }
