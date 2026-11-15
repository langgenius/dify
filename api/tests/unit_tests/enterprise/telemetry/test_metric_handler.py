"""Unit tests for EnterpriseMetricHandler."""

import json
from collections.abc import Iterator
from unittest.mock import MagicMock, patch

import pytest

from enterprise.telemetry.contracts import TelemetryCase, TelemetryEnvelope
from enterprise.telemetry.entities import EnterpriseTelemetryCounter, EnterpriseTelemetryEvent
from enterprise.telemetry.metric_handler import EnterpriseMetricHandler


@pytest.fixture
def mock_redis() -> Iterator[MagicMock]:
    with patch("enterprise.telemetry.metric_handler.redis_client") as mock:
        yield mock


@pytest.fixture
def telemetry_sink() -> Iterator[tuple[MagicMock, MagicMock]]:
    """Capture the structured-log emitter and the counter exporter."""
    with (
        patch("extensions.ext_enterprise_telemetry.get_enterprise_exporter") as mock_get_exporter,
        patch("enterprise.telemetry.telemetry_log.emit_metric_only_event") as mock_emit,
    ):
        exporter = MagicMock()
        exporter.include_content = False
        mock_get_exporter.return_value = exporter
        yield mock_emit, exporter


def _make_envelope(
    case: TelemetryCase,
    payload: dict[str, object] | None = None,
    *,
    event_id: str = "test-event",
    tenant_id: str = "test-tenant",
    metadata: dict[str, object] | None = None,
) -> TelemetryEnvelope:
    return TelemetryEnvelope(
        case=case,
        tenant_id=tenant_id,
        event_id=event_id,
        payload=payload or {},
        metadata=metadata,
    )


def test_handle_app_created_emits_event_and_counter(
    mock_redis: MagicMock, telemetry_sink: tuple[MagicMock, MagicMock]
) -> None:
    emit, exporter = telemetry_sink
    mock_redis.set.return_value = True
    envelope = _make_envelope(
        TelemetryCase.APP_CREATED,
        {"app_id": "app-789", "mode": "chat"},
        event_id="event-456",
        tenant_id="tenant-123",
    )

    EnterpriseMetricHandler().handle(envelope)

    emit.assert_called_once()
    event = emit.call_args.kwargs
    assert event["event_name"] == EnterpriseTelemetryEvent.APP_CREATED
    assert event["tenant_id"] == "tenant-123"
    attributes = event["attributes"]
    assert attributes["dify.app_id"] == "app-789"
    assert attributes["dify.tenant_id"] == "tenant-123"
    assert attributes["dify.event.id"] == "event-456"
    assert attributes["dify.app.mode"] == "chat"
    assert "dify.app.created_at" in attributes

    exporter.increment_counter.assert_called_once()
    counter = exporter.increment_counter.call_args
    assert counter.args[0] == EnterpriseTelemetryCounter.APP_CREATED
    assert counter.args[1] == 1
    assert counter.args[2]["tenant_id"] == "tenant-123"
    assert counter.args[2]["app_id"] == "app-789"
    assert counter.args[2]["mode"] == "chat"


def test_handle_app_updated_emits_event_and_counter(
    mock_redis: MagicMock, telemetry_sink: tuple[MagicMock, MagicMock]
) -> None:
    emit, exporter = telemetry_sink
    mock_redis.set.return_value = True
    envelope = _make_envelope(
        TelemetryCase.APP_UPDATED,
        {"app_id": "app-789"},
        event_id="event-456",
        tenant_id="tenant-123",
    )

    EnterpriseMetricHandler().handle(envelope)

    emit.assert_called_once()
    event = emit.call_args.kwargs
    assert event["event_name"] == EnterpriseTelemetryEvent.APP_UPDATED
    assert event["tenant_id"] == "tenant-123"
    attributes = event["attributes"]
    assert attributes["dify.app_id"] == "app-789"
    assert attributes["dify.tenant_id"] == "tenant-123"
    assert attributes["dify.event.id"] == "event-456"
    assert "dify.app.updated_at" in attributes

    exporter.increment_counter.assert_called_once()
    counter = exporter.increment_counter.call_args
    assert counter.args[0] == EnterpriseTelemetryCounter.APP_UPDATED
    assert counter.args[1] == 1
    assert counter.args[2]["tenant_id"] == "tenant-123"
    assert counter.args[2]["app_id"] == "app-789"


