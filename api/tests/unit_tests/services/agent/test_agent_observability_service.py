import json
from datetime import UTC, datetime
from decimal import Decimal
from operator import itemgetter
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import Select, event, select
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.workflow.file_runtime import DifyWorkflowFileRuntime
from core.tools.signature import sign_tool_file
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from fields.agent_fields import AgentLogMessageItemResponse, AgentLogMessageListResponse
from fields.conversation_fields import AgentThought
from fields.conversation_fields import MessageFile as MessageFileResponse
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.file import FileTransferMethod, FileType
from graphon.file import helpers as file_helpers
from graphon.file.runtime import get_workflow_file_runtime
from libs.datetime_utils import naive_utc_now
from models.agent import WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.agent_config_entities import WorkflowNodeJobConfig
from models.enums import (
    ConversationFromSource,
    CreatorUserRole,
    ExecutionOffLoadType,
    FeedbackFromSource,
    FeedbackRating,
    MessageFileBelongsTo,
    MessageStatus,
)
from models.model import (
    App,
    AppMode,
    Conversation,
    Message,
    MessageAgentThought,
    MessageFeedback,
    MessageFile,
    UploadFile,
)
from models.tools import ToolFile
from models.workflow import (
    WorkflowExecutionStatus,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowRunTriggeredFrom,
    WorkflowType,
)
from services.agent import observability_service as observability_service_module
from services.agent.observability_service import AgentLogQueryParams, AgentObservabilityService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_app, make_conversation, make_message


def _app(*, app_id: str = "app-1", name: str = "Iris", mode: AppMode = AppMode.AGENT_CHAT) -> App:
    return make_app(app_id=app_id, name=name, mode=mode, icon_background="#fff", enable_site=False, enable_api=False)


