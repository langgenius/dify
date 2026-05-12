"""Tests for logging filters."""

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
        from core.logging.filters import IdentityContextFilter

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

    def test_handles_exception_gracefully(self, log_record):
        from core.logging.filters import IdentityContextFilter

        filter = IdentityContextFilter()

        # Should not raise even if something goes wrong
        with mock.patch(
            "core.logging.filters.flask.has_request_context", side_effect=Exception("Test error"), autospec=True
        ):
            result = filter.filter(log_record)
            assert result is True
            assert log_record.tenant_id == ""

    def test_sets_empty_identity_unauthenticated(self, log_record):
        from core.logging.filters import IdentityContextFilter

        mock_user = mock.MagicMock()
        mock_user.is_authenticated = False

        with (
            mock.patch("flask.has_request_context", return_value=True),
            mock.patch("flask_login.current_user", mock_user),
        ):
            filter = IdentityContextFilter()
            filter.filter(log_record)
            assert log_record.user_id == ""

    def test_sets_identity_for_account(self, log_record):
        from core.logging.filters import IdentityContextFilter

        class MockAccount:
            pass

        mock_user = MockAccount()
        mock_user.id = "account_id"
        mock_user.current_tenant_id = "tenant_id"
        mock_user.is_authenticated = True

        with (
            mock.patch("flask.has_request_context", return_value=True),
            mock.patch("models.Account", MockAccount),
            mock.patch("flask_login.current_user", mock_user),
        ):
            filter = IdentityContextFilter()
            filter.filter(log_record)

            assert log_record.tenant_id == "tenant_id"
            assert log_record.user_id == "account_id"
            assert log_record.user_type == "account"

    def test_sets_identity_for_account_no_tenant(self, log_record):
        from core.logging.filters import IdentityContextFilter

        class MockAccount:
            pass

        mock_user = MockAccount()
        mock_user.id = "account_id"
        mock_user.current_tenant_id = None
        mock_user.is_authenticated = True

        with (
            mock.patch("flask.has_request_context", return_value=True),
            mock.patch("models.Account", MockAccount),
            mock.patch("flask_login.current_user", mock_user),
        ):
            filter = IdentityContextFilter()
            filter.filter(log_record)

            assert log_record.tenant_id == ""
            assert log_record.user_id == "account_id"
            assert log_record.user_type == "account"

    def test_sets_identity_for_end_user(self, log_record):
        from core.logging.filters import IdentityContextFilter

        class MockEndUser:
            pass

        class AnotherClass:
            pass

        mock_user = MockEndUser()
        mock_user.id = "end_user_id"
        mock_user.tenant_id = "tenant_id"
        mock_user.type = "custom_type"
        mock_user.is_authenticated = True

        with (
            mock.patch("flask.has_request_context", return_value=True),
            mock.patch("models.model.EndUser", MockEndUser),
            mock.patch("models.Account", AnotherClass),
            mock.patch("flask_login.current_user", mock_user),
        ):
            filter = IdentityContextFilter()
            filter.filter(log_record)

            assert log_record.tenant_id == "tenant_id"
            assert log_record.user_id == "end_user_id"
            assert log_record.user_type == "custom_type"

    def test_sets_identity_for_end_user_default_type(self, log_record):
        from core.logging.filters import IdentityContextFilter

        class MockEndUser:
            pass

        class AnotherClass:
            pass

        mock_user = MockEndUser()
        mock_user.id = "end_user_id"
        mock_user.tenant_id = "tenant_id"
        mock_user.type = None
        mock_user.is_authenticated = True

        with (
            mock.patch("flask.has_request_context", return_value=True),
            mock.patch("models.model.EndUser", MockEndUser),
            mock.patch("models.Account", AnotherClass),
            mock.patch("flask_login.current_user", mock_user),
        ):
            filter = IdentityContextFilter()
            filter.filter(log_record)

            assert log_record.tenant_id == "tenant_id"
            assert log_record.user_id == "end_user_id"
            assert log_record.user_type == "end_user"
