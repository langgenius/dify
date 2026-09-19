"""Real SQL coverage for Agent statistics inside a Workflow Tool invocation."""

import json
from datetime import datetime
from decimal import Decimal
from sqlite3 import Connection

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.workflow.node_execution_process_data import WORKFLOW_AGENT_BINDING_ID_KEY
from models.enums import ConversationFromSource, InvokeFrom
from models.model import App, AppMode, Message
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom, WorkflowRun, WorkflowType
from services.agent import observability_service as observability_service_module
from services.agent.observability_service import AgentObservabilityService, AgentStatisticsQueryParams
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.services.agent.test_agent_observability_service import (
    _app,
    _conversation,
    _message,
    _node_execution,
    _workflow_binding,
    _workflow_run,
)


@pytest.fixture
def statistics_service(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> AgentObservabilityService:
    # Keep the production joins/aggregation; adapt only MySQL functions to SQLite.
    apply_config_overrides(monkeypatch, DB_TYPE="mysql")
    monkeypatch.setattr(observability_service_module, "convert_datetime_to_date", lambda field: f"DATE({field})")
    connection = sqlite_session.connection().connection.dbapi_connection
    assert isinstance(connection, Connection)
    connection.create_function("JSON_UNQUOTE", 1, lambda value: value)
    return AgentObservabilityService(sqlite_session)


def _seed_nested_agent(sqlite_session: Session, *, workflow_type: WorkflowType) -> App:
    agent_app = _app(app_id="agent-app")
    outer_app = _app(
        app_id="outer-app", mode=AppMode.ADVANCED_CHAT if workflow_type == WorkflowType.CHAT else AppMode.WORKFLOW
    )
    source_app = _app(app_id="source-app", mode=AppMode.WORKFLOW)
    run = _workflow_run(workflow_type=workflow_type)
    run.app_id = outer_app.id
    run.workflow_id = "outer-workflow"
    run.version = "outer-v1"
    source_binding = _workflow_binding(app_id=source_app.id, binding_id="source-binding-v1", node_id="agent-node")
    source_binding.workflow_id = "source-workflow"
    source_binding.workflow_version = "source-v1"
    unused_binding = _workflow_binding(app_id=source_app.id, binding_id="source-binding-v2", node_id="agent-node")
    unused_binding.workflow_id = source_binding.workflow_id
    unused_binding.workflow_version = "source-v2"
    outer_binding = _workflow_binding(app_id=outer_app.id, node_id="agent-node")
    outer_binding.workflow_id = run.workflow_id
    outer_binding.workflow_version = run.version
    other_agent_binding = _workflow_binding(app_id=source_app.id, node_id="other-agent-node")
    other_agent_binding.workflow_id = source_binding.workflow_id
    other_agent_binding.workflow_version = source_binding.workflow_version
    other_agent_binding.agent_id = "other-agent"
    sqlite_session.add_all(
        [agent_app, outer_app, source_app, run, source_binding, unused_binding, outer_binding, other_agent_binding]
    )

    for index, (binding, tokens, completion_tokens, price, latency) in enumerate(
        [
            (source_binding, 7, 2, "0.01", 2.0),
            (source_binding, 11, 4, "0.02", 3.0),
            (other_agent_binding, 900, 800, "9.00", 90.0),
        ]
    ):
        execution = _node_execution(execution_id=f"tool-agent-execution-{index}")
        execution.app_id = source_app.id
        execution.workflow_id = source_binding.workflow_id
        execution.node_id = binding.node_id
        execution.triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
        execution.process_data = json.dumps({WORKFLOW_AGENT_BINDING_ID_KEY: binding.id})
        execution.elapsed_time = latency
        execution.execution_metadata = json.dumps(
            {
                "agent_log": {
                    "agent_backend": {
                        "usage": {"total_tokens": tokens, "completion_tokens": completion_tokens, "total_price": price}
                    }
                }
            }
        )
        sqlite_session.add(execution)

    if workflow_type == WorkflowType.CHAT:
        conversation = _conversation(app_id=outer_app.id)
        conversation.mode = AppMode.ADVANCED_CHAT
        conversation.from_source = ConversationFromSource.API
        message = _message(app_id=outer_app.id, created_at=datetime(2026, 7, 22, 8, 0))
        message.workflow_run_id = run.id
        message.from_source = ConversationFromSource.API
        message.invoke_from = InvokeFrom.WEB_APP
        message.from_account_id = None
        message.from_end_user_id = "end-user-1"
        sqlite_session.add_all([conversation, message])
    sqlite_session.commit()
    return agent_app


@pytest.mark.parametrize("workflow_type", [WorkflowType.WORKFLOW, WorkflowType.CHAT])
def test_nested_agent_daily_statistics_preserve_source_usage_and_date(
    sqlite_session: Session, statistics_service: AgentObservabilityService, workflow_type: WorkflowType
) -> None:
    app = _seed_nested_agent(sqlite_session, workflow_type=workflow_type)
    # Workflow metrics remain grouped by the outer run's date; Chatflow metrics
    # retain the original message's date and usage. Child nodes executed July 23.
    day = 22 if workflow_type == WorkflowType.CHAT else 21
    date = f"2026-07-{day}"
    expected_tokens = 7 if workflow_type == WorkflowType.CHAT else 18
    expected_price = Decimal("0.0001") if workflow_type == WorkflowType.CHAT else Decimal("0.03")
    expected_latency_ms = 1250.0 if workflow_type == WorkflowType.CHAT else 5000.0
    expected_tps = 3.2 if workflow_type == WorkflowType.CHAT else 1.2

    for source in ("workflow:source-app", "workflow:source-app:source-workflow:source-v1:agent-node", "workflow"):
        payload = statistics_service.get_statistics_summary(
            app=app,
            agent_id="agent-1",
            params=AgentStatisticsQueryParams(
                source=source,
                start=datetime(2026, 7, day),
                end=datetime(2026, 7, day + 1),
            ),
        )

        summary = payload["summary"]
        assert summary["total_messages"] == 1
        assert summary["total_conversations"] == 1
        assert summary["total_end_users"] == 1
        assert summary["total_tokens"] == expected_tokens
        assert Decimal(summary["total_price"]) == expected_price
        assert summary["average_response_time"] == expected_latency_ms
        assert summary["tokens_per_second"] == expected_tps
        assert payload["charts"]["daily_messages"] == [{"date": date, "message_count": 1}]
        assert payload["charts"]["average_response_time"] == [{"date": date, "latency": expected_latency_ms}]

    for unrelated_source in (
        "workflow:outer-app",
        "workflow:source-app:source-workflow:source-v2:agent-node",
        "workflow:source-app:source-workflow:source-v1:other-agent-node",
    ):
        payload = statistics_service.get_statistics_summary(
            app=app, agent_id="agent-1", params=AgentStatisticsQueryParams(source=unrelated_source)
        )
        assert payload["summary"]["total_messages"] == 0
        assert payload["summary"]["total_tokens"] == 0
        assert payload["charts"]["daily_messages"] == []


@pytest.mark.parametrize("workflow_type", [WorkflowType.WORKFLOW, WorkflowType.CHAT])
@pytest.mark.parametrize("invalid_owner", ["outer_tenant", "source_tenant", "node_app", "node_workflow", "binding_id"])
def test_nested_agent_statistics_reject_mismatched_ownership(
    sqlite_session: Session,
    statistics_service: AgentObservabilityService,
    workflow_type: WorkflowType,
    invalid_owner: str,
) -> None:
    app = _seed_nested_agent(sqlite_session, workflow_type=workflow_type)
    if invalid_owner == "outer_tenant":
        run = sqlite_session.get(WorkflowRun, "workflow-run-1")
        assert run is not None
        run.tenant_id = "other-tenant"
    elif invalid_owner == "source_tenant":
        source_app = sqlite_session.get(App, "source-app")
        assert source_app is not None
        source_app.tenant_id = "other-tenant"
    else:
        executions = sqlite_session.scalars(
            select(WorkflowNodeExecutionModel).where(
                WorkflowNodeExecutionModel.id.in_(["tool-agent-execution-0", "tool-agent-execution-1"])
            )
        ).all()
        assert len(executions) == 2
        for execution in executions:
            if invalid_owner == "node_app":
                execution.app_id = "other-app"
            elif invalid_owner == "node_workflow":
                execution.workflow_id = "other-workflow"
            else:
                execution.process_data = json.dumps(
                    {WORKFLOW_AGENT_BINDING_ID_KEY: "binding-source-app-other-agent-node"}
                )
    sqlite_session.commit()

    payload = statistics_service.get_statistics_summary(
        app=app, agent_id="agent-1", params=AgentStatisticsQueryParams(source="workflow:source-app")
    )

    assert payload["summary"]["total_messages"] == 0
    assert payload["summary"]["total_tokens"] == 0
    assert payload["charts"]["daily_messages"] == []


def test_nested_agent_chat_statistics_reject_message_from_another_app(
    sqlite_session: Session, statistics_service: AgentObservabilityService
) -> None:
    app = _seed_nested_agent(sqlite_session, workflow_type=WorkflowType.CHAT)
    message = sqlite_session.get(Message, "message-1")
    assert message is not None
    message.app_id = "other-app"
    sqlite_session.commit()

    payload = statistics_service.get_statistics_summary(
        app=app, agent_id="agent-1", params=AgentStatisticsQueryParams(source="workflow:source-app")
    )

    assert payload["summary"]["total_messages"] == 0
    assert payload["summary"]["total_tokens"] == 0
    assert payload["charts"]["daily_messages"] == []
