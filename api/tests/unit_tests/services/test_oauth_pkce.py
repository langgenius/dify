import pytest

from services.oauth_pkce import is_valid_challenge, verify_pkce

RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"


def test_rfc_7636_appendix_b_vector_verifies() -> None:
    assert verify_pkce(RFC_VERIFIER, RFC_CHALLENGE)


@pytest.mark.parametrize(
    ("verifier", "challenge"), [("a" * 43, RFC_CHALLENGE), ("é" * 50, RFC_CHALLENGE), (RFC_VERIFIER, "é" * 43)]
)
def test_wrong_or_malformed_input_fails_without_raising(verifier: str, challenge: str) -> None:
    assert not verify_pkce(verifier, challenge)


@pytest.mark.parametrize(
    ("challenge", "expected"), [("-._~" + "a" * 39, True), ("a" * 42, False), ("a" * 42 + "+", False)]
)
def test_is_valid_challenge(challenge: str, expected: bool) -> None:
    assert is_valid_challenge(challenge) is expected
