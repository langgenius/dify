import hashlib
import json
import unittest
from datetime import datetime
from unittest.mock import Mock, patch

import pytest

from models.account import Account, AccountMFASettings
from services.mfa_service import MFAService


class TestMFAService(unittest.TestCase):
    def setUp(self):
        self.account = Mock(spec=Account)
        self.account.id = "test-account-id"
        self.account.email = "test@example.com"
        self.account.password = "hashed_password"
        self.account.password_salt = "salt"
        self.account.current_tenant_id = "test-tenant-id"

        self.mfa_settings = Mock(spec=AccountMFASettings)
        self.mfa_settings.account_id = self.account.id
        self.mfa_settings.enabled = False
        self.mfa_settings.secret = None
        self.mfa_settings.backup_codes = None
        self.mfa_settings.setup_at = None

    def test_generate_secret(self):
        """Test secret generation."""
        secret = MFAService.generate_secret()
        assert isinstance(secret, str)
        assert len(secret) == 32  # Base32 length

    def test_generate_backup_codes(self):
        """Test backup codes generation."""
        codes = MFAService.generate_backup_codes()
        assert len(codes) == 8
        for code in codes:
            assert isinstance(code, str)
            assert len(code) == 8  # 4 hex bytes = 8 chars

    @patch("pyotp.TOTP")
    def test_verify_totp_valid(self, mock_totp_class):
        """Test TOTP verification with valid token."""
        mock_totp = Mock()
        mock_totp.verify.return_value = True
        mock_totp_class.return_value = mock_totp

        result = MFAService.verify_totp("test_secret", "123456")

        assert result
        mock_totp.verify.assert_called_once_with("123456", valid_window=1)

    @patch("pyotp.TOTP")
    def test_verify_totp_invalid(self, mock_totp_class):
        """Test TOTP verification with invalid token."""
        mock_totp = Mock()
        mock_totp.verify.return_value = False
        mock_totp_class.return_value = mock_totp

        result = MFAService.verify_totp("test_secret", "invalid")

        assert not result

    def test_verify_totp_no_secret(self):
        """Test TOTP verification with no secret."""
        result = MFAService.verify_totp(None, "123456")
        assert not result

    @patch("services.mfa_service.db.session")
    def test_get_or_create_mfa_settings_existing(self, mock_session):
        """Test getting existing MFA settings."""
        mock_session.query.return_value.filter_by.return_value.first.return_value = self.mfa_settings

        result = MFAService.get_or_create_mfa_settings(self.account)

        assert result == self.mfa_settings
        mock_session.query.assert_called_once()

    @patch("services.mfa_service.db.session")
    def test_get_or_create_mfa_settings_new(self, mock_session):
        """Test creating new MFA settings."""
        mock_session.query.return_value.filter_by.return_value.first.return_value = None

        result = MFAService.get_or_create_mfa_settings(self.account)

        # Check that new settings were created
        assert isinstance(result, AccountMFASettings)
        assert result.account_id == self.account.id
        mock_session.add.assert_called_once()
        mock_session.commit.assert_called_once()

    @patch("services.mfa_service.db.session")
    def test_verify_backup_code_valid(self, mock_session):
        """Test backup code verification with valid code."""
        # Store hashed codes
        hash1 = hashlib.sha256(b"ABCD1234").hexdigest()
        hash2 = hashlib.sha256(b"EFGH5678").hexdigest()
        self.mfa_settings.backup_codes = json.dumps([hash1, hash2])

        result = MFAService.verify_backup_code(self.mfa_settings, "abcd1234")  # Test case insensitive

        assert result
        # Check that the code was removed (comparing hashes)
        remaining_codes = json.loads(self.mfa_settings.backup_codes)
        assert hash1 not in remaining_codes
        assert hash2 in remaining_codes
        mock_session.commit.assert_called_once()

    def test_verify_backup_code_invalid(self):
        """Test backup code verification with invalid code."""
        # Store hashed codes
        hash1 = hashlib.sha256(b"ABCD1234").hexdigest()
        hash2 = hashlib.sha256(b"EFGH5678").hexdigest()
        self.mfa_settings.backup_codes = json.dumps([hash1, hash2])

        result = MFAService.verify_backup_code(self.mfa_settings, "INVALID")

        assert not result

    def test_verify_backup_code_no_codes(self):
        """Test backup code verification with no backup codes."""
        self.mfa_settings.backup_codes = None

        result = MFAService.verify_backup_code(self.mfa_settings, "ABCD1234")

        assert not result

    @patch("services.mfa_service.MFAService.get_or_create_mfa_settings")
    @patch("services.mfa_service.MFAService.verify_totp")
    @patch("services.mfa_service.MFAService.generate_backup_codes")
    @patch("services.mfa_service.db.session")
    def test_setup_mfa_success(self, mock_session, mock_gen_codes, mock_verify, mock_get_settings):
        """Test successful MFA setup."""
        mock_get_settings.return_value = self.mfa_settings
        self.mfa_settings.secret = "test_secret"
        mock_verify.return_value = True
        mock_gen_codes.return_value = ["CODE1", "CODE2"]

        result = MFAService.setup_mfa(self.account, "123456")

        assert self.mfa_settings.enabled
        # Backup codes are now hashed
        hash1 = hashlib.sha256(b"CODE1").hexdigest()
        hash2 = hashlib.sha256(b"CODE2").hexdigest()
        assert self.mfa_settings.backup_codes == json.dumps([hash1, hash2])
        assert self.mfa_settings.setup_at is not None
        assert result["backup_codes"] == ["CODE1", "CODE2"]

    @patch("services.mfa_service.MFAService.get_or_create_mfa_settings")
    def test_setup_mfa_already_enabled(self, mock_get_settings):
        """Test MFA setup when already enabled."""
        self.mfa_settings.enabled = True
        mock_get_settings.return_value = self.mfa_settings

        with pytest.raises(ValueError) as context:
            MFAService.setup_mfa(self.account, "123456")

        assert "already enabled" in str(context.value)

    @patch("services.mfa_service.MFAService.get_or_create_mfa_settings")
    def test_setup_mfa_no_secret(self, mock_get_settings):
        """Test MFA setup without secret."""
        mock_get_settings.return_value = self.mfa_settings

        with pytest.raises(ValueError) as context:
            MFAService.setup_mfa(self.account, "123456")

        assert "secret not generated" in str(context.value)

    @patch("services.mfa_service.MFAService.get_or_create_mfa_settings")
    @patch("services.mfa_service.MFAService.verify_totp")
    def test_setup_mfa_invalid_token(self, mock_verify, mock_get_settings):
        """Test MFA setup with invalid TOTP token."""
        mock_get_settings.return_value = self.mfa_settings
        self.mfa_settings.secret = "test_secret"
        mock_verify.return_value = False

        with pytest.raises(ValueError) as context:
            MFAService.setup_mfa(self.account, "invalid")

        assert "Invalid TOTP token" in str(context.value)

    @patch("services.mfa_service.db.session")
    def test_is_mfa_required_enabled(self, mock_session):
        """Test MFA requirement check when enabled."""
        self.mfa_settings.enabled = True
        self.mfa_settings.secret = "test_secret"
        mock_session.query.return_value.filter_by.return_value.first.return_value = self.mfa_settings

        result = MFAService.is_mfa_required(self.account)

        assert result

    @patch("services.mfa_service.db.session")
    def test_is_mfa_required_disabled(self, mock_session):
        """Test MFA requirement check when disabled."""
        mock_session.query.return_value.filter_by.return_value.first.return_value = self.mfa_settings

        result = MFAService.is_mfa_required(self.account)

        assert not result

    @patch("services.mfa_service.db.session")
    def test_is_mfa_required_no_settings(self, mock_session):
        """Test MFA requirement check with no settings."""
        mock_session.query.return_value.filter_by.return_value.first.return_value = None

        result = MFAService.is_mfa_required(self.account)

        assert not result

    @patch("services.mfa_service.db.session")
    @patch("services.mfa_service.MFAService.verify_totp")
    @patch("services.mfa_service.MFAService.verify_backup_code")
    def test_authenticate_with_mfa_totp_success(self, mock_verify_backup, mock_verify_totp, mock_session):
        """Test MFA authentication with valid TOTP."""
        self.mfa_settings.enabled = True
        self.mfa_settings.secret = "test_secret"
        mock_session.query.return_value.filter_by.return_value.first.return_value = self.mfa_settings
        mock_verify_totp.return_value = True

        result = MFAService.authenticate_with_mfa(self.account, "123456")

        assert result
        mock_verify_totp.assert_called_once_with("test_secret", "123456", "test-tenant-id")
        mock_verify_backup.assert_not_called()

    @patch("services.mfa_service.db.session")
    @patch("services.mfa_service.MFAService.verify_totp")
    @patch("services.mfa_service.MFAService.verify_backup_code")
    def test_authenticate_with_mfa_backup_success(self, mock_verify_backup, mock_verify_totp, mock_session):
        """Test MFA authentication with valid backup code."""
        self.mfa_settings.enabled = True
        self.mfa_settings.secret = "test_secret"
        mock_session.query.return_value.filter_by.return_value.first.return_value = self.mfa_settings
        mock_verify_totp.return_value = False
        mock_verify_backup.return_value = True

        result = MFAService.authenticate_with_mfa(self.account, "BACKUP123")

        assert result
        mock_verify_totp.assert_called_once_with("test_secret", "BACKUP123", "test-tenant-id")
        mock_verify_backup.assert_called_once_with(self.mfa_settings, "BACKUP123")

    @patch("services.mfa_service.db.session")
    def test_authenticate_with_mfa_disabled(self, mock_session):
        """Test MFA authentication when disabled."""
        mock_session.query.return_value.filter_by.return_value.first.return_value = self.mfa_settings

        result = MFAService.authenticate_with_mfa(self.account, "123456")

        assert result

    @patch("services.mfa_service.db.session")
    def test_get_mfa_status_enabled(self, mock_session):
        """Test getting MFA status when enabled."""
        self.mfa_settings.enabled = True
        self.mfa_settings.setup_at = datetime(2025, 1, 1, 12, 0, 0)
        self.mfa_settings.backup_codes = json.dumps(["CODE1", "CODE2"])
        mock_session.query.return_value.filter_by.return_value.first.return_value = self.mfa_settings

        result = MFAService.get_mfa_status(self.account)

        expected = {"enabled": True, "setup_at": "2025-01-01T12:00:00", "has_backup_codes": True}
        assert result == expected

    @patch("services.mfa_service.db.session")
    def test_get_mfa_status_no_settings(self, mock_session):
        """Test getting MFA status with no settings."""
        mock_session.query.return_value.filter_by.return_value.first.return_value = None

        result = MFAService.get_mfa_status(self.account)

        expected = {"enabled": False, "setup_at": None, "has_backup_codes": False}
        assert result == expected

    @patch("qrcode.QRCode")
    @patch("pyotp.TOTP")
    def test_generate_qr_code(self, mock_totp_class, mock_qr_class):
        """Test QR code generation."""
        # Mock TOTP
        mock_totp = Mock()
        mock_totp.provisioning_uri.return_value = "otpauth://totp/test"
        mock_totp_class.return_value = mock_totp

        # Mock QR code
        mock_qr = Mock()
        mock_img = Mock()
        mock_qr.make_image.return_value = mock_img
        mock_qr_class.return_value = mock_qr

        # Mock image buffer
        with patch("io.BytesIO") as mock_buffer, patch("base64.b64encode") as mock_b64:
            mock_b64.return_value.decode.return_value = "base64data"

            result = MFAService.generate_qr_code(self.account, "test_secret")

            assert result == "data:image/png;base64,base64data"
            mock_totp.provisioning_uri.assert_called_once_with(name=self.account.email, issuer_name="Dify")

    @patch("libs.password.compare_password")
    @patch("services.mfa_service.db.session")
    def test_disable_mfa_success(self, mock_session, mock_compare_password):
        """Test successful MFA disable."""
        mock_compare_password.return_value = True
        mock_session.query.return_value.filter_by.return_value.first.return_value = self.mfa_settings

        result = MFAService.disable_mfa(self.account, "correct_password")

        assert result
        assert not self.mfa_settings.enabled
        assert self.mfa_settings.secret is None
        assert self.mfa_settings.backup_codes is None
        assert self.mfa_settings.setup_at is None
        mock_session.commit.assert_called_once()

    @patch("libs.password.compare_password")
    def test_disable_mfa_wrong_password(self, mock_compare_password):
        """Test MFA disable with wrong password."""
        mock_compare_password.return_value = False

        result = MFAService.disable_mfa(self.account, "wrong_password")

        assert not result

    @patch("libs.password.compare_password")
    @patch("services.mfa_service.db.session")
    def test_disable_mfa_no_settings(self, mock_session, mock_compare_password):
        """Test MFA disable when no settings exist."""
        mock_compare_password.return_value = True
        mock_session.query.return_value.filter_by.return_value.first.return_value = None

        result = MFAService.disable_mfa(self.account, "correct_password")

        assert result  # Already disabled

    @patch("services.mfa_service.encrypter")
    @patch("services.mfa_service.MFAService.get_or_create_mfa_settings")
    @patch("services.mfa_service.MFAService.generate_secret")
    @patch("services.mfa_service.MFAService.generate_qr_code")
    @patch("services.mfa_service.db.session")
    def test_generate_mfa_setup_data_success(
        self, mock_session, mock_gen_qr, mock_gen_secret, mock_get_settings, mock_encrypter
    ):
        """Test successful MFA setup data generation."""
        mock_get_settings.return_value = self.mfa_settings
        mock_gen_secret.return_value = "NEWSECRET123"
        mock_gen_qr.return_value = "data:image/png;base64,qrdata"
        mock_encrypter.encrypt_token.return_value = "ENCRYPTED_SECRET"

        result = MFAService.generate_mfa_setup_data(self.account)

        assert result["secret"] == "NEWSECRET123"
        assert result["qr_code"] == "data:image/png;base64,qrdata"
        assert self.mfa_settings.secret == "ENCRYPTED_SECRET"
        mock_encrypter.encrypt_token.assert_called_once_with("test-tenant-id", "NEWSECRET123")
        mock_session.commit.assert_called_once()

    @patch("services.mfa_service.MFAService.get_or_create_mfa_settings")
    def test_generate_mfa_setup_data_already_enabled(self, mock_get_settings):
        """Test MFA setup data generation when already enabled."""
        self.mfa_settings.enabled = True
        mock_get_settings.return_value = self.mfa_settings

        with pytest.raises(ValueError) as context:
            MFAService.generate_mfa_setup_data(self.account)

        assert "already enabled" in str(context.value)


if __name__ == "__main__":
    unittest.main()
