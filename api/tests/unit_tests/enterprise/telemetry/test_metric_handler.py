"""Unit tests for EnterpriseMetricHandler."""

from unittest.mock import MagicMock, patch

import pytest

from enterprise.telemetry.contracts import TelemetryCase, TelemetryEnvelope
from enterprise.telemetry.metric_handler import EnterpriseMetricHandler


@pytest.fixture
def mock_redis():
    with patch("enterprise.telemetry.metric_handler.redis_client") as mock:
        yield mock


@pytest.fixture
def sample_envelope():
    return TelemetryEnvelope(
        case=TelemetryCase.APP_CREATED,
        tenant_id="test-tenant",
        event_id="test-event-123",
        payload={"app_id": "app-123", "name": "Test App"},
    )


def test_dispatch_app_created(sample_envelope, mock_redis):
    mock_redis.set.return_value = True

    handler = EnterpriseMetricHandler()
    with patch.object(handler, "_on_app_created") as mock_handler:
        handler.handle(sample_envelope)
        mock_handler.assert_called_once_with(sample_envelope)


def test_dispatch_app_updated(mock_redis):
    mock_redis.set.return_value = True
    envelope = TelemetryEnvelope(
        case=TelemetryCase.APP_UPDATED,
        tenant_id="test-tenant",
        event_id="test-event-456",
        payload={},
    )

    handler = EnterpriseMetricHandler()
    with patch.object(handler, "_on_app_updated") as mock_handler:
        handler.handle(envelope)
        mock_handler.assert_called_once_with(envelope)


def test_dispatch_app_deleted(mock_redis):
    mock_redis.set.return_value = True
    envelope = TelemetryEnvelope(
        case=TelemetryCase.APP_DELETED,
        tenant_id="test-tenant",
        event_id="test-event-789",
        payload={},
    )

    handler = EnterpriseMetricHandler()
    with patch.object(handler, "_on_app_deleted") as mock_handler:
        handler.handle(envelope)
        mock_handler.assert_called_once_with(envelope)


def test_dispatch_feedback_created(mock_redis):
    mock_redis.set.return_value = True
    envelope = TelemetryEnvelope(
        case=TelemetryCase.FEEDBACK_CREATED,
        tenant_id="test-tenant",
        event_id="test-event-abc",
        payload={},
    )

    handler = EnterpriseMetricHandler()
    with patch.object(handler, "_on_feedback_created") as mock_handler:
        handler.handle(envelope)
        mock_handler.assert_called_once_with(envelope)


def test_dispatch_message_run(mock_redis):
    mock_redis.set.return_value = True
    envelope = TelemetryEnvelope(
        case=TelemetryCase.MESSAGE_RUN,
        tenant_id="test-tenant",
        event_id="test-event-msg",
        payload={},
    )

    handler = EnterpriseMetricHandler()
    with patch.object(handler, "_on_message_run") as mock_handler:
        handler.handle(envelope)
        mock_handler.assert_called_once_with(envelope)


def test_dispatch_tool_execution(mock_redis):
    mock_redis.set.return_value = True
    envelope = TelemetryEnvelope(
        case=TelemetryCase.TOOL_EXECUTION,
        tenant_id="test-tenant",
        event_id="test-event-tool",
        payload={},
    )

    handler = EnterpriseMetricHandler()
    with patch.object(handler, "_on_tool_execution") as mock_handler:
        handler.handle(envelope)
        mock_handler.assert_called_once_with(envelope)


def test_dispatch_moderation_check(mock_redis):
    mock_redis.set.return_value = True
    envelope = TelemetryEnvelope(
        case=TelemetryCase.MODERATION_CHECK,
        tenant_id="test-tenant",
        event_id="test-event-mod",
        payload={},
    )

    handler = EnterpriseMetricHandler()
    with patch.object(handler, "_on_moderation_check") as mock_handler:
        handler.handle(envelope)
        mock_handler.assert_called_once_with(envelope)


def test_dispatch_suggested_question(mock_redis):
    mock_redis.set.return_value = True
    envelope = TelemetryEnvelope(
        case=TelemetryCase.SUGGESTED_QUESTION,
        tenant_id="test-tenant",
        event_id="test-event-sq",
        payload={},
    )

    handler = EnterpriseMetricHandler()
    with patch.object(handler, "_on_suggested_question") as mock_handler:
        handler.handle(envelope)
        mock_handler.assert_called_once_with(envelope)


def test_dispatch_dataset_retrieval(mock_redis):
    mock_redis.set.return_value = True
    envelope = TelemetryEnvelope(
        case=TelemetryCase.DATASET_RETRIEVAL,
        tenant_id="test-tenant",
        event_id="test-event-ds",
        payload={},
    )

    handler = EnterpriseMetricHandler()
    with patch.object(handler, "_on_dataset_retrieval") as mock_handler:
        handler.handle(envelope)
        mock_handler.assert_called_once_with(envelope)


