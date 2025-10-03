import hashlib
import json
import unittest
from unittest.mock import Mock, patch

import pytest

from models.account import Account, AccountMFASettings
from services.mfa_service import MFAService


class TestMFAServiceSecurity(unittest.TestCase):
    """Test MFA service security features including encryption and hashing."""

    def setUp(self):
        self.account = Mock(spec=Account)
        self.account.id = "test-account-id"
        self.account.email = "test@example.com"
        self.account.current_tenant_id = "test-tenant-id"

        self.mfa_settings = Mock(spec=AccountMFASettings)
        self.mfa_settings.account_id = self.account.id
        self.mfa_settings.enabled = False
        self.mfa_settings.secret = None
        self.mfa_settings.backup_codes = None
        self.mfa_settings.setup_at = None

    def test_hash_backup_code(self):
        """Test backup code hashing."""
        code = "ABCD1234"
        expected_hash = hashlib.sha256(code.upper().encode()).hexdigest()

        hashed = MFAService._hash_backup_code(code)

        assert hashed == expected_hash
        # Verify the hash is consistent
        assert hashed == MFAService._hash_backup_code(code.lower())

    @patch("services.mfa_service.encrypter.encrypt_token")
    @patch("services.mfa_service.MFAService.get_or_create_mfa_settings")
    @patch("services.mfa_service.MFAService.generate_qr_code")
    @patch("services.mfa_service.db.session")
    def test_generate_mfa_setup_data_encrypts_secret(
        self, mock_session, mock_generate_qr, mock_get_settings, mock_encrypt
    ):
        """Test that MFA setup encrypts the secret before storing."""
        mock_get_settings.return_value = self.mfa_settings
        mock_encrypt.return_value = "encrypted_secret"
        mock_generate_qr.return_value = "data:image/png;base64,fake_qr"

        result = MFAService.generate_mfa_setup_data(self.account)

        # Verify encryption was called with the tenant ID
        mock_encrypt.assert_called_once()
        call_args = mock_encrypt.call_args[0]
        assert call_args[0] == "test-tenant-id"  # tenant_id
        assert len(call_args[1]) == 32  # Base32 secret

        # Verify encrypted secret was stored
        assert self.mfa_settings.secret == "encrypted_secret"
        mock_session.commit.assert_called_once()

        # Verify plain secret is returned (for user display)
        assert "secret" in result
        assert result["secret"] != "encrypted_secret"  # Should be plain secret
        assert len(result["secret"]) == 32  # Base32 length

    @patch("services.mfa_service.encrypter.decrypt_token")
    @patch("pyotp.TOTP")
    def test_verify_totp_with_encryption(self, mock_totp_class, mock_decrypt):
        """Test TOTP verification with encrypted secret."""
        mock_decrypt.return_value = "decrypted_secret"
        mock_totp = Mock()
        mock_totp.verify.return_value = True
        mock_totp_class.return_value = mock_totp

        result = MFAService.verify_totp("encrypted_secret", "123456", "test-tenant-id")

        # Verify decryption was called
        mock_decrypt.assert_called_once_with("test-tenant-id", "encrypted_secret")
        # Verify TOTP was created with decrypted secret
        mock_totp_class.assert_called_once_with("decrypted_secret")
        assert result

    @patch("services.mfa_service.db.session")
    def test_verify_backup_code_with_hash(self, mock_session):
        """Test backup code verification with hashed storage."""
        # Pre-hashed backup codes
        hashed_codes = [
            MFAService._hash_backup_code("CODE1234"),
            MFAService._hash_backup_code("CODE5678"),
        ]
        self.mfa_settings.backup_codes = json.dumps(hashed_codes)

        # Test valid code
        result = MFAService.verify_backup_code(self.mfa_settings, "code1234")  # Test case insensitive

        assert result
        # Verify the code was removed
        remaining = json.loads(self.mfa_settings.backup_codes)
        assert len(remaining) == 1
        assert MFAService._hash_backup_code("CODE1234") not in remaining

    @patch("services.mfa_service.db.session")
    def test_verify_backup_code_invalid_with_hash(self, mock_session):
        """Test backup code verification fails with wrong code."""
        hashed_codes = [
            MFAService._hash_backup_code("CODE1234"),
            MFAService._hash_backup_code("CODE5678"),
        ]
        self.mfa_settings.backup_codes = json.dumps(hashed_codes)

        result = MFAService.verify_backup_code(self.mfa_settings, "WRONGCODE")

        assert not result
        # Verify no codes were removed
        remaining = json.loads(self.mfa_settings.backup_codes)
        assert len(remaining) == 2

    @patch("services.mfa_service.encrypter.decrypt_token")
    @patch("services.mfa_service.MFAService.get_or_create_mfa_settings")
    @patch("pyotp.TOTP")
    @patch("services.mfa_service.MFAService.generate_backup_codes")
    @patch("services.mfa_service.db.session")
    def test_setup_mfa_with_security_features(
        self, mock_session, mock_gen_codes, mock_totp_class, mock_get_settings, mock_decrypt
    ):
        """Test MFA setup with both encryption and hashing."""
        mock_get_settings.return_value = self.mfa_settings
        self.mfa_settings.secret = "encrypted_secret"

        # Setup decryption
        mock_decrypt.return_value = "decrypted_secret"

        # Setup TOTP verification
        mock_totp = Mock()
        mock_totp.verify.return_value = True
        mock_totp_class.return_value = mock_totp

        # Setup backup codes
        mock_gen_codes.return_value = ["CODE1", "CODE2", "CODE3"]

        result = MFAService.setup_mfa(self.account, "123456")

        # Verify secret was decrypted for verification
        mock_decrypt.assert_called_once_with("test-tenant-id", "encrypted_secret")

        # Verify backup codes were hashed before storage
        stored_codes = json.loads(self.mfa_settings.backup_codes)
        assert len(stored_codes) == 3
        assert stored_codes[0] == MFAService._hash_backup_code("CODE1")
        assert stored_codes[1] == MFAService._hash_backup_code("CODE2")
        assert stored_codes[2] == MFAService._hash_backup_code("CODE3")

        # Verify plain codes are returned to user
        assert result["backup_codes"] == ["CODE1", "CODE2", "CODE3"]

    @patch("services.mfa_service.encrypter.decrypt_token")
    @patch("services.mfa_service.db.session")
    @patch("pyotp.TOTP")
    def test_authenticate_with_mfa_encrypted(self, mock_totp_class, mock_session, mock_decrypt):
        """Test authentication with encrypted MFA secret."""
        self.mfa_settings.enabled = True
        self.mfa_settings.secret = "encrypted_secret"
        self.mfa_settings.backup_codes = json.dumps([])

        mock_session.query.return_value.filter_by.return_value.first.return_value = self.mfa_settings
        mock_decrypt.return_value = "decrypted_secret"

        mock_totp = Mock()
        mock_totp.verify.return_value = True
        mock_totp_class.return_value = mock_totp

        result = MFAService.authenticate_with_mfa(self.account, "123456")

        assert result
        mock_decrypt.assert_called_once_with("test-tenant-id", "encrypted_secret")

    def test_no_tenant_id_raises_error(self):
        """Test that operations fail gracefully when no tenant ID is available."""
        self.account.current_tenant_id = None

        with patch("services.mfa_service.MFAService.get_or_create_mfa_settings") as mock_get_settings:
            mock_get_settings.return_value = self.mfa_settings

            with pytest.raises(ValueError) as context:
                MFAService.generate_mfa_setup_data(self.account)

            assert "No tenant associated" in str(context.value)
