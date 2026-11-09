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


@pytest.mark.parametrize("domain", ["outlook.com", "hotmail.com", "live.com", "msn.com"])
def test_microsoft_strips_tags_but_preserves_dots_and_domains(domain: str) -> None:
    assert normalize_email(f"First.Last+tag+other@{domain.upper()}") == f"first.last@{domain}"
    assert normalize_email(f"first.last@{domain}") != normalize_email(f"firstlast@{domain}")


@pytest.mark.parametrize("domain", ["icloud.com", "me.com", "mac.com"])
def test_apple_normalizes_legacy_domains_and_tags(domain: str) -> None:
    assert normalize_email(f"First.Last+tag@{domain.upper()}") == "first.last@icloud.com"
    assert normalize_email(f"first.last@{domain}") != normalize_email(f"firstlast@{domain}")


@pytest.mark.parametrize("domain", ["protonmail.com", "proton.me", "pm.me", "protonmail.ch"])
def test_proton_strips_transparent_characters_and_tags_but_preserves_domain(domain: str) -> None:
    assert normalize_email(f"First.Last_Name-Test+tag+other@{domain.upper()}") == f"firstlastnametest@{domain}"


@pytest.mark.parametrize(
    "domain",
    ["yahoo.com", "yahoo.co.uk", "ymail.com", "mail.com", "example.com", "sub.gmail.com", "outlook.com.example.org"],
)
def test_other_domains_preserve_local_part(domain: str) -> None:
    assert normalize_email(f"First.Last_Name-Test+tag@{domain.upper()}") == f"first.last_name-test+tag@{domain}"


@pytest.mark.parametrize(
    "email",
    ["u.ser+tag@gmail.com", "u.ser+tag@outlook.com", "u.ser+tag@mac.com", "u.ser_name-tag+other@proton.me"],
)
def test_normalization_is_idempotent(email: str) -> None:
    normalized = normalize_email(email)
    assert normalize_email(normalized) == normalized