def test_dispatch_generate_name(mock_redis):
    mock_redis.set.return_value = True
    envelope = TelemetryEnvelope(
        case=TelemetryCase.GENERATE_NAME,
        tenant_id="test-tenant",
        event_id="test-event-gn",
        payload={},
    )

    handler = EnterpriseMetricHandler()
    with patch.object(handler, "_on_generate_name") as mock_handler:
        handler.handle(envelope)
        mock_handler.assert_called_once_with(envelope)


def test_dispatch_prompt_generation(mock_redis):
    mock_redis.set.return_value = True
    envelope = TelemetryEnvelope(
        case=TelemetryCase.PROMPT_GENERATION,
        tenant_id="test-tenant",
        event_id="test-event-pg",
        payload={},
    )

    handler = EnterpriseMetricHandler()
    with patch.object(handler, "_on_prompt_generation") as mock_handler:
        handler.handle(envelope)
        mock_handler.assert_called_once_with(envelope)


def test_all_known_cases_have_handlers(mock_redis):
    mock_redis.set.return_value = True
    handler = EnterpriseMetricHandler()

    for case in TelemetryCase:
        envelope = TelemetryEnvelope(
            case=case,
            tenant_id="test-tenant",
            event_id=f"test-{case.value}",
            payload={},
        )
        handler.handle(envelope)


def test_idempotency_duplicate(sample_envelope, mock_redis):
    mock_redis.set.return_value = None

    handler = EnterpriseMetricHandler()
    with patch.object(handler, "_on_app_created") as mock_handler:
        handler.handle(sample_envelope)
        mock_handler.assert_not_called()


def test_idempotency_first_seen(sample_envelope, mock_redis):
    mock_redis.set.return_value = True

    handler = EnterpriseMetricHandler()
    is_dup = handler._is_duplicate(sample_envelope)

    assert is_dup is False
    mock_redis.set.assert_called_once_with(
        "telemetry:dedup:test-tenant:test-event-123",
        b"1",
        nx=True,
        ex=3600,
    )


def test_idempotency_redis_failure_fails_open(sample_envelope, mock_redis, caplog):
    mock_redis.set.side_effect = Exception("Redis unavailable")

    handler = EnterpriseMetricHandler()
    is_dup = handler._is_duplicate(sample_envelope)

    assert is_dup is False
    assert "Redis unavailable for deduplication check" in caplog.text


def test_rehydration_uses_payload(sample_envelope):
    handler = EnterpriseMetricHandler()
    payload = handler._rehydrate(sample_envelope)

    assert payload == {"app_id": "app-123", "name": "Test App"}


def test_rehydration_fallback():
    import pickle

    fallback_data = {"fallback": "data"}
    envelope = TelemetryEnvelope(
        case=TelemetryCase.APP_CREATED,
        tenant_id="test-tenant",
        event_id="test-event-fb",
        payload={},
        payload_fallback=pickle.dumps(fallback_data),
    )

    handler = EnterpriseMetricHandler()
    payload = handler._rehydrate(envelope)

    assert payload == fallback_data


def test_rehydration_emits_degraded_event_on_failure():
    envelope = TelemetryEnvelope(
        case=TelemetryCase.APP_CREATED,
        tenant_id="test-tenant",
        event_id="test-event-fail",
        payload={},
        payload_fallback=None,
    )

    handler = EnterpriseMetricHandler()
    with patch("enterprise.telemetry.telemetry_log.emit_metric_only_event") as mock_emit:
        payload = handler._rehydrate(envelope)

        assert payload == {}
        mock_emit.assert_called_once()
        call_args = mock_emit.call_args
        assert call_args[1]["event_name"] == "dify.telemetry.rehydration_failed"
        assert call_args[1]["attributes"]["rehydration_failed"] is True


def test_on_app_created_emits_correct_event(mock_redis):
    mock_redis.set.return_value = True
    envelope = TelemetryEnvelope(
        case=TelemetryCase.APP_CREATED,
        tenant_id="tenant-123",
        event_id="event-456",
        payload={"app_id": "app-789", "mode": "chat"},
    )

    handler = EnterpriseMetricHandler()
    with (
        patch("extensions.ext_enterprise_telemetry.get_enterprise_exporter") as mock_get_exporter,
        patch("enterprise.telemetry.telemetry_log.emit_metric_only_event") as mock_emit,
    ):
        mock_exporter = MagicMock()
        mock_get_exporter.return_value = mock_exporter

        handler._on_app_created(envelope)

        mock_emit.assert_called_once_with(
            event_name="dify.app.created",
            attributes={
                "dify.app.id": "app-789",
                "dify.tenant_id": "tenant-123",
                "dify.app.mode": "chat",
            },
            tenant_id="tenant-123",
        )
        mock_exporter.increment_counter.assert_called_once()
        call_args = mock_exporter.increment_counter.call_args
        assert call_args[0][1] == 1
        assert call_args[0][2]["type"] == "app.created"
        assert call_args[0][2]["tenant_id"] == "tenant-123"


