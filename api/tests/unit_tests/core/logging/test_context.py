"""Tests for logging context module."""

import uuid

from core.logging.context import (
    ErrorSource,
    clear_error_source,
    clear_request_context,
    clear_workflow_log_context,
    get_app_id,
    get_error_source,
    get_node_id,
    get_request_id,
    get_trace_id,
    get_workflow_id,
    init_request_context,
    set_error_source,
    set_node_log_context,
    set_workflow_log_context,
)


class TestLoggingContext:
    """Tests for the logging context functions."""

    def test_init_creates_request_id(self):
        """init_request_context should create a 10-char request ID."""
        init_request_context()
        request_id = get_request_id()
        assert len(request_id) == 10
        assert all(c in "0123456789abcdef" for c in request_id)

    def test_init_creates_trace_id(self):
        """init_request_context should create a 32-char trace ID."""
        init_request_context()
        trace_id = get_trace_id()
        assert len(trace_id) == 32
        assert all(c in "0123456789abcdef" for c in trace_id)

    def test_trace_id_derived_from_request_id(self):
        """trace_id should be deterministically derived from request_id."""
        init_request_context()
        request_id = get_request_id()
        trace_id = get_trace_id()

        # Verify trace_id is derived using uuid5
        expected_trace = uuid.uuid5(uuid.NAMESPACE_DNS, request_id).hex
        assert trace_id == expected_trace

    def test_clear_resets_context(self):
        """clear_request_context should reset both IDs to empty strings."""
        init_request_context()
        assert get_request_id() != ""
        assert get_trace_id() != ""

        clear_request_context()
        assert get_request_id() == ""
        assert get_trace_id() == ""

    def test_default_values_are_empty(self):
        """Default values should be empty strings before init."""
        clear_request_context()
        assert get_request_id() == ""
        assert get_trace_id() == ""

    def test_multiple_inits_create_different_ids(self):
        """Each init should create new unique IDs."""
        init_request_context()
        first_request_id = get_request_id()
        first_trace_id = get_trace_id()

        init_request_context()
        second_request_id = get_request_id()
        second_trace_id = get_trace_id()

        assert first_request_id != second_request_id
        assert first_trace_id != second_trace_id

    def test_context_isolation(self):
        """Context should be isolated per-call (no thread leakage in same thread)."""
        init_request_context()
        id1 = get_request_id()

        # Simulate another request
        init_request_context()
        id2 = get_request_id()

        # IDs should be different
        assert id1 != id2


class TestWorkflowLogContext:
    """Tests for workflow log context functions."""

    def setup_method(self):
        clear_workflow_log_context()

    def teardown_method(self):
        clear_workflow_log_context()

    def test_default_values_are_empty(self):
        assert get_app_id() == ""
        assert get_workflow_id() == ""
        assert get_node_id() == ""

    def test_set_workflow_log_context(self):
        set_workflow_log_context("app-001", "wf-002")
        assert get_app_id() == "app-001"
        assert get_workflow_id() == "wf-002"
        # node_id should still be empty
        assert get_node_id() == ""

    def test_set_node_log_context(self):
        set_workflow_log_context("app-001", "wf-002")
        set_node_log_context("node-abc")
        assert get_node_id() == "node-abc"

    def test_clear_node_log_context(self):
        set_workflow_log_context("app-001", "wf-002")
        set_node_log_context("node-abc")
        set_node_log_context("")
        assert get_node_id() == ""

    def test_clear_workflow_log_context_clears_all(self):
        set_workflow_log_context("app-001", "wf-002")
        set_node_log_context("node-abc")

        clear_workflow_log_context()
        assert get_app_id() == ""
        assert get_workflow_id() == ""
        assert get_node_id() == ""


class TestErrorSourceContext:
    """Tests for error_source context functions."""

    def setup_method(self):
        clear_error_source()

    def teardown_method(self):
        clear_error_source()

    def test_default_value_is_system(self):
        assert get_error_source() == ErrorSource.SYSTEM
        assert get_error_source().value == "system"

    def test_set_error_source(self):
        set_error_source(ErrorSource.WORKFLOW)
        assert get_error_source() == ErrorSource.WORKFLOW
        assert get_error_source().value == "workflow"

    def test_clear_error_source(self):
        set_error_source(ErrorSource.WORKFLOW)
        clear_error_source()
        assert get_error_source() == ErrorSource.SYSTEM

    def test_clear_workflow_log_context_does_not_reset_error_source(self):
        """clear_workflow_log_context should NOT reset error_source.

        error_source is managed independently by WorkflowEntry.run:
        it is set before graph execution and cleared in the finally block
        after all logging is done.
        """
        set_workflow_log_context("app-001", "wf-002")
        set_error_source(ErrorSource.WORKFLOW)

        clear_workflow_log_context()
        # error_source should remain WORKFLOW — clearing workflow context
        # (app_id/workflow_id/node_id) must not reset error classification.
        assert get_error_source() == ErrorSource.WORKFLOW

        clear_error_source()
