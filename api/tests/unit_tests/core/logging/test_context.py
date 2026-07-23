"""Tests for logging context module."""

import uuid
from contextvars import copy_context

import pytest

from core.logging.context import (
    clear_request_context,
    get_identity_context,
    get_request_id,
    get_trace_id,
    init_request_context,
    request_logging_context,
    set_identity_context,
)


@pytest.fixture(autouse=True)
def _reset_logging_context():
    clear_request_context()
    yield
    clear_request_context()


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

    def test_set_identity_context(self):
        set_identity_context(tenant_id="tenant-1", user_id="user-1", user_type="end_user")

        assert get_identity_context() == ("tenant-1", "user-1", "end_user")

    def test_set_identity_context_replaces_all_fields(self):
        set_identity_context(tenant_id="tenant-1", user_id="user-1", user_type="account")

        set_identity_context(user_id="user-2", user_type="end_user")

        assert get_identity_context() == ("", "user-2", "end_user")

    def test_identity_context_is_copied_as_primitive_values(self):
        set_identity_context(tenant_id="tenant-1", user_id="user-1", user_type="end_user")
        copied_context = copy_context()

        clear_request_context()

        assert get_identity_context() == ("", "", "")
        assert copied_context.run(get_identity_context) == ("tenant-1", "user-1", "end_user")

    def test_init_clears_existing_identity_context(self):
        set_identity_context(tenant_id="tenant-1", user_id="user-1", user_type="end_user")

        init_request_context()

        assert get_identity_context() == ("", "", "")

    def test_clear_resets_identity_context(self):
        set_identity_context(tenant_id="tenant-1", user_id="user-1", user_type="end_user")

        clear_request_context()

        assert get_identity_context() == ("", "", "")

    def test_request_logging_context_restores_caller(self):
        init_request_context()
        outer_request_id = get_request_id()
        outer_trace_id = get_trace_id()
        set_identity_context(tenant_id="outer-tenant", user_id="outer-user", user_type="account")

        with request_logging_context():
            assert get_request_id() != outer_request_id
            assert get_trace_id() != outer_trace_id
            assert get_identity_context() == ("", "", "")
            set_identity_context(tenant_id="inner-tenant", user_id="inner-user", user_type="end_user")

        assert get_request_id() == outer_request_id
        assert get_trace_id() == outer_trace_id
        assert get_identity_context() == ("outer-tenant", "outer-user", "account")