def _conversation(*, conversation_id: str = "conversation-1", app_id: str = "app-1") -> Conversation:
    return make_conversation(
        conversation_id=conversation_id,
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
    return make_message(
        message_id=message_id,
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


def _workflow_thought(*, position: int, thought_id: str) -> dict[str, object]:
    return {
        "id": thought_id,
        "chain_id": "agent-run-1",
        "position": position,
        "created_at": int(datetime(2026, 7, 23, 7, 0, 19, tzinfo=UTC).timestamp()),
        "thought": "Look up the result",
        "answer": "Intermediate answer",
        "tool": "search",
        "tool_labels": {},
        "tool_input": '{"query":"hello"}',
        "observation": "https://files.example.com/files/tools/unowned.txt?timestamp=0&nonce=old&sign=old",
        "files": [],
    }


def _workflow_process_data() -> dict[str, list[dict[str, object]]]:
    # Equal positions must retain their stored order, not be sorted by ID.
    return {
        "agent_thoughts": [
            _workflow_thought(position=2, thought_id="thought-c"),
            _workflow_thought(position=1, thought_id="thought-b"),
            {**_workflow_thought(position=1, thought_id="thought-a"), "message_id": "untrusted-message"},
        ]
    }


def _process_data_offload(execution: WorkflowNodeExecutionModel) -> tuple[WorkflowNodeExecutionOffload, UploadFile]:
    file = UploadFile(
        tenant_id=execution.tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"offload/{execution.id}/process-data.json",
        name="process-data.json",
        size=4096,
        extension="json",
        mime_type="application/json",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=naive_utc_now(),
        used=True,
    )
    offload = WorkflowNodeExecutionOffload(
        tenant_id=execution.tenant_id,
        app_id=execution.app_id,
        node_execution_id=execution.id,
        type_=ExecutionOffLoadType.PROCESS_DATA,
        file_id=file.id,
    )
    return offload, file


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


@pytest.mark.parametrize(
    "sources",
    [
        ("webapp",),
        ("webapp", "webapp", "console"),
        ("webapp", "workflow", "workflow"),
        ("workflow", "webapp", "webapp"),
    ],
)
@pytest.mark.parametrize(
    ("page", "limit", "sort_by", "sort_order"),
    [
        (2, 1, "created_at", "asc"),
        (1, 4, "updated_at", "desc"),
        (2, 1, "updated_at", "asc"),
        (1, 1, "created_at", "desc"),
        (6, 1, "updated_at", "desc"),
    ],
)
def test_list_log_messages_loads_only_deduplicated_page_children(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    sources: tuple[str, ...],
    page: int,
    limit: int,
    sort_by: str,
    sort_order: str,
) -> None:
    apply_config_overrides(monkeypatch, SECRET_KEY="test-signing-key", FILES_URL="/api")
    app = _app()
    execution = _node_execution(execution_id="conversation-1")
    execution.created_at = datetime(2026, 7, 3)
    execution.finished_at = datetime(2026, 7, 1)
    execution.process_data = json.dumps(
        {"agent_thoughts": [_workflow_thought(position=1, thought_id="workflow-thought")]}
    )
    sqlite_session.add_all(
        [app, _conversation(), _app(app_id="workflow-app-1"), _workflow_run(), _workflow_binding(), execution]
    )
    uploads, tools = {}, {}
    for index, message_id in enumerate(["conversation-1", "message-1", "message-2", "message-3"]):
        message = _message(message_id=message_id, created_at=datetime(2026, 7, index + 1))
        message.updated_at = datetime(2026, 7, 4 - index)
        upload = _stored_file(message, transfer_method=FileTransferMethod.LOCAL_FILE)
        tool = _stored_file(message, transfer_method=FileTransferMethod.TOOL_FILE)
        uploads[message_id], tools[message_id] = upload.id, tool.id
        sqlite_session.add_all(
            [
                message,
                upload,
                tool,
                _message_file(message, transfer_method=FileTransferMethod.LOCAL_FILE, file_id=upload.id),
                _message_file(message, transfer_method=FileTransferMethod.TOOL_FILE, file_id=tool.id),
                _thought(message, position=1, thought_id=f"thought-{message_id}"),
                _feedback(message_id=message_id),
            ]
        )
    sqlite_session.commit()
    workflow_wins = sources[-1] == "workflow"
    if sort_by == "created_at":
        ordered_ids = ["message-1", "conversation-1", "message-2", "message-3"] if workflow_wins else list(uploads)
    else:
        ordered_ids = (
            ["conversation-1", "message-3", "message-2", "message-1"] if workflow_wins else list(reversed(uploads))
        )
    if sort_order == "desc":
        ordered_ids.reverse()
    page_ids = ordered_ids[(page - 1) * limit : page * limit]
    webapp_ids = [message_id for message_id in page_ids if not (workflow_wins and message_id == execution.id)]
    service = AgentObservabilityService(sqlite_session)
    runtime = get_workflow_file_runtime()
    assert isinstance(runtime, DifyWorkflowFileRuntime)
    statements = []

    def record_statement(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    engine = sqlite_session.get_bind()
    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with (
            patch.object(service, "_list_message_feedbacks", wraps=service._list_message_feedbacks) as feedbacks,
            patch.object(service, "_list_message_thoughts", wraps=service._list_message_thoughts) as thoughts,
            patch.object(service, "_list_message_files", wraps=service._list_message_files) as files,
            patch.object(service, "serialize_log_message", wraps=service.serialize_log_message) as serialize,
            patch.object(runtime, "resolve_upload_file_uri", wraps=runtime.resolve_upload_file_uri) as sign_upload,
            patch.object(runtime, "resolve_tool_file_uri", wraps=runtime.resolve_tool_file_uri) as sign_tool,
        ):
            payload = service.list_log_messages(
                app=app,
                agent_id="agent-1",
                conversation_id="conversation-1",
                params=AgentLogQueryParams(
                    page=page, limit=limit, sources=sources, sort_by=sort_by, sort_order=sort_order
                ),
            )
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)

    response = AgentLogMessageListResponse.model_validate(payload)
    assert [item.id for item in response.data] == page_ids
    assert (response.page, response.limit, response.total, response.has_more) == (page, limit, 4, page * limit < 4)
    assert [call.args[0].id for call in serialize.call_args_list] == webapp_ids
    for loader in (feedbacks, thoughts, files):
        loader.assert_called_once()
        assert [message.id for message in loader.call_args.kwargs["messages"]] == webapp_ids
    assert sorted(call.kwargs["upload_file_id"] for call in sign_upload.call_args_list) == sorted(
        uploads[id] for id in webapp_ids
    )
    assert sorted(call.kwargs["tool_file_id"] for call in sign_tool.call_args_list) == sorted(
        tools[id] for id in webapp_ids
    )
    assert len(statements) == len(sources) + sources.count("workflow") + (5 if webapp_ids else 0)
    for item in response.data:
        if item.id in webapp_ids:
            assert [thought.id for thought in item.agent_thoughts] == [f"thought-{item.id}"]
            assert len(item.message_files) == 2
            assert len(item.feedbacks) == 1
        else:
            assert not item.feedback_enabled
            assert [thought.id for thought in item.agent_thoughts] == ["workflow-thought"]
            assert item.message_files == item.feedbacks == []


def test_list_log_messages_merges_deduplicates_and_sorts_sources(monkeypatch: pytest.MonkeyPatch) -> None:
    service = AgentObservabilityService(session=None)
    webapp_message = _message(message_id="shared")
    workflow_rows = [
        {"id": "shared", "created_at": 10, "updated_at": 20},
        {"id": "workflow-only", "created_at": 20, "updated_at": 10},
    ]
    monkeypatch.setattr(service, "_list_webapp_messages", lambda **kwargs: [webapp_message])
    monkeypatch.setattr(service, "_list_workflow_messages", lambda **kwargs: workflow_rows)
    monkeypatch.setattr(service, "_list_message_feedbacks", lambda **kwargs: {})
    monkeypatch.setattr(service, "_list_message_thoughts", lambda **kwargs: {})
    monkeypatch.setattr(service, "_list_message_files", lambda **kwargs: {})

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

    # The workflow row wins the id collision, so no surviving page row carries a Message.
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


@pytest.mark.parametrize(
    ("app_mode", "workflow_type"),
    [(AppMode.WORKFLOW, WorkflowType.WORKFLOW), (AppMode.ADVANCED_CHAT, WorkflowType.CHAT)],
)
@pytest.mark.parametrize(
    ("status", "log_status"),
    [
        (WorkflowNodeExecutionStatus.SUCCEEDED, "success"),
        (WorkflowNodeExecutionStatus.FAILED, "failed"),
        (WorkflowNodeExecutionStatus.PAUSED, "paused"),
    ],
)
@pytest.mark.parametrize("offloaded", [False, True])
def test_list_workflow_messages_returns_persisted_process(
    sqlite_session: Session,
    app_mode: AppMode,
    workflow_type: WorkflowType,
    status: WorkflowNodeExecutionStatus,
    log_status: str,
    offloaded: bool,
) -> None:
    execution = _node_execution(status=status)
    process_data = _workflow_process_data()
    if status != WorkflowNodeExecutionStatus.SUCCEEDED:
        process_data["agent_thoughts"][0]["observation"] = ""
    stored_process = json.dumps(process_data)
    # The SQL preview is deliberately not parseable; only the offloaded JSON is authoritative.
    execution.process_data = '{"agent_thoughts":[{"id":"truncated' if offloaded else stored_process
    answer = "Normalized terminal output" if status == WorkflowNodeExecutionStatus.SUCCEEDED else ""
    execution.outputs = json.dumps({"output": answer})
    execution.error = "Tool failed" if status == WorkflowNodeExecutionStatus.FAILED else None
    original_outputs, original_metadata, original_process = (
        execution.outputs,
        execution.execution_metadata,
        execution.process_data,
    )
    sqlite_session.add_all(
        [
            _app(app_id="workflow-app-1", mode=app_mode),
            _workflow_run(workflow_type=workflow_type),
            execution,
            _workflow_binding(),
        ]
    )
    storage_contents = {}
    if offloaded:
        offload, file = _process_data_offload(execution)
        sqlite_session.add_all([offload, file])
        storage_contents[file.key] = stored_process.encode()
    sqlite_session.commit()
    sqlite_session.expunge_all()
    statements = []

    def record_statement(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    runtime = get_workflow_file_runtime()
    assert isinstance(runtime, DifyWorkflowFileRuntime)
    engine = sqlite_session.get_bind()
    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with (
            patch.object(storage, "load", side_effect=storage_contents.__getitem__) as load,
            patch.object(runtime, "resolve_upload_file_uri", wraps=runtime.resolve_upload_file_uri) as sign_upload,
            patch.object(runtime, "resolve_tool_file_uri", wraps=runtime.resolve_tool_file_uri) as sign_tool,
        ):
            payload = AgentObservabilityService(sqlite_session).list_log_messages(
                app=_app(app_id="agent-app"),
                agent_id="agent-1",
                conversation_id=execution.id,
                params=AgentLogQueryParams(sources=("workflow:workflow-app-1",), statuses=(log_status,)),
            )
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)

    response = AgentLogMessageListResponse.model_validate(payload)
    assert response.total == 1
    item = response.model_dump(mode="json")["data"][0]
    expected_thoughts = [
        {**thought, "message_id": execution.id}
        for thought in sorted(process_data["agent_thoughts"], key=itemgetter("position"))
    ]
    assert item["agent_thoughts"] == expected_thoughts
    assert [thought.id for thought in response.data[0].agent_thoughts] == ["thought-b", "thought-a", "thought-c"]
    assert isinstance(response.data[0].agent_thoughts[0], AgentThought)
    assert item["id"] == item["message_id"] == item["conversation_id"] == execution.id
    assert item["status"] == log_status
    assert item["error"] == execution.error
    assert item["query"] == "Agent"
    assert item["answer"] == answer
    assert item["feedback_enabled"] is False
    assert item["feedbacks"] == item["message_files"] == []
    assert (item["message_tokens"], item["answer_tokens"], item["total_tokens"]) == (451_938, 2_126, 454_064)
    assert (item["total_price"], item["currency"], item["latency"]) == ("2.323470", "USD", 59.93)
    sign_upload.assert_not_called()
    sign_tool.assert_not_called()
    if offloaded:
        load.assert_called_once_with(next(iter(storage_contents)))
    else:
        load.assert_not_called()
    # Owner lookup + batched offloads; offloading adds file preload + the model's full-content lookup.
    assert len(statements) == (4 if offloaded else 2)
    persisted = sqlite_session.get(WorkflowNodeExecutionModel, execution.id)
    assert persisted is not None
    assert (persisted.outputs, persisted.execution_metadata, persisted.process_data) == (
        original_outputs,
        original_metadata,
        original_process,
    )
    assert not sqlite_session.dirty


@pytest.mark.parametrize(
    ("app_mode", "workflow_type"),
    [(AppMode.WORKFLOW, WorkflowType.WORKFLOW), (AppMode.ADVANCED_CHAT, WorkflowType.CHAT)],
)
@pytest.mark.parametrize("process_data", [None, "{}", '{"usage":{"total_tokens":15}}'])
def test_list_workflow_messages_history_without_process(
    sqlite_session: Session, app_mode: AppMode, workflow_type: WorkflowType, process_data: str | None
) -> None:
    execution = _node_execution()
    execution.process_data = process_data
    execution.outputs = '{"output":"Historical answer"}'
    sqlite_session.add_all(
        [
            _app(app_id="workflow-app-1", mode=app_mode),
            _workflow_run(workflow_type=workflow_type),
            execution,
            _workflow_binding(),
        ]
    )
    sqlite_session.commit()
    sqlite_session.expunge_all()

    with patch.object(storage, "load") as load:
        payload = AgentObservabilityService(sqlite_session).list_log_messages(
            app=_app(app_id="agent-app"),
            agent_id="agent-1",
            conversation_id=execution.id,
            params=AgentLogQueryParams(sources=("workflow",)),
        )

    load.assert_not_called()
    assert payload["data"][0]["agent_thoughts"] == []
    assert payload["data"][0]["answer"] == "Historical answer"


@pytest.mark.parametrize(
    ("owner", "attribute"),
    [
        ("binding", "tenant_id"),
        ("binding", "agent_id"),
        ("binding", "app_id"),
        ("binding", "workflow_id"),
        ("binding", "workflow_version"),
        ("binding", "node_id"),
        ("execution", "tenant_id"),
        ("execution", "app_id"),
        ("execution", "workflow_id"),
        ("execution", "node_id"),
        ("execution", "workflow_run_id"),
        ("run", "app_id"),
        ("run", "workflow_id"),
        ("run", "version"),
    ],
)
def test_list_workflow_messages_process_respects_owner_chain(
    sqlite_session: Session, owner: str, attribute: str
) -> None:
    execution, binding, run = _node_execution(), _workflow_binding(), _workflow_run()
    execution.process_data = json.dumps(_workflow_process_data())
    setattr({"execution": execution, "binding": binding, "run": run}[owner], attribute, "other-owner")
    sqlite_session.add_all(
        [
            _app(app_id="workflow-app-1", mode=AppMode.WORKFLOW),
            run,
            binding,
            execution,
            *_process_data_offload(execution),
        ]
    )
    sqlite_session.commit()
    sqlite_session.expunge_all()

    with patch.object(storage, "load", side_effect=AssertionError("Unowned process must not be loaded")) as load:
        payload = AgentObservabilityService(sqlite_session).list_log_messages(
            app=_app(app_id="agent-app"),
            agent_id="agent-1",
            conversation_id=execution.id,
            params=AgentLogQueryParams(sources=("workflow",)),
        )

    assert payload["data"] == []
    assert payload["total"] == 0
    load.assert_not_called()


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
        "agent_thoughts": [],
        "message_files": [],
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
        "agent_thoughts": [],
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


@pytest.mark.parametrize("process_source", ["stored", "supplied", "empty"])
def test_serialize_workflow_node_message_uses_authoritative_process(
    sqlite_session: Session, process_source: str
) -> None:
    execution = _node_execution()
    process_data = _workflow_process_data()
    execution.process_data = json.dumps(process_data)
    if process_source == "supplied":
        execution.process_data = '{"agent_thoughts":[{"id":"truncated'
    # Metadata is not an alternate source of thoughts.
    execution.execution_metadata = json.dumps(process_data)
    sqlite_session.add(execution)
    sqlite_session.commit()
    sqlite_session.expunge_all()
    persisted = sqlite_session.get(WorkflowNodeExecutionModel, execution.id)
    assert persisted is not None

    if process_source == "stored":
        payload = AgentObservabilityService.serialize_workflow_node_message(persisted)
    else:
        payload = AgentObservabilityService.serialize_workflow_node_message(
            persisted, process_data={} if process_source == "empty" else process_data
        )

    assert payload["agent_thoughts"] == (
        []
        if process_source == "empty"
        else [
            {**thought, "message_id": execution.id}
            for thought in sorted(process_data["agent_thoughts"], key=itemgetter("position"))
        ]
    )
    assert json.loads(execution.execution_metadata) == process_data
    assert not sqlite_session.dirty


@pytest.mark.parametrize("workflow", [False, True])
def test_log_message_contract_defaults_to_empty_process(workflow: bool) -> None:
    payload = (
        AgentObservabilityService.serialize_workflow_node_message(_node_execution())
        if workflow
        else AgentObservabilityService.serialize_log_message(_message())
    )
    response = AgentLogMessageItemResponse.model_validate(payload)
    dumped = response.model_dump(mode="json")

    assert dumped["agent_thoughts"] == []
    assert dumped["message_files"] == []
    assert response.feedback_enabled is not workflow
    schema = AgentLogMessageItemResponse.model_json_schema(mode="serialization")
    assert schema["properties"]["agent_thoughts"]["items"] == {"$ref": "#/$defs/AgentThought"}
    assert schema["properties"]["message_files"]["items"] == {"$ref": "#/$defs/MessageFile"}


def _thought(message: Message, *, position: int, thought_id: str) -> MessageAgentThought:
    thought = MessageAgentThought(
        message_id=message.id,
        position=position,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        thought="Look up the result",
        answer="Intermediate answer",
        tool="search",
        tool_input='{"query":"hello"}',
        observation='{"result":"found"}',
        tool_labels_str='{"search":{"en_US":"Search"}}',
        message_chain_id="chain-1",
    )
    thought.id = thought_id
    thought.created_at = datetime(2026, 7, 23, 7, 0, 19)
    return thought


def _message_file(message: Message, *, transfer_method: FileTransferMethod, file_id: str) -> MessageFile:
    return MessageFile(
        message_id=message.id,
        type=FileType.DOCUMENT,
        transfer_method=transfer_method,
        upload_file_id=file_id,
        belongs_to=MessageFileBelongsTo.ASSISTANT,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )


def _stored_file(message: Message, *, transfer_method: FileTransferMethod) -> UploadFile | ToolFile:
    if transfer_method == FileTransferMethod.TOOL_FILE:
        return ToolFile(
            tenant_id="tenant-1",
            user_id="account-1",
            conversation_id=message.conversation_id,
            file_key="tools/result.txt",
            mimetype="text/plain",
            name="result.txt",
            size=24,
        )
    return UploadFile(
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key="upload_files/report.txt",
        name="report.txt",
        size=12,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=naive_utc_now(),
        used=True,
    )


@pytest.mark.parametrize("message_count", [1, 4])
@pytest.mark.parametrize("files_url", ["https://files.example.com", "", "/api"])
def test_list_log_messages_batches_process_and_signed_files(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, message_count: int, files_url: str
) -> None:
    app = _app()
    upload = UploadFile(
        tenant_id=app.tenant_id,
        storage_type=StorageType.LOCAL,
        key="upload_files/report.txt",
        name="report.txt",
        size=12,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=naive_utc_now(),
        used=True,
    )
    tool_file = ToolFile(
        tenant_id=app.tenant_id,
        user_id="account-1",
        conversation_id="conversation-1",
        file_key="tools/result.txt",
        mimetype="text/plain",
        name="result.txt",
        size=24,
    )
    sqlite_session.add_all([app, _conversation(), upload, tool_file])
    thought_ids_by_message = {}
    file_ids_by_message = {}
    for index in range(message_count):
        message = _message(message_id=f"message-{index}")
        files = [
            _message_file(message, transfer_method=FileTransferMethod.LOCAL_FILE, file_id=upload.id),
            _message_file(message, transfer_method=FileTransferMethod.TOOL_FILE, file_id=tool_file.id),
            _message_file(message, transfer_method=FileTransferMethod.REMOTE_URL, file_id=upload.id),
        ]
        # Deliberately insert out of order, including equal positions/timestamps.
        thoughts = [
            _thought(message, position=2, thought_id=f"thought-{index}-c"),
            _thought(message, position=1, thought_id=f"thought-{index}-b"),
            _thought(message, position=1, thought_id=f"thought-{index}-a"),
        ]
        thoughts[0].message_files = json.dumps([files[1].id])
        thought_ids_by_message[message.id] = sorted(thought.id for thought in thoughts)
        file_ids_by_message[message.id] = {file.id for file in files}
        sqlite_session.add_all(
            [
                message,
                *thoughts,
                *files,
                _feedback(message_id=message.id),
                _feedback(message_id=message.id, source=FeedbackFromSource.ADMIN),
            ]
        )
    sqlite_session.commit()
    sqlite_session.refresh(app)
    upload_id, tool_file_id = upload.id, tool_file.id
    apply_config_overrides(monkeypatch, SECRET_KEY="test-signing-key", FILES_URL=files_url)
    statements = []

    def record_statement(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    engine = sqlite_session.get_bind()
    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        payload = AgentObservabilityService(sqlite_session).list_log_messages(
            app=app,
            agent_id="agent-1",
            conversation_id="conversation-1",
            params=AgentLogQueryParams(sources=("webapp",)),
        )
        response = AgentLogMessageListResponse.model_validate(payload)
        dumped = response.model_dump(mode="json")
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)

    assert len(dumped["data"]) == message_count
    for item, dto in zip(dumped["data"], response.data):
        assert item["query"] == "hello"
        assert item["answer"] == "hi"
        assert [thought["id"] for thought in item["agent_thoughts"]] == thought_ids_by_message[item["id"]]
        assert isinstance(dto.agent_thoughts[0], AgentThought)
        assert isinstance(dto.message_files[0], MessageFileResponse)
        first = item["agent_thoughts"][0]
        assert first["thought"] == "Look up the result"
        assert first["answer"] == "Intermediate answer"
        assert first["tool"] == "search"
        assert first["tool_input"] == '{"query":"hello"}'
        assert first["observation"] == '{"result":"found"}'
        assert first["tool_labels"] == {"search": {"en_US": "Search"}}
        assert first["chain_id"] == "chain-1"
        assert first["created_at"] == int(datetime(2026, 7, 23, 7, 0, 19).timestamp())
        assert "message_chain_id" not in first
        assert len(item["agent_thoughts"][-1]["files"]) == 1
        assert {file["id"] for file in item["message_files"]} == file_ids_by_message[item["id"]]
        assert {urlsplit(file["url"]).path for file in item["message_files"]} == {
            f"{urlsplit(files_url).path}/files/{upload_id}/file-preview",
            f"{urlsplit(files_url).path}/files/tools/{tool_file_id}.txt",
        }
        for file in item["message_files"]:
            url = urlsplit(file["url"])
            assert url.netloc == urlsplit(files_url).netloc
            signature = {key: values[0] for key, values in parse_qs(url.query).items()}
            assert {"timestamp", "nonce", "sign"} <= signature.keys()
            if file["transfer_method"] != "tool_file":
                assert file_helpers.verify_file_signature(upload_file_id=upload_id, **signature)
        assert {file["filename"] for file in item["message_files"]} == {"report.txt", "result.txt"}
        assert {file["size"] for file in item["message_files"]} == {12, 24}
        assert all(file["belongs_to"] == "assistant" for file in item["message_files"])
        assert item["feedback_enabled"] is True
        assert {feedback["from_source"] for feedback in item["feedbacks"]} == {"user", "admin"}
    assert len(statements) == 6  # messages, feedbacks, thoughts, attachments, uploads, tool files
    assert all(statement.lstrip().upper().startswith("SELECT") for statement in statements)


@pytest.mark.parametrize("boundary", ["conversation", "app", "tenant", "broken_conversation_owner"])
def test_list_log_messages_process_respects_owner_chain(sqlite_session: Session, boundary: str) -> None:
    app = _app()
    foreign_app = _app(app_id="foreign-app")
    foreign_app.tenant_id = "foreign-tenant"
    conversation = _conversation()
    foreign_conversation = _conversation(conversation_id="foreign-conversation", app_id=foreign_app.id)
    message = _message()
    if boundary == "conversation":
        message.conversation_id = foreign_conversation.id
    elif boundary == "app":
        message.app_id = foreign_app.id
    elif boundary == "broken_conversation_owner":
        conversation.app_id = foreign_app.id
    else:
        app.tenant_id = "foreign-tenant"
    sqlite_session.add_all(
        [
            app,
            foreign_app,
            conversation,
            foreign_conversation,
            message,
            _thought(message, position=1, thought_id="secret-thought"),
            _message_file(message, transfer_method=FileTransferMethod.TOOL_FILE, file_id="secret-file"),
        ]
    )
    sqlite_session.commit()

    payload = AgentObservabilityService(sqlite_session).list_log_messages(
        app=_app(),
        agent_id="agent-1",
        conversation_id="conversation-1",
        params=AgentLogQueryParams(sources=("webapp",)),
    )

    assert payload["data"] == []
    assert payload["total"] == 0


def test_list_log_messages_history_without_process(sqlite_session: Session) -> None:
    app = _app()
    sqlite_session.add_all([app, _conversation(), _message(), _feedback()])
    sqlite_session.commit()

    payload = AgentObservabilityService(sqlite_session).list_log_messages(
        app=app,
        agent_id="agent-1",
        conversation_id="conversation-1",
        params=AgentLogQueryParams(sources=("webapp",)),
    )
    item = AgentLogMessageListResponse.model_validate(payload).model_dump(mode="json")["data"][0]

    assert item["agent_thoughts"] == []
    assert item["message_files"] == []
    assert item["feedbacks"] == [{"rating": "like", "content": "Useful", "from_source": "user"}]


@pytest.mark.parametrize("transfer_method", [FileTransferMethod.LOCAL_FILE, FileTransferMethod.TOOL_FILE])
@pytest.mark.parametrize("files_url", ["https://files.example.com/api", "", "/api"])
def test_log_message_answer_reuses_only_authorized_attachment_urls(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, transfer_method: FileTransferMethod, files_url: str
) -> None:
    apply_config_overrides(monkeypatch, SECRET_KEY="test-signing-key", FILES_URL=files_url)
    app, message = _app(), _message()
    record = _stored_file(message, transfer_method=transfer_method)
    resource = (
        f"/files/tools/{record.id}.txt"
        if transfer_method == FileTransferMethod.TOOL_FILE
        else f"/files/{record.id}/file-preview"
    )
    expired = "?timestamp=0&nonce=expired&sign=expired"
    urls = [f"https://internal.example.com{resource}{expired}", f"/api{resource}{expired}", f"{resource}{expired}"]
    unrelated = [
        f"https://files.example.com{resource}.extra{expired}",
        f"https://files.example.com{resource}/extra{expired}",
        f"https://example.com/redirect?url={urls[0]}",
        f"https://files.example.com/files/tools/unattached.txt{expired}",
        "https://[invalid/files/tools/malformed.txt",
    ]
    message.answer = (
        f"[result]({urls[0]})\n`{urls[1]}`\n{urls[2]}。请查收\n{urls[0]}，另见https://example.com/help\n"
        f"{urls[2]}, then " + "\n".join(unrelated)
    )
    remote = _message_file(message, transfer_method=FileTransferMethod.REMOTE_URL, file_id="unused")
    remote.upload_file_id = None
    remote.url = unrelated[3]
    sqlite_session.add_all(
        [
            app,
            _conversation(),
            message,
            record,
            _message_file(message, transfer_method=transfer_method, file_id=record.id),
            remote,
        ]
    )
    sqlite_session.commit()
    service = AgentObservabilityService(sqlite_session)
    files = service._list_message_files(app=app, messages=[message])[message.id]
    signed = next(file.url for file in files if file.upload_file_id == record.id)
    assert signed is not None
    expected = (
        f"[result]({signed})\n`{signed}`\n{signed}。请查收\n{signed}，另见https://example.com/help\n"
        f"{signed}, then " + "\n".join(unrelated)
    )

    with (
        patch("models.model.sign_tool_file", wraps=sign_tool_file) as sign_tool,
        patch.object(file_helpers, "get_signed_file_url", wraps=file_helpers.get_signed_file_url) as sign_upload,
        patch.object(sqlite_session, "execute", wraps=sqlite_session.execute) as execute,
    ):
        payload = service.serialize_log_message(message, message_files=files)

    sign_tool.assert_not_called()
    sign_upload.assert_not_called()
    execute.assert_not_called()
    assert payload["answer"] == expected
    assert all(url in payload["answer"] for url in unrelated)
    assert "nonce=expired" in message.answer
    assert not sqlite_session.dirty


def test_process_loaders_reject_unowned_or_mismatched_message_pairs(sqlite_session: Session) -> None:
    app = _app()
    other_app = _app(app_id="other-app")
    other_app.tenant_id = "other-tenant"
    message = _message()
    other_message = _message(message_id="other-message", conversation_id="other-conversation", app_id=other_app.id)
    attachments = []
    for owner in (message, other_message):
        attachment = _message_file(owner, transfer_method=FileTransferMethod.REMOTE_URL, file_id="unused")
        attachment.upload_file_id = None
        attachment.url = f"https://example.com/{owner.id}.txt"
        attachments.append(attachment)
    sqlite_session.add_all(
        [
            *attachments,
            app,
            other_app,
            _conversation(),
            _conversation(conversation_id="other-conversation", app_id=other_app.id),
            message,
            other_message,
            _thought(message, position=1, thought_id="allowed-thought"),
            _thought(other_message, position=1, thought_id="other-thought"),
        ]
    )
    sqlite_session.commit()
    service = AgentObservabilityService(sqlite_session)

    thoughts = service._list_message_thoughts(app=app, messages=[message, other_message])
    assert list(thoughts) == [message.id]
    assert [thought.id for thought in thoughts[message.id]] == ["allowed-thought"]
    files = service._list_message_files(app=app, messages=[message, other_message])
    assert list(files) == [message.id]
    assert [file.id for file in files[message.id]] == [attachments[0].id]
    mismatched = _message(conversation_id="other-conversation")
    assert service._list_message_thoughts(app=app, messages=[mismatched]) == {}
    assert service._list_message_files(app=app, messages=[mismatched]) == {}
    assert AgentObservabilityService(None)._list_message_thoughts(app=app, messages=[]) == {}
    assert AgentObservabilityService(None)._list_message_files(app=app, messages=[]) == {}


@pytest.mark.parametrize("transfer_method", [FileTransferMethod.LOCAL_FILE, FileTransferMethod.TOOL_FILE])
@pytest.mark.parametrize("scope", ["foreign-tenant", "raw-id", "unattached"])
def test_log_message_answer_never_signs_unowned_file_ids(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, transfer_method: FileTransferMethod, scope: str
) -> None:
    apply_config_overrides(monkeypatch, SECRET_KEY="test-signing-key", FILES_URL="https://files.example.com")
    app, message = _app(), _message()
    record = _stored_file(message, transfer_method=transfer_method)
    resource = (
        f"/files/tools/{record.id}.txt"
        if transfer_method == FileTransferMethod.TOOL_FILE
        else f"/files/{record.id}/file-preview"
    )
    message.answer = f"[secret](https://files.example.com{resource}?timestamp=0&nonce=expired&sign=expired)"
    if scope == "foreign-tenant":
        record.tenant_id = "other-tenant"
        sqlite_session.add(_message_file(message, transfer_method=transfer_method, file_id=record.id))
    if scope != "raw-id":
        sqlite_session.add(record)
    sqlite_session.add_all([app, _conversation(), message])
    sqlite_session.commit()

    with (
        patch("models.model.sign_tool_file", wraps=sign_tool_file) as sign_tool,
        patch.object(file_helpers, "get_signed_file_url", wraps=file_helpers.get_signed_file_url) as sign_upload,
    ):
        payload = AgentObservabilityService(sqlite_session).list_log_messages(
            app=app,
            agent_id="agent-1",
            conversation_id=message.conversation_id,
            params=AgentLogQueryParams(sources=("webapp",)),
        )

    sign_tool.assert_not_called()
    sign_upload.assert_not_called()
    assert payload["data"][0]["message_files"] == []
    assert payload["data"][0]["answer"] == message.answer


def test_log_files_support_legacy_tool_ids_and_url_only_attachments(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(monkeypatch, SECRET_KEY="test-signing-key", FILES_URL="https://files.example.com")
    app, message = _app(), _message()
    record = ToolFile(
        tenant_id=app.tenant_id,
        user_id="account-1",
        conversation_id=message.conversation_id,
        file_key="tools/result.txt",
        mimetype="text/plain",
        name="result.txt",
        size=24,
    )
    tool = _message_file(message, transfer_method=FileTransferMethod.TOOL_FILE, file_id=record.id)
    tool.upload_file_id = None
    tool.url = f"https://files.example.com/files/tools/{record.id}.txt"
    remote = _message_file(message, transfer_method=FileTransferMethod.REMOTE_URL, file_id="unused")
    remote.upload_file_id = None
    remote.url = "https://example.com/report%20one.txt"
    sqlite_session.add_all([app, _conversation(), message, record, tool, remote])
    sqlite_session.commit()

    files = AgentObservabilityService(sqlite_session)._list_message_files(app=app, messages=[message])[message.id]

    by_id = {file.id: file for file in files}
    assert urlsplit(by_id[tool.id].url).path == f"/files/tools/{record.id}.txt"
    assert by_id[tool.id].upload_file_id == record.id
    assert by_id[remote.id].url == remote.url
    assert by_id[remote.id].filename == "report one.txt"
    assert tool.upload_file_id is None
    assert not sqlite_session.dirty


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