def test_handle_app_deleted_emits_event_and_counter(
    mock_redis: MagicMock, telemetry_sink: tuple[MagicMock, MagicMock]
) -> None:
    emit, exporter = telemetry_sink
    mock_redis.set.return_value = True
    envelope = _make_envelope(
        TelemetryCase.APP_DELETED,
        {"app_id": "app-789"},
        event_id="event-456",
        tenant_id="tenant-123",
    )

    EnterpriseMetricHandler().handle(envelope)

    emit.assert_called_once()
    event = emit.call_args.kwargs
    assert event["event_name"] == EnterpriseTelemetryEvent.APP_DELETED
    assert event["tenant_id"] == "tenant-123"
    attributes = event["attributes"]
    assert attributes["dify.app_id"] == "app-789"
    assert attributes["dify.tenant_id"] == "tenant-123"
    assert attributes["dify.event.id"] == "event-456"
    assert "dify.app.deleted_at" in attributes

    exporter.increment_counter.assert_called_once()
    counter = exporter.increment_counter.call_args
    assert counter.args[0] == EnterpriseTelemetryCounter.APP_DELETED
    assert counter.args[1] == 1
    assert counter.args[2]["tenant_id"] == "tenant-123"
    assert counter.args[2]["app_id"] == "app-789"


def _feedback_payload() -> dict[str, object]:
    return {
        "message_id": "msg-001",
        "app_id": "app-789",
        "conversation_id": "conv-123",
        "from_end_user_id": "user-456",
        "from_account_id": None,
        "rating": "like",
        "from_source": "api",
        "content": "Great!",
    }


def test_handle_feedback_created_emits_event_with_content(
    mock_redis: MagicMock, telemetry_sink: tuple[MagicMock, MagicMock]
) -> None:
    emit, exporter = telemetry_sink
    exporter.include_content = True
    mock_redis.set.return_value = True
    envelope = _make_envelope(
        TelemetryCase.FEEDBACK_CREATED,
        _feedback_payload(),
        event_id="event-456",
        tenant_id="tenant-123",
    )

    EnterpriseMetricHandler().handle(envelope)

    emit.assert_called_once()
    event = emit.call_args.kwargs
    assert event["event_name"] == EnterpriseTelemetryEvent.FEEDBACK_CREATED
    assert event["tenant_id"] == "tenant-123"
    assert event["user_id"] == "user-456"
    assert event["attributes"]["dify.message.id"] == "msg-001"
    assert event["attributes"]["dify.feedback.content"] == "Great!"
    assert event["attributes"]["dify.feedback.rating"] == "like"
    assert "dify.feedback.created_at" in event["attributes"]

    exporter.increment_counter.assert_called_once()
    counter = exporter.increment_counter.call_args
    assert counter.args[0] == EnterpriseTelemetryCounter.FEEDBACK
    assert counter.args[1] == 1
    assert counter.args[2]["tenant_id"] == "tenant-123"
    assert counter.args[2]["app_id"] == "app-789"
    assert counter.args[2]["rating"] == "like"


def test_handle_feedback_created_omits_content_when_disabled(
    mock_redis: MagicMock, telemetry_sink: tuple[MagicMock, MagicMock]
) -> None:
    emit, exporter = telemetry_sink
    exporter.include_content = False
    mock_redis.set.return_value = True
    envelope = _make_envelope(
        TelemetryCase.FEEDBACK_CREATED,
        _feedback_payload(),
        event_id="event-456",
        tenant_id="tenant-123",
    )

    EnterpriseMetricHandler().handle(envelope)

    emit.assert_called_once()
    assert "dify.feedback.content" not in emit.call_args.kwargs["attributes"]


