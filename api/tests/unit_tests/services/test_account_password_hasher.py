import pytest

from services.account_errors import InvalidAccountPasswordError
from services.account_password_hasher import LegacyAccountPasswordHasher


def test_hash_produces_a_digest_that_can_be_verified() -> None:
    passwords = LegacyAccountPasswordHasher()

    digest = passwords.hash("password123")

    assert passwords.verify(
        "password123",
        password_hash=digest.password_hash,
        password_salt=digest.password_salt,
    )
    assert not passwords.verify(
        "different123",
        password_hash=digest.password_hash,
        password_salt=digest.password_salt,
    )


def test_hash_maps_password_policy_validation() -> None:
    passwords = LegacyAccountPasswordHasher()

    with pytest.raises(InvalidAccountPasswordError, match="Password must contain letters and numbers"):
        passwords.hash("letters-only")
