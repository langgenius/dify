"""Tests for logging filters."""

import io
import logging
from unittest import mock

import pytest


@pytest.fixture
def log_record():
    return logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname="",
        lineno=0,
        msg="test",
        args=(),
        exc_info=None,
    )


@pytest.fixture(autouse=True)
def _reset_logging_context():
    from core.logging.context import clear_request_context

    clear_request_context()
    yield
    clear_request_context()


class TestTraceContextFilter:
    def test_sets_empty_trace_id_without_context(self, log_record):
        from core.logging.context import clear_request_context
        from core.logging.filters import TraceContextFilter

        # Ensure no context is set
        clear_request_context()

        filter = TraceContextFilter()
        result = filter.filter(log_record)

        assert result is True
        assert hasattr(log_record, "trace_id")
        assert hasattr(log_record, "span_id")
        assert hasattr(log_record, "req_id")
        # Without context, IDs should be empty
        assert log_record.trace_id == ""
        assert log_record.req_id == ""

    def test_sets_trace_id_from_context(self, log_record):
        """Test that trace_id and req_id are set from ContextVar when initialized."""
        from core.logging.context import init_request_context
        from core.logging.filters import TraceContextFilter

        # Initialize context (no Flask needed!)
        init_request_context()

        filter = TraceContextFilter()
        filter.filter(log_record)

        # With context initialized, IDs should be set
        assert log_record.trace_id != ""
        assert len(log_record.trace_id) == 32
        assert log_record.req_id != ""
        assert len(log_record.req_id) == 10

    def test_filter_always_returns_true(self, log_record):
        from core.logging.filters import TraceContextFilter

        filter = TraceContextFilter()
        result = filter.filter(log_record)
        assert result is True

    def test_sets_trace_id_from_otel_when_available(self, log_record):
        from core.logging.filters import TraceContextFilter

        mock_span = mock.MagicMock()
        mock_context = mock.MagicMock()
        mock_context.trace_id = 0x5B8AA5A2D2C872E8321CF37308D69DF2
        mock_context.span_id = 0x051581BF3BB55C45
        mock_span.get_span_context.return_value = mock_context

        with (
            mock.patch("opentelemetry.trace.get_current_span", return_value=mock_span, autospec=True),
            mock.patch("opentelemetry.trace.span.INVALID_TRACE_ID", 0),
            mock.patch("opentelemetry.trace.span.INVALID_SPAN_ID", 0),
        ):
            filter = TraceContextFilter()
            filter.filter(log_record)

            assert log_record.trace_id == "5b8aa5a2d2c872e8321cf37308d69df2"
            assert log_record.span_id == "051581bf3bb55c45"

    def test_otel_context_invalid_trace_id(self, log_record):
        from core.logging.filters import TraceContextFilter

        mock_span = mock.MagicMock()
        mock_context = mock.MagicMock()
        mock_context.trace_id = 0
        mock_context.is_valid = True
        mock_span.get_span_context.return_value = mock_context

        # Use mocks for base context to ensure we can test the fallback
        with (
            mock.patch("opentelemetry.trace.get_current_span", return_value=mock_span),
            mock.patch("opentelemetry.trace.span.INVALID_TRACE_ID", 0),
            mock.patch("core.logging.filters.get_trace_id", return_value=""),
        ):
            filter = TraceContextFilter()
            filter.filter(log_record)
            assert log_record.trace_id == ""

    def test_otel_context_invalid_span_id(self, log_record):
        from core.logging.filters import TraceContextFilter

        mock_span = mock.MagicMock()
        mock_context = mock.MagicMock()
        mock_context.trace_id = 0x5B8AA5A2D2C872E8321CF37308D69DF2
        mock_context.span_id = 0
        mock_context.is_valid = True
        mock_span.get_span_context.return_value = mock_context

        with (
            mock.patch("opentelemetry.trace.get_current_span", return_value=mock_span),
            mock.patch("opentelemetry.trace.span.INVALID_TRACE_ID", 0),
            mock.patch("opentelemetry.trace.span.INVALID_SPAN_ID", 0),
        ):
            filter = TraceContextFilter()
            filter.filter(log_record)
            assert log_record.trace_id == "5b8aa5a2d2c872e8321cf37308d69df2"
            assert log_record.span_id == ""

    def test_otel_context_span_none(self, log_record):
        from core.logging.filters import TraceContextFilter

        with (
            mock.patch("opentelemetry.trace.get_current_span", return_value=None),
            mock.patch("core.logging.filters.get_trace_id", return_value=""),
        ):
            filter = TraceContextFilter()
            filter.filter(log_record)
            assert log_record.trace_id == ""

    def test_otel_context_exception(self, log_record):
        from core.logging.filters import TraceContextFilter

        # Trigger exception in OTEL block
        with (
            mock.patch("opentelemetry.trace.get_current_span", side_effect=Exception),
            mock.patch("core.logging.filters.get_trace_id", return_value=""),
        ):
            filter = TraceContextFilter()
            filter.filter(log_record)
            assert log_record.trace_id == ""


