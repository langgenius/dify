"""Regression tests for local-part dot rules in the email() validator."""

import pytest

from libs.helper import email


class TestEmailExistingContract:
    """Valid addresses (and the special-character local part already covered by
    the suite) must keep being accepted."""

    @pytest.mark.parametrize(
        "value",
        [
            "test@example.com",
            "TEST12345@example.com",
            "test+test@example.com",
            "!#$%&'*+-/=?^_{|}~`@example.com",
            "first.last@example.com",
            "user@sub.example.com",
        ],
    )
    def test_valid_emails_accepted(self, value: str) -> None:
        assert email(value) == value

    @pytest.mark.parametrize(
        "value",
        [
            "invalid_email",
            "@example.com",
            "()@example.com",
            "user@example.com\n",
            "user@example.com\r\n",
            "",
            "a@example.c",
        ],
    )
    def test_invalid_emails_rejected(self, value: str) -> None:
        with pytest.raises(ValueError, match="not a valid email"):
            email(value)


class TestEmailLocalPartDots:
    """RFC 5322 dot-atom: a local part may not start with a dot, end with a
    dot, or contain consecutive dots. The old pattern folded `.` into the
    atom character class and accepted all three malformed forms.
    """

    @pytest.mark.parametrize(
        "value",
        [
            "a..b@example.com",
            ".abc@example.com",
            "abc.@example.com",
            "a...b@example.com",
            "a.@example.com",
        ],
    )
    def test_reject_malformed_dot_placement(self, value: str) -> None:
        with pytest.raises(ValueError, match="not a valid email"):
            email(value)
