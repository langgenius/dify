"""Tests for structured JSON formatter."""

import logging
import sys

import orjson

from core.logging.context import ErrorSource, clear_error_source, set_error_source
from core.logging.structured_formatter import StructuredJSONFormatter


class TestStructuredJSONFormatter:
    def test_basic_log_format(self):
        from core.logging.structured_formatter import StructuredJSONFormatter

        formatter = StructuredJSONFormatter(service_name="test-service")
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=42,
            msg="Test message",
            args=(),
            exc_info=None,
        )

        output = formatter.format(record)
        log_dict = orjson.loads(output)

        assert log_dict["severity"] == "INFO"
        assert log_dict["service"] == "test-service"
        assert log_dict["caller"] == "test.py:42"
        assert log_dict["message"] == "Test message"
        assert "ts" in log_dict
        assert log_dict["ts"].endswith("Z")

    def test_severity_mapping(self):
        from core.logging.structured_formatter import StructuredJSONFormatter

        formatter = StructuredJSONFormatter()

        test_cases = [
            (logging.DEBUG, "DEBUG"),
            (logging.INFO, "INFO"),
            (logging.WARNING, "WARN"),
            (logging.ERROR, "ERROR"),
            (logging.CRITICAL, "ERROR"),
        ]

        for level, expected_severity in test_cases:
            record = logging.LogRecord(
                name="test",
                level=level,
                pathname="test.py",
                lineno=1,
                msg="Test",
                args=(),
                exc_info=None,
            )
            output = formatter.format(record)
            log_dict = orjson.loads(output)
            assert log_dict["severity"] == expected_severity, f"Level {level} should map to {expected_severity}"

    def test_error_with_stack_trace(self):
        from core.logging.structured_formatter import StructuredJSONFormatter

        formatter = StructuredJSONFormatter()

        try:
            raise ValueError("Test error")
        except ValueError:
            exc_info = sys.exc_info()

        record = logging.LogRecord(
            name="test",
            level=logging.ERROR,
            pathname="test.py",
            lineno=10,
            msg="Error occurred",
            args=(),
            exc_info=exc_info,
        )

        output = formatter.format(record)
        log_dict = orjson.loads(output)

        assert log_dict["severity"] == "ERROR"
        assert "stack_trace" in log_dict
        assert "ValueError: Test error" in log_dict["stack_trace"]

    def test_no_stack_trace_for_info(self):
        from core.logging.structured_formatter import StructuredJSONFormatter

        formatter = StructuredJSONFormatter()

        try:
            raise ValueError("Test error")
        except ValueError:
            exc_info = sys.exc_info()

        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=10,
            msg="Info message",
            args=(),
            exc_info=exc_info,
        )

        output = formatter.format(record)
        log_dict = orjson.loads(output)

        assert "stack_trace" not in log_dict

    def test_trace_context_included(self):
        from core.logging.structured_formatter import StructuredJSONFormatter

        formatter = StructuredJSONFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="Test",
            args=(),
            exc_info=None,
        )
        record.trace_id = "5b8aa5a2d2c872e8321cf37308d69df2"
        record.span_id = "051581bf3bb55c45"

        output = formatter.format(record)
        log_dict = orjson.loads(output)

        assert log_dict["trace_id"] == "5b8aa5a2d2c872e8321cf37308d69df2"
        assert log_dict["span_id"] == "051581bf3bb55c45"

    def test_identity_context_included(self):
        from core.logging.structured_formatter import StructuredJSONFormatter

        formatter = StructuredJSONFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="Test",
            args=(),
            exc_info=None,
        )
        record.tenant_id = "t-global-corp"
        record.user_id = "u-admin-007"
        record.user_type = "admin"

        output = formatter.format(record)
        log_dict = orjson.loads(output)

        assert "identity" in log_dict
        assert log_dict["identity"]["tenant_id"] == "t-global-corp"
        assert log_dict["identity"]["user_id"] == "u-admin-007"
        assert log_dict["identity"]["user_type"] == "admin"

    def test_no_identity_when_empty(self):
        from core.logging.structured_formatter import StructuredJSONFormatter

        formatter = StructuredJSONFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="Test",
            args=(),
            exc_info=None,
        )

        output = formatter.format(record)
        log_dict = orjson.loads(output)

        assert "identity" not in log_dict

    def test_attributes_included(self):
        from core.logging.structured_formatter import StructuredJSONFormatter

        formatter = StructuredJSONFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="Test",
            args=(),
            exc_info=None,
        )
        record.attributes = {"order_id": "ord-123", "amount": 99.99}

        output = formatter.format(record)
        log_dict = orjson.loads(output)

        assert log_dict["attributes"]["order_id"] == "ord-123"
        assert log_dict["attributes"]["amount"] == 99.99

    def test_message_with_args(self):
        from core.logging.structured_formatter import StructuredJSONFormatter

        formatter = StructuredJSONFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="User %s logged in from %s",
            args=("john", "192.168.1.1"),
            exc_info=None,
        )

        output = formatter.format(record)
        log_dict = orjson.loads(output)

        assert log_dict["message"] == "User john logged in from 192.168.1.1"

    def test_timestamp_format(self):
        from core.logging.structured_formatter import StructuredJSONFormatter

        formatter = StructuredJSONFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="Test",
            args=(),
            exc_info=None,
        )

        output = formatter.format(record)
        log_dict = orjson.loads(output)

        # Verify ISO 8601 format with Z suffix
        ts = log_dict["ts"]
        assert ts.endswith("Z")
        assert "T" in ts
        # Should have milliseconds
        assert "." in ts

    def test_fallback_for_non_serializable_attributes(self):
        from core.logging.structured_formatter import StructuredJSONFormatter

        formatter = StructuredJSONFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="Test with non-serializable",
            args=(),
            exc_info=None,
        )
        # Set is not serializable by orjson
        record.attributes = {"items": {1, 2, 3}, "custom": object()}

        # Should not raise, fallback to json.dumps with default=str
        output = formatter.format(record)

        # Verify it's valid JSON (parsed by stdlib json since orjson may fail)
        import json

        log_dict = json.loads(output)
        assert log_dict["message"] == "Test with non-serializable"
        assert "attributes" in log_dict


