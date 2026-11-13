"""Malformed outbox payloads fail before cleanup is dispatched."""

from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from models.app_deletion_outbox import AppDeletionOutbox
from repositories.app_deletion_outbox_repository import (
    AppDeletionOutboxRepository,
    _decode_deletion,
    _require_object,
)


def _valid_payload() -> dict[str, object]:
    return {
        "app": {"id": "app-id", "tenant_id": "tenant-id", "mode": "workflow"},
        "workflow_agent_ids": [],
        "workspace_ids": [],
        "binding_ids": [],
        "home_snapshot_ids": [],
        "backing_agent_id": None,
    }


@pytest.mark.parametrize("value", [None, "not an object", []])
def test_require_object_rejects_non_object_values(value: object) -> None:
    with pytest.raises(ValueError, match="Invalid App deletion outbox field: app"):
        _require_object(value, field="app")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("app.id", None),
        ("app.tenant_id", None),
        ("app.mode", None),
        ("workflow_agent_ids", None),
        ("workspace_ids", None),
        ("binding_ids", None),
        ("home_snapshot_ids", None),
        ("backing_agent_id", 42),
    ],
)
def test_decode_deletion_rejects_invalid_fields(field: str, value: object) -> None:
    payload = _valid_payload()
    if field.startswith("app."):
        app = payload["app"]
        assert isinstance(app, dict)
        app[field.removeprefix("app.")] = value
    else:
        payload[field] = value

    with pytest.raises(ValueError, match="Invalid App deletion outbox field:"):
        _decode_deletion(payload)


@pytest.mark.parametrize("field", ["workflow_agent_ids", "workspace_ids", "binding_ids", "home_snapshot_ids"])
def test_decode_deletion_rejects_non_string_list_items(field: str) -> None:
    payload = _valid_payload()
    payload[field] = ["valid-id", None]

    with pytest.raises(ValueError, match=f"Invalid App deletion outbox field: {field}"):
        _decode_deletion(payload)


def test_mark_succeeded_returns_false_for_a_missing_outbox_row() -> None:
    engine = create_engine("sqlite://")
    try:
        AppDeletionOutbox.__table__.create(engine)
        with Session(engine) as session:
            repository = AppDeletionOutboxRepository(session)

            assert (
                repository.mark_succeeded(
                    outbox_id="missing-outbox-row",
                    lease_owner="worker-1",
                    completed_at=datetime(2026, 1, 1),
                )
                is False
            )
    finally:
        engine.dispose()
