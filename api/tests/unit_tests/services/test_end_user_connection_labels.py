import pytest

from services.end_user_connection_labels import mask_account_label


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        (None, None),
        ("", None),
        ("a@example.com", "*@example.com"),
        ("ab@example.com", "a*@example.com"),
        ("abc@example.com", "ab*@example.com"),
        ("alice@example.com", "al***@example.com"),
        ("a+b@example.com", "a+*@example.com"),
        ("alice@Mail.Example.com", "al***@Mail.Example.com"),
        ("a", "*"),
        ("ab", "a*"),
        ("abc", "ab*"),
        ("alice", "al***"),
        ("\u00e9", "*"),
        ("\u00e9a", "\u00e9*"),
        ("\u00e9ab", "\u00e9a*"),
        ("\u00e9a@example.com", "\u00e9*@example.com"),
        ("@example.com", "@e**********"),
        ("alice@", "al****"),
        ("alice@@example.com", "al****************"),
        ("alice@example.com\n", "al****************"),
    ],
)
def test_mask_account_label(label: str | None, expected: str | None) -> None:
    assert mask_account_label(label) == expected
