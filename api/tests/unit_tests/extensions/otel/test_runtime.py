from unittest import mock

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider

from core.logging.context import clear_request_context


@pytest.fixture(autouse=True)
def _reset_logging_context():
    clear_request_context()
    yield
    clear_request_context()


def test_on_user_loaded_does_not_write_to_non_recording_span() -> None:
    from extensions.otel import runtime

    span = mock.MagicMock()
    span.is_recording.return_value = False
    user = mock.Mock(id="user-id")

    with (
        mock.patch.object(runtime.dify_config, "ENABLE_OTEL", True),
        mock.patch("opentelemetry.trace.get_current_span", return_value=span),
        mock.patch.object(runtime, "extract_tenant_id", return_value="tenant-id"),
    ):
        runtime.on_user_loaded(None, user)

    span.is_recording.assert_called_once_with()
    span.set_attribute.assert_not_called()
    span.set_attributes.assert_not_called()


def test_on_user_loaded_sets_attributes_on_recording_span() -> None:
    from extensions.otel import runtime
    from extensions.otel.semconv import DifySpanAttributes, GenAIAttributes

    span = mock.MagicMock()
    span.is_recording.return_value = True
    user = mock.Mock(id="user-id")

    with (
        mock.patch.object(runtime.dify_config, "ENABLE_OTEL", True),
        mock.patch("opentelemetry.trace.get_current_span", return_value=span),
        mock.patch.object(runtime, "extract_tenant_id", return_value="tenant-id"),
    ):
        runtime.on_user_loaded(None, user)

    span.set_attributes.assert_called_once_with(
        {
            DifySpanAttributes.TENANT_ID: "tenant-id",
            GenAIAttributes.USER_ID: "user-id",
        }
    )


def test_on_user_loaded_ignores_ended_sdk_span(caplog) -> None:
    from extensions.otel import runtime

    tracer_provider = TracerProvider()
    span = tracer_provider.get_tracer(__name__).start_span("ended")
    span.end()
    user = mock.Mock(id="user-id")

    with (
        trace.use_span(span, end_on_exit=False),
        mock.patch.object(runtime.dify_config, "ENABLE_OTEL", True),
        mock.patch.object(runtime, "extract_tenant_id", return_value="tenant-id"),
        caplog.at_level("WARNING", logger="opentelemetry.sdk.trace"),
    ):
        runtime.on_user_loaded(None, user)

    assert "Setting attribute on ended span" not in caplog.text
