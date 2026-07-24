import base64
import binascii
import os

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
        with pytest.raises(ValueError) as exc_info:
            valid_password("abc123")
        assert "Password must contain letters and numbers" in str(exc_info.value)

        # No numbers
        with pytest.raises(ValueError):
            valid_password("abcdefgh")

        # No letters
        with pytest.raises(ValueError):
            valid_password("12345678")

        # Empty
        with pytest.raises(ValueError):
            valid_password("")


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
