import struct
from datetime import datetime

import pytest

from core.app.apps.streaming_utils import WorkflowRunIdentifiedStream
from libs.helper import (
    OptionalTimestampField,
    _is_workflow_maintenance_sse_chunk,
    alphanumeric,
    compact_generate_response,
    email,
    escape_like_pattern,
    extract_tenant_id,
    length_prefixed_response,
)
from models.account import Account
from models.model import EndUser


class TestExtractTenantId:
    """Test cases for the extract_tenant_id utility function."""

    def test_extract_tenant_id_from_account_with_tenant(self):
        """Test extracting tenant_id from Account with current_tenant_id."""
        # Create a mock Account object
        account = Account(name="test", email="test@example.com")
        # Mock the current_tenant_id property
        account._current_tenant = type("MockTenant", (), {"id": "account-tenant-123"})()

        tenant_id = extract_tenant_id(account)
        assert tenant_id == "account-tenant-123"

    def test_extract_tenant_id_from_account_without_tenant(self):
        """Test extracting tenant_id from Account without current_tenant_id."""
        # Create a mock Account object
        account = Account(name="test", email="test@example.com")
        account._current_tenant = None

        tenant_id = extract_tenant_id(account)
        assert tenant_id is None

    def test_extract_tenant_id_from_enduser_with_tenant(self):
        """Test extracting tenant_id from EndUser with tenant_id."""
        # Create a mock EndUser object
        end_user = EndUser()
        end_user.tenant_id = "enduser-tenant-456"

        tenant_id = extract_tenant_id(end_user)
        assert tenant_id == "enduser-tenant-456"

    def test_extract_tenant_id_from_enduser_without_tenant(self):
        """Test extracting tenant_id from EndUser without tenant_id."""
        # Create a mock EndUser object
        end_user = EndUser()
        end_user.tenant_id = None

        tenant_id = extract_tenant_id(end_user)
        assert tenant_id is None

    def test_extract_tenant_id_with_invalid_user_type(self):
        """Test extracting tenant_id with invalid user type raises ValueError."""
        invalid_user = "not_a_user_object"

        with pytest.raises(ValueError, match="Invalid user type.*Expected Account or EndUser"):
            extract_tenant_id(invalid_user)

    def test_extract_tenant_id_with_none_user(self):
        """Test extracting tenant_id with None user raises ValueError."""
        with pytest.raises(ValueError, match="Invalid user type.*Expected Account or EndUser"):
            extract_tenant_id(None)

    def test_extract_tenant_id_with_dict_user(self):
        """Test extracting tenant_id with dict user raises ValueError."""
        dict_user = {"id": "123", "tenant_id": "456"}

        with pytest.raises(ValueError, match="Invalid user type.*Expected Account or EndUser"):
            extract_tenant_id(dict_user)


class TestOptionalTimestampField:
    def test_format_returns_none_for_none(self):
        field = OptionalTimestampField()

        assert field.format(None) is None

    def test_format_returns_unix_timestamp_for_datetime(self):
        field = OptionalTimestampField()
        value = datetime(2024, 1, 2, 3, 4, 5)

        assert field.format(value) == int(value.timestamp())


class TestEscapeLikePattern:
    """Test cases for the escape_like_pattern utility function."""

    def test_escape_percent_character(self):
        """Test escaping percent character."""
        result = escape_like_pattern("50% discount")
        assert result == "50\\% discount"

    def test_escape_underscore_character(self):
        """Test escaping underscore character."""
        result = escape_like_pattern("test_data")
        assert result == "test\\_data"

    def test_escape_backslash_character(self):
        """Test escaping backslash character."""
        result = escape_like_pattern("path\\to\\file")
        assert result == "path\\\\to\\\\file"

    def test_escape_combined_special_characters(self):
        """Test escaping multiple special characters together."""
        result = escape_like_pattern("file_50%\\path")
        assert result == "file\\_50\\%\\\\path"

    def test_escape_empty_string(self):
        """Test escaping empty string returns empty string."""
        result = escape_like_pattern("")
        assert result == ""

    def test_escape_none_handling(self):
        """Test escaping None returns None (falsy check handles it)."""
        # The function checks `if not pattern`, so None is falsy and returns as-is
        result = escape_like_pattern(None)
        assert result is None

    def test_escape_normal_string_no_change(self):
        """Test that normal strings without special characters are unchanged."""
        result = escape_like_pattern("normal text")
        assert result == "normal text"

    def test_escape_order_matters(self):
        """Test that backslash is escaped first to prevent double escaping."""
        # If we escape % first, then escape \, we might get wrong results
        # This test ensures the order is correct: \ first, then % and _
        result = escape_like_pattern("test\\%_value")
        # Should be: test\\\%\_value
        assert result == "test\\\\\\%\\_value"