def test_on_app_updated_emits_correct_event(mock_redis):
    mock_redis.set.return_value = True
    envelope = TelemetryEnvelope(
        case=TelemetryCase.APP_UPDATED,
        tenant_id="tenant-123",
        event_id="event-456",
        payload={"app_id": "app-789"},
    )

    handler = EnterpriseMetricHandler()
    with (
        patch("extensions.ext_enterprise_telemetry.get_enterprise_exporter") as mock_get_exporter,
        patch("enterprise.telemetry.telemetry_log.emit_metric_only_event") as mock_emit,
    ):
        mock_exporter = MagicMock()
        mock_get_exporter.return_value = mock_exporter

        handler._on_app_updated(envelope)

        mock_emit.assert_called_once_with(
            event_name="dify.app.updated",
            attributes={
                "dify.app.id": "app-789",
                "dify.tenant_id": "tenant-123",
            },
            tenant_id="tenant-123",
        )
        mock_exporter.increment_counter.assert_called_once()
        call_args = mock_exporter.increment_counter.call_args
        assert call_args[0][2]["type"] == "app.updated"


def test_on_app_deleted_emits_correct_event(mock_redis):
    mock_redis.set.return_value = True
    envelope = TelemetryEnvelope(
        case=TelemetryCase.APP_DELETED,
        tenant_id="tenant-123",
        event_id="event-456",
        payload={"app_id": "app-789"},
    )

    handler = EnterpriseMetricHandler()
    with (
        patch("extensions.ext_enterprise_telemetry.get_enterprise_exporter") as mock_get_exporter,
        patch("enterprise.telemetry.telemetry_log.emit_metric_only_event") as mock_emit,
    ):
        mock_exporter = MagicMock()
        mock_get_exporter.return_value = mock_exporter

        handler._on_app_deleted(envelope)

        mock_emit.assert_called_once_with(
            event_name="dify.app.deleted",
            attributes={
                "dify.app.id": "app-789",
                "dify.tenant_id": "tenant-123",
            },
            tenant_id="tenant-123",
        )
        mock_exporter.increment_counter.assert_called_once()
        call_args = mock_exporter.increment_counter.call_args
        assert call_args[0][2]["type"] == "app.deleted"


def test_on_feedback_created_emits_correct_event(mock_redis):
    mock_redis.set.return_value = True
    envelope = TelemetryEnvelope(
        case=TelemetryCase.FEEDBACK_CREATED,
        tenant_id="tenant-123",
        event_id="event-456",
        payload={
            "message_id": "msg-001",
            "app_id": "app-789",
            "conversation_id": "conv-123",
            "from_end_user_id": "user-456",
            "from_account_id": None,
            "rating": "like",
            "from_source": "api",
            "content": "Great!",
        },
    )

    handler = EnterpriseMetricHandler()
    with (
        patch("extensions.ext_enterprise_telemetry.get_enterprise_exporter") as mock_get_exporter,
        patch("enterprise.telemetry.telemetry_log.emit_metric_only_event") as mock_emit,
    ):
        mock_exporter = MagicMock()
        mock_exporter.include_content = True
        mock_get_exporter.return_value = mock_exporter

        handler._on_feedback_created(envelope)

        mock_emit.assert_called_once()
        call_args = mock_emit.call_args
        assert call_args[1]["event_name"] == "dify.feedback.created"
        assert call_args[1]["attributes"]["dify.message.id"] == "msg-001"
        assert call_args[1]["attributes"]["dify.feedback.content"] == "Great!"
        assert call_args[1]["tenant_id"] == "tenant-123"
        assert call_args[1]["user_id"] == "user-456"

        mock_exporter.increment_counter.assert_called_once()
        counter_args = mock_exporter.increment_counter.call_args
        assert counter_args[0][2]["app_id"] == "app-789"
        assert counter_args[0][2]["rating"] == "like"


def test_on_feedback_created_without_content(mock_redis):
    mock_redis.set.return_value = True
    envelope = TelemetryEnvelope(
        case=TelemetryCase.FEEDBACK_CREATED,
        tenant_id="tenant-123",
        event_id="event-456",
        payload={
            "message_id": "msg-001",
            "app_id": "app-789",
            "conversation_id": "conv-123",
            "from_end_user_id": "user-456",
            "from_account_id": None,
            "rating": "like",
            "from_source": "api",
            "content": "Great!",
        },
    )

    handler = EnterpriseMetricHandler()
    with (
        patch("extensions.ext_enterprise_telemetry.get_enterprise_exporter") as mock_get_exporter,
        patch("enterprise.telemetry.telemetry_log.emit_metric_only_event") as mock_emit,
    ):
        mock_exporter = MagicMock()
        mock_exporter.include_content = False
        mock_get_exporter.return_value = mock_exporter

        handler._on_feedback_created(envelope)

        mock_emit.assert_called_once()
        call_args = mock_emit.call_args
        assert "dify.feedback.content" not in call_args[1]["attributes"]
