from datetime import datetime

import pytest
from flask import request

from configs import dify_config
from dify_app import DifyApp
from extensions import ext_proxy_fix
from libs.helper import (
    OptionalTimestampField,
    alphanumeric,
    email,
    escape_like_pattern,
    extract_remote_ip,
    extract_tenant_id,
)
from models.account import Account
from models.model import EndUser


@pytest.mark.parametrize(
    ("trust_proxy", "headers", "expected_ip"),
    [
        (False, {}, "198.51.100.7"),
        (False, {"CF-Connecting-IP": "203.0.113.1"}, "198.51.100.7"),
        (False, {"X-Forwarded-For": "203.0.113.1"}, "198.51.100.7"),
        (
            False,
            {"CF-Connecting-IP": "203.0.113.1", "X-Forwarded-For": "203.0.113.2, 192.0.2.42"},
            "198.51.100.7",
        ),
        (
            True,
            {"CF-Connecting-IP": "203.0.113.1", "X-Forwarded-For": "203.0.113.2, 192.0.2.42"},
            "192.0.2.42",
        ),
        (True, {"CF-Connecting-IP": "203.0.113.1"}, "198.51.100.7"),
    ],
)
def test_extract_remote_ip_uses_trusted_wsgi_address(
    monkeypatch: pytest.MonkeyPatch, trust_proxy: bool, headers: dict[str, str], expected_ip: str
) -> None:
    monkeypatch.setattr(dify_config, "RESPECT_XFORWARD_HEADERS_ENABLED", trust_proxy)
    app = DifyApp(__name__)
    ext_proxy_fix.init_app(app)

    @app.get("/")
    def remote_ip() -> str:
        return extract_remote_ip(request)

    response = app.test_client().get("/", headers=headers, environ_overrides={"REMOTE_ADDR": "198.51.100.7"})

    assert response.get_data(as_text=True) == expected_ip


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
