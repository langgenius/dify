from libs.helper import email


def test_email_with_valid_email():
    assert email("test@example.com") == "test@example.com"
    assert email("TEST12345@example.com") == "TEST12345@example.com"
    assert email("test+test@example.com") == "test+test@example.com"
    assert email("!#$%&'*+-/=?^_{|}~`@example.com") == "!#$%&'*+-/=?^_{|}~`@example.com"


def test_email_with_invalid_email():
    try:
        email("invalid_email")
    except ValueError as e:
        assert str(e) == "invalid_email is not a valid email."

    try:
        email("@example.com")
    except ValueError as e:
        assert str(e) == "@example.com is not a valid email."

    try:
        email("()@example.com")
    except ValueError as e:
        assert str(e) == "()@example.com is not a valid email."