class TestEmailValidator:
    """Tests for the email() validator — regression for #39234."""

    def test_valid_email_accepted(self):
        assert email("user@example.com") == "user@example.com"

    def test_trailing_newline_rejected(self):
        with pytest.raises(ValueError, match="not a valid email"):
            email("user@example.com\n")

    def test_trailing_carriage_return_newline_rejected(self):
        with pytest.raises(ValueError, match="not a valid email"):
            email("user@example.com\r\n")

    def test_multiple_newlines_rejected(self):
        with pytest.raises(ValueError, match="not a valid email"):
            email("user@example.com\n\n")

    def test_empty_string_rejected(self):
        with pytest.raises(ValueError, match="not a valid email"):
            email("")

    def test_invalid_email_rejected(self):
        with pytest.raises(ValueError, match="not a valid email"):
            email("not-an-email")


class TestAlphanumericValidator:
    """Tests for the alphanumeric() validator — regression for #39666."""

    def test_valid_alphanumeric_accepted(self):
        assert alphanumeric("tool_name") == "tool_name"
        assert alphanumeric("Tool123") == "Tool123"
        assert alphanumeric("_underscore_start") == "_underscore_start"
        assert alphanumeric("a") == "a"

    def test_trailing_newline_rejected(self):
        # re.match with $ accepts a trailing \n in Python; re.fullmatch does not.
        # This was the pre-fix behaviour: alphanumeric("tool\n") returned "tool\n".
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("tool_name\n")

    def test_trailing_carriage_return_rejected(self):
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("tool_name\r")

    def test_trailing_crlf_rejected(self):
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("tool_name\r\n")

    def test_leading_newline_rejected(self):
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("\ntool_name")

    def test_embedded_whitespace_rejected(self):
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("tool name")

    def test_empty_string_rejected(self):
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("")

    def test_special_characters_rejected(self):
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("tool-name")
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("tool.name")
        with pytest.raises(ValueError, match="not a valid alphanumeric value"):
            alphanumeric("tool/name")


def test_compact_generate_response_exposes_stable_workflow_run_id(app):
    stream = WorkflowRunIdentifiedStream(
        iter(['data: {"event":"ping"}\n\n']),
        workflow_run_id="run-1",
    )

    with app.test_request_context("/run"):
        response = compact_generate_response(stream)
        assert response.get_data(as_text=True) == 'data: {"event":"ping"}\n\n'

    assert response.headers["X-Workflow-Run-ID"] == "run-1"
    assert response.headers["Access-Control-Expose-Headers"] == "X-Workflow-Run-ID"


def test_compact_generate_response_closes_source_after_partial_consumption(app):
    source_closed = False

    def source():
        nonlocal source_closed
        try:
            while True:
                yield 'data: {"event":"ping"}\n\n'
        finally:
            source_closed = True

    with app.test_request_context("/run"):
        response = compact_generate_response(source())
        assert next(iter(response.response)) == 'data: {"event":"ping"}\n\n'
        response.close()

    assert source_closed


def test_compact_generate_response_maps_blocking_handoff_to_accepted():
    response = compact_generate_response(
        {
            "event": "workflow_maintenance_paused",
            "workflow_run_id": "run-1",
        }
    )

    assert response.status_code == 202
    assert response.headers["Retry-After"] == "1"
    assert response.headers["X-Workflow-Run-ID"] == "run-1"


@pytest.mark.parametrize(
    ("chunk", "expected"),
    [
        (object(), False),
        ('data: {"event":"ping"}\n\n', False),
        (
            "comment: workflow_maintenance_paused\n"
            "data: not-json\n"
            'data: {"event":"other","message":"workflow_maintenance_paused"}\n',
            False,
        ),
        ('data: {"event":"workflow_maintenance_paused"}\n\n', True),
    ],
)
def test_is_workflow_maintenance_sse_chunk_requires_matching_data_event(chunk: object, expected: bool) -> None:
    assert _is_workflow_maintenance_sse_chunk(chunk) is expected


def test_compact_generate_response_filters_maintenance_segment_and_closes_source(app):
    source_closed = False

    def source():
        nonlocal source_closed
        try:
            yield 'data: {"event":"workflow_maintenance_paused"}\n\n'
            yield 'data: {"event":"workflow_finished"}\n\n'
        finally:
            source_closed = True

    with app.test_request_context("/run"):
        response = compact_generate_response(source())
        assert response.get_data(as_text=True) == 'data: {"event":"workflow_finished"}\n\n'
        response.close()

    assert source_closed is True


def test_length_prefixed_stream_frames_text_and_bytes_and_closes_source(app):
    class ClosingStream:
        def __init__(self) -> None:
            self._chunks = iter(["text", b"bytes"])
            self.closed = False

        def __iter__(self) -> "ClosingStream":
            return self

        def __next__(self) -> str | bytes:
            return next(self._chunks)

        def close(self) -> None:
            self.closed = True

    stream = ClosingStream()
    with app.test_request_context("/run"):
        response = length_prefixed_response(7, stream)
        payload = response.get_data()
        response.close()

    first_header = struct.unpack("<BBHI", payload[:8])
    assert first_header == (7, 0, 10, 4)
    assert payload[14:18] == b"text"
    second_header = struct.unpack("<BBHI", payload[18:26])
    assert second_header == (7, 0, 10, 5)
    assert payload[32:] == b"bytes"
    assert stream.closed is True