class TestIdentityContextFilter:
    def test_sets_empty_identity_without_request_context(self, log_record):
        from core.logging.context import clear_request_context
        from core.logging.filters import IdentityContextFilter

        clear_request_context()
        filter = IdentityContextFilter()
        result = filter.filter(log_record)

        assert result is True
        assert log_record.tenant_id == ""
        assert log_record.user_id == ""
        assert log_record.user_type == ""

    def test_filter_always_returns_true(self, log_record):
        from core.logging.filters import IdentityContextFilter

        filter = IdentityContextFilter()
        result = filter.filter(log_record)
        assert result is True

    def test_uses_explicit_identity_context_without_flask_context(self, log_record):
        from core.logging.context import set_identity_context
        from core.logging.filters import IdentityContextFilter

        set_identity_context(tenant_id="tenant_id", user_id="end_user_id", user_type="end_user")

        filter = IdentityContextFilter()
        filter.filter(log_record)

        assert log_record.tenant_id == "tenant_id"
        assert log_record.user_id == "end_user_id"
        assert log_record.user_type == "end_user"

    def test_does_not_trigger_flask_login_request_loader(self, log_record):
        from flask import Flask
        from flask_login import LoginManager

        from core.logging.context import clear_request_context
        from core.logging.filters import IdentityContextFilter

        app = Flask(__name__)
        app.secret_key = "test"
        login_manager = LoginManager(app)
        request_loader = mock.Mock(return_value=None)
        login_manager.request_loader(request_loader)
        clear_request_context()

        with app.test_request_context("/"):
            from flask import g

            assert "_login_user" not in g
            IdentityContextFilter().filter(log_record)
            assert "_login_user" not in g

        request_loader.assert_not_called()
        assert log_record.tenant_id == ""
        assert log_record.user_id == ""
        assert log_record.user_type == ""

    def test_ended_otel_span_warning_does_not_trigger_request_loader(self):
        from flask import Flask, g
        from flask_login import LoginManager
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider

        from core.logging.context import clear_request_context
        from core.logging.filters import IdentityContextFilter

        app = Flask(__name__)
        app.secret_key = "test"
        login_manager = LoginManager(app)
        request_loader = mock.Mock(return_value=None)
        login_manager.request_loader(request_loader)

        span = TracerProvider().get_tracer(__name__).start_span("ended")
        span.end()

        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        handler.addFilter(IdentityContextFilter())
        handler.setFormatter(logging.Formatter("%(tenant_id)s %(user_id)s %(user_type)s %(message)s"))

        sdk_logger = logging.getLogger("opentelemetry.sdk.trace")
        previous_level = sdk_logger.level
        previous_propagate = sdk_logger.propagate
        previous_disabled = sdk_logger.disabled
        sdk_logger.addHandler(handler)
        sdk_logger.setLevel(logging.WARNING)
        sdk_logger.propagate = False
        sdk_logger.disabled = False
        clear_request_context()

        try:
            with app.test_request_context("/"), trace.use_span(span, end_on_exit=False):
                assert "_login_user" not in g

                span.set_attribute("test.key", "test-value")

                assert "_login_user" not in g
        finally:
            clear_request_context()
            sdk_logger.removeHandler(handler)
            sdk_logger.setLevel(previous_level)
            sdk_logger.propagate = previous_propagate
            sdk_logger.disabled = previous_disabled
            handler.close()

        request_loader.assert_not_called()
        assert "Setting attribute on ended span" in stream.getvalue()


class TestWorkflowLogContextFilter:
    """Tests for WorkflowLogContextFilter."""

    def test_sets_empty_context_by_default(self, log_record):
        from core.logging.context import clear_workflow_log_context
        from core.logging.filters import WorkflowLogContextFilter

        clear_workflow_log_context()

        filter = WorkflowLogContextFilter()
        result = filter.filter(log_record)

        assert result is True
        assert log_record.app_id == ""
        assert log_record.workflow_id == ""
        assert log_record.node_id == ""

    def test_sets_context_from_contextvars(self, log_record):
        from core.logging.context import (
            clear_workflow_log_context,
            set_workflow_log_context,
        )
        from core.logging.filters import WorkflowLogContextFilter

        clear_workflow_log_context()
        set_workflow_log_context("app-100", "wf-200")

        filter = WorkflowLogContextFilter()
        filter.filter(log_record)

        assert log_record.app_id == "app-100"
        assert log_record.workflow_id == "wf-200"
        assert log_record.node_id == ""

    def test_sets_node_id_from_contextvar(self, log_record):
        from core.logging.context import (
            clear_workflow_log_context,
            set_node_log_context,
            set_workflow_log_context,
        )
        from core.logging.filters import WorkflowLogContextFilter

        clear_workflow_log_context()
        set_workflow_log_context("app-100", "wf-200")
        set_node_log_context("node-xyz")

        filter = WorkflowLogContextFilter()
        filter.filter(log_record)

        assert log_record.app_id == "app-100"
        assert log_record.workflow_id == "wf-200"
        assert log_record.node_id == "node-xyz"

    def test_filter_always_returns_true(self, log_record):
        from core.logging.context import clear_workflow_log_context
        from core.logging.filters import WorkflowLogContextFilter

        clear_workflow_log_context()

        filter = WorkflowLogContextFilter()
        result = filter.filter(log_record)
        assert result is True
