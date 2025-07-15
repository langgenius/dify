import json
from unittest import mock

from models.account import Account
from services.mfa_service import MFAService


class TestMFASimpleIntegration:
    """Simple integration tests for MFA functionality."""
    
    def test_mfa_setup_flow(self, test_client, setup_account, auth_header):
        """Test MFA setup flow end-to-end."""
        # Step 1: Check initial MFA status
        response = test_client.get(
            f"/console/api/account/mfa/status",
            headers=auth_header
        )
        assert response.status_code == 200
        data = response.json
        assert data["enabled"] is False
        
        # Step 2: Initialize MFA setup
        response = test_client.post(
            f"/console/api/account/mfa/setup",
            headers=auth_header
        )
        assert response.status_code == 200
        data = response.json
        assert "secret" in data
        assert "qr_code" in data
        secret = data["secret"]
        
        # Step 3: Complete MFA setup with mocked TOTP
        with mock.patch.object(MFAService, 'verify_totp', return_value=True):
            response = test_client.post(
                f"/console/api/account/mfa/setup/complete",
                headers=auth_header,
                json={"totp_token": "123456"}
            )
            assert response.status_code == 200
            data = response.json
            assert "backup_codes" in data
            assert len(data["backup_codes"]) == 8
        
        # Step 4: Verify MFA is now enabled
        response = test_client.get(
            f"/console/api/account/mfa/status",
            headers=auth_header
        )
        assert response.status_code == 200
        data = response.json
        assert data["enabled"] is True
    
    def test_mfa_disable_flow(self, test_client, setup_account, auth_header):
        """Test MFA disable flow."""
        # First check MFA status and disable if already enabled
        response = test_client.get(
            f"/console/api/account/mfa/status",
            headers=auth_header
        )
        assert response.status_code == 200
        data = response.json
        
        if data["enabled"]:
            # MFA is already enabled, disable it first with mocked password verification
            with mock.patch('libs.password.compare_password', return_value=True):
                response = test_client.post(
                    f"/console/api/account/mfa/disable",
                    headers=auth_header,
                    json={"password": "any_password"}  # Password doesn't matter, it's mocked
                )
                assert response.status_code == 200
        
        # Now set up MFA for the account
        with mock.patch.object(MFAService, 'verify_totp', return_value=True):
            # Initialize setup
            response = test_client.post(
                f"/console/api/account/mfa/setup",
                headers=auth_header
            )
            assert response.status_code == 200
            
            # Complete setup
            response = test_client.post(
                f"/console/api/account/mfa/setup/complete",
                headers=auth_header,
                json={"totp_token": "123456"}
            )
            assert response.status_code == 200
        
        # Now disable MFA with mocked password verification
        with mock.patch('libs.password.compare_password', return_value=True):
            response = test_client.post(
                f"/console/api/account/mfa/disable",
                headers=auth_header,
                json={"password": "any_password"}  # Password doesn't matter, it's mocked
            )
            assert response.status_code == 200
        data = response.json
        assert "disabled successfully" in data["message"]
        
        # Verify MFA is disabled
        response = test_client.get(
            f"/console/api/account/mfa/status",
            headers=auth_header
        )
        assert response.status_code == 200
        data = response.json
        assert data["enabled"] is False