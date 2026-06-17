from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from models.enums import ConversationFromSource, MessageStatus
from services.agent.observability_service import AgentObservabilityService


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

    workflow_filter = AgentObservabilityService.resolve_source_filter("workflow:app-2:workflow-1:v1:node-1")
    assert workflow_filter.kind == "workflow"
    assert workflow_filter.app_id == "app-2"
    assert workflow_filter.workflow_id == "workflow-1"
    assert workflow_filter.workflow_version == "v1"
    assert workflow_filter.node_id == "node-1"

    legacy_filter = AgentObservabilityService.resolve_source_filter("console")
    assert legacy_filter.kind == "webapp"
    assert legacy_filter.invoke_from == InvokeFrom.EXPLORE

    with pytest.raises(ValueError, match="Unsupported source"):
        AgentObservabilityService.resolve_source_filter("workflow:broken")


def test_source_serializers_return_structured_frontend_shape() -> None:
    app = SimpleNamespace(
        id="app-1",
        name="Iris",
        icon_type=SimpleNamespace(value="emoji"),
        icon="robot",
        icon_background="#fff",
    )

    webapp_source = AgentObservabilityService._serialize_webapp_source(app)  # type: ignore[arg-type]
    workflow_source = AgentObservabilityService._serialize_workflow_source(
        app=app,  # type: ignore[arg-type]
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
    assert workflow_source["id"] == "workflow:app-1:workflow-1:v1:node-1"
    assert workflow_source["type"] == "workflow"
    assert workflow_source["workflow_id"] == "workflow-1"


def test_serialize_log_message_returns_frontend_log_shape() -> None:
    created_at = datetime(2026, 6, 17, 1, 2, 3, tzinfo=UTC)
    updated_at = datetime(2026, 6, 17, 1, 3, 3, tzinfo=UTC)
    message = SimpleNamespace(
        id="message-1",
        conversation_id="conversation-1",
        query="hello",
        answer="hi",
        error=None,
        status=MessageStatus.NORMAL,
        invoke_from=InvokeFrom.EXPLORE,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id=None,
        from_account_id="account-1",
        message_tokens=3,
        answer_tokens=4,
        total_price=Decimal("0.0001"),
        currency="USD",
        provider_response_latency=1.25,
        created_at=created_at,
        updated_at=updated_at,
    )
    conversation = SimpleNamespace(name="Debug conversation")

    payload = AgentObservabilityService.serialize_log_message(message, conversation)  # type: ignore[arg-type]

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
        "message_tokens": 3,
        "answer_tokens": 4,
        "total_tokens": 7,
        "total_price": "0.0001",
        "currency": "USD",
        "latency": 1.25,
        "created_at": int(created_at.timestamp()),
        "updated_at": int(updated_at.timestamp()),
    }


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
