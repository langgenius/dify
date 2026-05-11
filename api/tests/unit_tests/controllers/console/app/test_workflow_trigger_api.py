from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

from controllers.console.app import workflow_trigger as workflow_trigger_module


def test_parser_models_validate():
    parser = workflow_trigger_module.Parser(node_id="node-1")
    enable_parser = workflow_trigger_module.ParserEnable(
        trigger_id="550e8400-e29b-41d4-a716-446655440000", enable_trigger=True
    )

    assert parser.node_id == "node-1"
    assert enable_parser.enable_trigger is True


def test_workflow_trigger_response_serializes_datetime():
    created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    trigger = SimpleNamespace(
        id="trigger-1",
        trigger_type="trigger-plugin",
        title="Trigger",
        node_id="node-1",
        provider_name="provider",
        icon="https://example.com/icon",
        status="enabled",
        created_at=created_at,
        updated_at=created_at,
    )

    payload = workflow_trigger_module.WorkflowTriggerResponse.model_validate(trigger, from_attributes=True).model_dump(
        mode="json"
    )
    assert payload["id"] == "trigger-1"
    assert payload["created_at"] == "2026-01-02T03:04:05Z"
    assert payload["updated_at"] == "2026-01-02T03:04:05Z"


def test_webhook_trigger_response_serializes_datetime():
    created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    webhook = {
        "id": "webhook-1",
        "webhook_id": "whk-1",
        "webhook_url": "https://example.com/hook",
        "webhook_debug_url": "https://example.com/hook/debug",
        "node_id": "node-1",
        "created_at": created_at,
    }

    payload = workflow_trigger_module.WebhookTriggerResponse.model_validate(webhook).model_dump(mode="json")
    assert payload["webhook_id"] == "whk-1"
    assert payload["created_at"] == "2026-01-02T03:04:05Z"
