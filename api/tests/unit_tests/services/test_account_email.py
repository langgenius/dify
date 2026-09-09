import pytest

from services.account_email import normalize_email


@pytest.mark.parametrize(
    ("email", "expected"),
    [
        ("User@Example.com", "user@example.com"),
        ("User@GoogleMail.com", "user@gmail.com"),
        ("user@gmail.com", "user@gmail.com"),
        ("u.ser+tag@gmail.com", "user@gmail.com"),
        ("u.ser+tag@googlemail.com", "user@gmail.com"),
        ("user+tag@example.com", "user+tag@example.com"),
        ("u.ser+tag@example.org", "u.ser+tag@example.org"),
    ],
)
def test_normalize_email(email: str, expected: str) -> None:
    assert normalize_email(email) == expected
