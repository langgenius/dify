import pytest

from services.oauth_pkce import PkceMethod, is_valid_challenge, verify_pkce

RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"


def test_rfc_7636_appendix_b_vector_verifies() -> None:
    assert verify_pkce(RFC_VERIFIER, RFC_CHALLENGE)


def test_wrong_verifier_fails() -> None:
    assert not verify_pkce("a" * 43, RFC_CHALLENGE)


@pytest.mark.parametrize("verifier", ["", "short", "é" * 50, RFC_VERIFIER + "=", "a" * 129])
def test_malformed_verifier_fails_without_raising(verifier: str) -> None:
    assert not verify_pkce(verifier, RFC_CHALLENGE)


def test_challenge_with_non_ascii_does_not_raise() -> None:
    assert not verify_pkce(RFC_VERIFIER, "é" * 43)


@pytest.mark.parametrize(
    ("challenge", "expected"),
    [
        ("a" * 43, True),
        ("a" * 128, True),
        ("a" * 42, False),
        ("a" * 129, False),
        ("a" * 42 + "+", False),
        ("a" * 42 + "=", False),
        ("a" * 42 + " ", False),
        ("a" * 42 + "\n", False),
        ("-._~" + "a" * 39, True),
        ("", False),
    ],
)
def test_is_valid_challenge(challenge: str, expected: bool) -> None:
    assert is_valid_challenge(challenge) is expected


def test_only_s256_is_defined() -> None:
    assert [m.value for m in PkceMethod] == ["S256"]
    with pytest.raises(ValueError, match="plain"):
        PkceMethod("plain")
