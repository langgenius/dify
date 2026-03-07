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


class TestPasswordHashIterations:
    """Test password hashing with configurable iterations"""

    def setup_method(self):
        """Setup test data"""
        self.password = "secure123password"
        self.salt = os.urandom(16)
        self.salt_base64 = base64.b64encode(self.salt).decode()

    def test_should_hash_with_custom_iterations(self):
        """Test hashing with custom iteration count"""
        iterations = 50000
        password_hash = hash_password(self.password, self.salt, iterations)
        password_hash_base64 = base64.b64encode(password_hash).decode()

        result = compare_password(self.password, password_hash_base64, self.salt_base64, iterations)
        assert result is True

    def test_should_produce_different_hashes_for_different_iterations(self):
        """Test that different iteration counts produce different hashes"""
        hash_10k = hash_password(self.password, self.salt, 10000)
        hash_50k = hash_password(self.password, self.salt, 50000)

        assert hash_10k != hash_50k

    def test_should_use_default_iterations_when_none_specified(self):
        """Test that default iterations are used when not specified"""
        hash_default = hash_password(self.password, self.salt)
        hash_default_base64 = base64.b64encode(hash_default).decode()

        # Should verify with default config iterations
        result = compare_password(self.password, hash_default_base64, self.salt_base64)
        assert result is True

    def test_should_fail_verification_with_wrong_iterations(self):
        """Test that verification fails with incorrect iteration count"""
        hash_10k = hash_password(self.password, self.salt, 10000)
        hash_10k_base64 = base64.b64encode(hash_10k).decode()

        # Try to verify with different iteration count
        result = compare_password(self.password, hash_10k_base64, self.salt_base64, 50000)
        assert result is False

    def test_backward_compatibility_with_legacy_iterations(self):
        """Test backward compatibility with legacy 10000 iterations"""
        # Hash with legacy iteration count
        legacy_hash = hash_password(self.password, self.salt, 10000)
        legacy_hash_base64 = base64.b64encode(legacy_hash).decode()

        # Should verify without specifying iterations (fallback to legacy)
        result = compare_password(self.password, legacy_hash_base64, self.salt_base64)
        assert result is True

    def test_should_support_high_iteration_counts(self):
        """Test support for modern high iteration counts"""
        # Test with OWASP recommended iteration count for 2024
        high_iterations = 600000
        password_hash = hash_password(self.password, self.salt, high_iterations)
        password_hash_base64 = base64.b64encode(password_hash).decode()

        result = compare_password(self.password, password_hash_base64, self.salt_base64, high_iterations)
        assert result is True

    def test_should_handle_explicit_iterations_without_fallback(self):
        """Test that explicit iterations bypass fallback logic"""
        hash_50k = hash_password(self.password, self.salt, 50000)
        hash_50k_base64 = base64.b64encode(hash_50k).decode()

        # With explicit iterations, should not fallback
        result = compare_password(self.password, hash_50k_base64, self.salt_base64, 50000)
        assert result is True

        # Wrong explicit iterations should fail
        result = compare_password(self.password, hash_50k_base64, self.salt_base64, 10000)
        assert result is False