# ---------------------------------------------------------------------------
# Workflow log context (app_id / workflow_id / node_id)
# ---------------------------------------------------------------------------


class TestLogContextExtraction:
    """Tests for workflow log context extraction in the formatter."""

    def test_context_included_when_set(self):
        from core.logging.structured_formatter import StructuredJSONFormatter

        formatter = StructuredJSONFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="Test",
            args=(),
            exc_info=None,
        )
        record.app_id = "app-123"
        record.workflow_id = "wf-456"
        record.node_id = "node-789"

        output = formatter.format(record)
        log_dict = orjson.loads(output)

        assert "context" in log_dict
        assert log_dict["context"]["app_id"] == "app-123"
        assert log_dict["context"]["workflow_id"] == "wf-456"
        assert log_dict["context"]["node_id"] == "node-789"

    def test_context_partial_fields(self):
        from core.logging.structured_formatter import StructuredJSONFormatter

        formatter = StructuredJSONFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="Test",
            args=(),
            exc_info=None,
        )
        record.app_id = "app-123"
        # workflow_id and node_id not set

        output = formatter.format(record)
        log_dict = orjson.loads(output)

        assert "context" in log_dict
        assert log_dict["context"]["app_id"] == "app-123"
        assert "workflow_id" not in log_dict["context"]
        assert "node_id" not in log_dict["context"]

    def test_no_context_when_all_empty(self):
        from core.logging.structured_formatter import StructuredJSONFormatter

        formatter = StructuredJSONFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="Test",
            args=(),
            exc_info=None,
        )
        record.app_id = ""
        record.workflow_id = ""
        record.node_id = ""

        output = formatter.format(record)
        log_dict = orjson.loads(output)

        assert "context" not in log_dict


# ---------------------------------------------------------------------------
# error_source inference
# ---------------------------------------------------------------------------


class TestInferErrorSource:
    """Tests for _infer_error_source with ContextVar-based source."""

    def _make_record(self, level: int = logging.ERROR) -> logging.LogRecord:
        return logging.LogRecord(
            name="test",
            level=level,
            pathname="test.py",
            lineno=1,
            msg="Test",
            args=(),
            exc_info=None,
        )

    def test_default_is_system(self):
        """Without any context, default to 'system'."""
        clear_error_source()
        formatter = StructuredJSONFormatter()
        record = self._make_record()

        assert formatter._infer_error_source(record) == "system"

    def test_contextvar_workflow(self):
        """When ContextVar is set to WORKFLOW, error_source should be 'workflow'."""
        clear_error_source()
        set_error_source(ErrorSource.WORKFLOW)
        formatter = StructuredJSONFormatter()
        record = self._make_record()

        assert formatter._infer_error_source(record) == "workflow"

        clear_error_source()

    def test_error_source_only_for_error_and_above(self):
        """error_source field should NOT appear for INFO/DEBUG logs."""
        clear_error_source()
        formatter = StructuredJSONFormatter()
        record = self._make_record(level=logging.INFO)

        output = formatter.format(record)
        log_dict = orjson.loads(output)

        assert "error_source" not in log_dict

    def test_error_source_present_for_error(self):
        """error_source field should appear for ERROR logs."""
        clear_error_source()
        set_error_source(ErrorSource.WORKFLOW)
        formatter = StructuredJSONFormatter()
        record = self._make_record(level=logging.ERROR)

        output = formatter.format(record)
        log_dict = orjson.loads(output)

        assert log_dict["error_source"] == "workflow"

        clear_error_source()

    def test_error_source_present_for_critical(self):
        """error_source field should appear for CRITICAL logs."""
        clear_error_source()
        formatter = StructuredJSONFormatter()
        record = self._make_record(level=logging.CRITICAL)

        output = formatter.format(record)
        log_dict = orjson.loads(output)

        assert log_dict["error_source"] == "system"

    def test_error_source_default_system_in_output(self):
        """Without context, ERROR log should have error_source='system'."""
        clear_error_source()
        formatter = StructuredJSONFormatter()
        record = self._make_record(level=logging.ERROR)

        output = formatter.format(record)
        log_dict = orjson.loads(output)

        assert log_dict["error_source"] == "system"
