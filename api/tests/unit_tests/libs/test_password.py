import base64
import binascii
import hashlib
import hmac
import os
from collections.abc import Callable

import pytest

from libs.password import compare_password, hash_password, valid_password


class TestValidPassword:
    """Test password format validation"""

    def test_should_accept_valid_passwords(self):
        """Test accepting valid password formats"""
        assert valid_password("password123") == "password123"
        assert valid_password("test1234") == "test1234"
        assert valid_password("Test123456") == "Test123456"

    def test_should_reject_invalid_passwords(self):
        """Test rejecting invalid password formats"""
        # Too short
        with pytest.raises(
            ValueError,
            match=("Password must contain letters and numbers, and the length must be at least 8 characters\\."),
        ) as exc_info:
            valid_password("abc123")
        assert "Password must contain letters and numbers" in str(exc_info.value)

        # No numbers
        with pytest.raises(
            ValueError,
            match=("Password must contain letters and numbers, and the length must be at least 8 characters\\."),
        ):
            valid_password("abcdefgh")

        # No letters
        with pytest.raises(
            ValueError,
            match=("Password must contain letters and numbers, and the length must be at least 8 characters\\."),
        ):
            valid_password("12345678")

        # Empty
        with pytest.raises(
            ValueError,
            match=("Password must contain letters and numbers, and the length must be at least 8 characters\\."),
        ):
            valid_password("")

    def test_should_reject_password_shorter_than_minimum_length(self):
        """A 7-character password with letters and numbers is rejected for length."""
        with pytest.raises(
            ValueError,
            match=("Password must contain letters and numbers, and the length must be at least 8 characters\\."),
        ) as exc_info:
            valid_password("abc1234")

        assert "at least 8" in str(exc_info.value)


class TestPasswordHashing:
    """Test password hashing and comparison"""

    def setup_method(self):
        """Setup test data"""
        self.password = "test123password"
        self.salt = os.urandom(16)
        self.salt_base64 = base64.b64encode(self.salt).decode()

        password_hash = hash_password(self.password, self.salt)
        self.password_hash_base64 = base64.b64encode(password_hash).decode()

    def test_should_verify_correct_password(self):
        """Test correct password verification"""
        result = compare_password(self.password, self.password_hash_base64, self.salt_base64)
        assert result is True

    def test_should_reject_wrong_password(self):
        """Test rejection of incorrect passwords"""
        result = compare_password("wrongpassword", self.password_hash_base64, self.salt_base64)
        assert result is False

    def test_should_handle_invalid_base64(self):
        """Test handling of invalid base64 data"""
        # Invalid base64 hash
        with pytest.raises(binascii.Error):
            compare_password(self.password, "invalid_base64!", self.salt_base64)

        # Invalid base64 salt
        with pytest.raises(binascii.Error):
            compare_password(self.password, self.password_hash_base64, "invalid_base64!")

    def test_should_be_case_sensitive(self):
        """Test password case sensitivity"""
        result = compare_password(self.password.upper(), self.password_hash_base64, self.salt_base64)
        assert result is False


class TestPasswordPepper:
    """Test PASSWORD_PEPPER handling"""

    password = "test123password"
    salt = b"0123456789abcdef"

    @staticmethod
    def _encode(password_hash: bytes) -> str:
        return base64.b64encode(password_hash).decode()

    def test_empty_pepper_keeps_legacy_hash(self, config_overrides: Callable[..., None]):
        config_overrides(PASSWORD_PEPPER="")
        legacy = binascii.hexlify(hashlib.pbkdf2_hmac("sha256", self.password.encode(), self.salt, 10000))

        assert hash_password(self.password, self.salt) == legacy

    def test_pepper_wraps_legacy_digest(self, config_overrides: Callable[..., None]):
        config_overrides(PASSWORD_PEPPER="pepper-a")
        legacy_digest = hashlib.pbkdf2_hmac("sha256", self.password.encode(), self.salt, 10000)
        expected = binascii.hexlify(hmac.new(b"pepper-a", legacy_digest, hashlib.sha256).digest())

        assert hash_password(self.password, self.salt) == expected

    def test_peppered_hash_verifies_with_same_pepper(self, config_overrides: Callable[..., None]):
        config_overrides(PASSWORD_PEPPER="pepper-a")
        password_hash = self._encode(hash_password(self.password, self.salt))

        assert compare_password(self.password, password_hash, self._encode(self.salt)) is True
        assert compare_password("wrongpassword1", password_hash, self._encode(self.salt)) is False

    @pytest.mark.parametrize(("hash_pepper", "verify_pepper"), [("", "pepper-a"), ("pepper-a", ""), ("pepper-a", "b")])
    def test_changing_pepper_invalidates_existing_hash(
        self, config_overrides: Callable[..., None], hash_pepper: str, verify_pepper: str
    ):
        config_overrides(PASSWORD_PEPPER=hash_pepper)
        password_hash = self._encode(hash_password(self.password, self.salt))

        config_overrides(PASSWORD_PEPPER=verify_pepper)
        assert compare_password(self.password, password_hash, self._encode(self.salt)) is False