def test_handle_skips_duplicate_event(mock_redis: MagicMock, telemetry_sink: tuple[MagicMock, MagicMock]) -> None:
    emit, exporter = telemetry_sink
    mock_redis.set.side_effect = [True, None]
    handler = EnterpriseMetricHandler()
    envelope = _make_envelope(TelemetryCase.APP_CREATED, {"app_id": "app-123", "mode": "chat"})

    handler.handle(envelope)
    handler.handle(envelope)

    emit.assert_called_once()
    exporter.increment_counter.assert_called_once()


def test_handle_processes_event_when_dedup_backend_is_unavailable(
    mock_redis: MagicMock,
    telemetry_sink: tuple[MagicMock, MagicMock],
    caplog: pytest.LogCaptureFixture,
) -> None:
    emit, _ = telemetry_sink
    mock_redis.set.side_effect = Exception("Redis unavailable")
    envelope = _make_envelope(TelemetryCase.APP_CREATED, {"app_id": "app-123", "mode": "chat"})

    EnterpriseMetricHandler().handle(envelope)

    emit.assert_called_once()
    assert "Redis unavailable for deduplication check" in caplog.text


def test_handle_rehydrates_payload_from_object_storage(
    mock_redis: MagicMock, telemetry_sink: tuple[MagicMock, MagicMock]
) -> None:
    emit, _ = telemetry_sink
    mock_redis.set.return_value = True
    envelope = _make_envelope(
        TelemetryCase.APP_CREATED,
        metadata={"payload_ref": "telemetry/test-tenant/test-event.json"},
    )

    with patch("enterprise.telemetry.metric_handler.storage") as mock_storage:
        mock_storage.load.return_value = json.dumps({"app_id": "app-stored", "mode": "workflow"}).encode("utf-8")
        EnterpriseMetricHandler().handle(envelope)

    attributes = emit.call_args.kwargs["attributes"]
    assert attributes["dify.app_id"] == "app-stored"
    assert attributes["dify.app.mode"] == "workflow"


def test_handle_emits_degraded_event_when_storage_fails(
    mock_redis: MagicMock, telemetry_sink: tuple[MagicMock, MagicMock]
) -> None:
    emit, _ = telemetry_sink
    mock_redis.set.return_value = True
    envelope = _make_envelope(
        TelemetryCase.APP_CREATED,
        metadata={"payload_ref": "telemetry/test-tenant/test-event.json"},
    )

    with patch("enterprise.telemetry.metric_handler.storage") as mock_storage:
        mock_storage.load.side_effect = Exception("Storage unavailable")
        EnterpriseMetricHandler().handle(envelope)

    emit.assert_called_once()
    event = emit.call_args.kwargs
    assert event["event_name"] == EnterpriseTelemetryEvent.REHYDRATION_FAILED
    assert "dify.telemetry.error" in event["attributes"]


def test_handle_emits_degraded_event_when_payload_is_empty(
    mock_redis: MagicMock, telemetry_sink: tuple[MagicMock, MagicMock]
) -> None:
    emit, _ = telemetry_sink
    mock_redis.set.return_value = True
    envelope = _make_envelope(TelemetryCase.APP_CREATED)

    EnterpriseMetricHandler().handle(envelope)

    emit.assert_called_once()
    event = emit.call_args.kwargs
    assert event["event_name"] == EnterpriseTelemetryEvent.REHYDRATION_FAILED
    assert "dify.telemetry.error" in event["attributes"]


@pytest.mark.parametrize("case", list(TelemetryCase))
def test_handle_accepts_every_known_case(
    case: TelemetryCase, mock_redis: MagicMock, telemetry_sink: tuple[MagicMock, MagicMock]
) -> None:
    emit, _ = telemetry_sink
    mock_redis.set.return_value = True

    EnterpriseMetricHandler().handle(_make_envelope(case, {"app_id": "app-1", "mode": "chat"}))

    assert emit.call_count <= 1
