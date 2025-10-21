import pytest

from libs.helper import email


def test_email_with_valid_email():
    assert email("test@example.com") == "test@example.com"
    assert email("TEST12345@example.com") == "TEST12345@example.com"
    assert email("test+test@example.com") == "test+test@example.com"
    assert email("!#$%&'*+-/=?^_{|}~`@example.com") == "!#$%&'*+-/=?^_{|}~`@example.com"


def test_email_with_invalid_email():
    with pytest.raises(ValueError, match="invalid_email is not a valid email."):
        email("invalid_email")

    with pytest.raises(ValueError, match="@example.com is not a valid email."):
        email("@example.com")

    with pytest.raises(ValueError, match="()@example.com is not a valid email."):
        email("()@example.com")
