import pytest
from unittest.mock import patch

from services.account_service import AccountService
from services.mfa_service import MFAService


class TestMFAEndpoints:
    """Test MFA endpoints using integration test approach."""
    
    @pytest.fixture
    def auth_header(self, setup_account):
        """Get authentication header with JWT token."""
        token = AccountService.get_account_jwt_token(setup_account)
        return {"Authorization": f"Bearer {token}"}
    
    def test_mfa_status_success(self, test_client, setup_account, auth_header):
        """Test successful MFA status check."""
        with patch.object(MFAService, 'get_mfa_status') as mock_status:
            mock_status.return_value = {"enabled": False, "setup_at": None}
            
            response = test_client.get(
                '/console/api/account/mfa/status',
                headers=auth_header
            )
            
            assert response.status_code == 200
            data = response.json
            assert data["enabled"] is False
            assert data["setup_at"] is None
            mock_status.assert_called_once_with(setup_account)
    
    def test_mfa_setup_init_success(self, test_client, setup_account, auth_header):
        """Test successful MFA setup initialization."""
        with patch.object(MFAService, 'get_mfa_status') as mock_status:
            with patch.object(MFAService, 'generate_mfa_setup_data') as mock_generate:
                mock_status.return_value = {"enabled": False}
                mock_generate.return_value = {
                    "secret": "TEST_SECRET",
                    "qr_code": "data:image/png;base64,test"
                }
                
                response = test_client.post(
                    '/console/api/account/mfa/setup',
                    headers=auth_header
                )
                
                assert response.status_code == 200
                data = response.json
                assert data["secret"] == "TEST_SECRET"
                assert data["qr_code"] == "data:image/png;base64,test"
                mock_generate.assert_called_once_with(setup_account)
    
    def test_mfa_setup_init_already_enabled(self, test_client, setup_account, auth_header):
        """Test MFA setup initialization when already enabled."""
        with patch.object(MFAService, 'get_mfa_status') as mock_status:
            mock_status.return_value = {"enabled": True, "setup_at": "2024-01-01T00:00:00"}
            
            response = test_client.post(
                '/console/api/account/mfa/setup',
                headers=auth_header
            )
            
            assert response.status_code == 400
            data = response.json
            assert data["error"] == "MFA is already enabled"
    
    def test_mfa_setup_complete_success(self, test_client, setup_account, auth_header):
        """Test successful MFA setup completion."""
        with patch.object(MFAService, 'setup_mfa') as mock_setup:
            mock_setup.return_value = {
                "message": "MFA has been successfully enabled",
                "backup_codes": ["CODE1", "CODE2", "CODE3", "CODE4", "CODE5", "CODE6", "CODE7", "CODE8"],
                "setup_at": "2024-01-01T00:00:00"
            }
            
            response = test_client.post(
                '/console/api/account/mfa/setup/complete',
                headers=auth_header,
                json={"totp_token": "123456"}
            )
            
            assert response.status_code == 200
            data = response.json
            assert data["message"] == "MFA has been successfully enabled"
            assert len(data["backup_codes"]) == 8
            mock_setup.assert_called_once_with(setup_account, "123456")
    
    def test_mfa_setup_complete_missing_token(self, test_client, setup_account, auth_header):
        """Test MFA setup completion with missing token."""
        response = test_client.post(
            '/console/api/account/mfa/setup/complete',
            headers=auth_header,
            json={}
        )
        
        assert response.status_code == 400
        data = response.json
        assert "totp_token is required" in data["error"]
    
    def test_mfa_setup_complete_invalid_token(self, test_client, setup_account, auth_header):
        """Test MFA setup completion with invalid token."""
        with patch.object(MFAService, 'setup_mfa') as mock_setup:
            mock_setup.side_effect = ValueError("Invalid TOTP token")
            
            response = test_client.post(
                '/console/api/account/mfa/setup/complete',
                headers=auth_header,
                json={"totp_token": "999999"}
            )
            
            assert response.status_code == 400
            data = response.json
            assert "Invalid TOTP token" in data["error"]
    
    def test_mfa_disable_success(self, test_client, setup_account, auth_header):
        """Test successful MFA disable."""
        with patch.object(MFAService, 'disable_mfa') as mock_disable:
            mock_disable.return_value = {"message": "MFA has been disabled"}
            
            response = test_client.post(
                '/console/api/account/mfa/disable',
                headers=auth_header,
                json={"password": "test_password"}
            )
            
            assert response.status_code == 200
            data = response.json
            assert data["message"] == "MFA has been disabled"
            mock_disable.assert_called_once_with(setup_account, "test_password")
    
    def test_mfa_disable_wrong_password(self, test_client, setup_account, auth_header):
        """Test MFA disable with wrong password."""
        with patch.object(MFAService, 'disable_mfa') as mock_disable:
            mock_disable.side_effect = ValueError("Invalid password")
            
            response = test_client.post(
                '/console/api/account/mfa/disable',
                headers=auth_header,
                json={"password": "wrong_password"}
            )
            
            assert response.status_code == 400
            data = response.json
            assert "Invalid password" in data["error"]
    
    def test_mfa_disable_not_enabled(self, test_client, setup_account, auth_header):
        """Test MFA disable when not enabled."""
        with patch.object(MFAService, 'disable_mfa') as mock_disable:
            mock_disable.side_effect = ValueError("MFA is not enabled")
            
            response = test_client.post(
                '/console/api/account/mfa/disable',
                headers=auth_header,
                json={"password": "test_password"}
            )
            
            assert response.status_code == 400
            data = response.json
            assert "MFA is not enabled" in data["error"]
    
    def test_mfa_verify_success(self, test_client):
        """Test successful MFA verification during login."""
        with patch('services.account_service.AccountService.authenticate') as mock_auth:
            with patch.object(MFAService, 'is_mfa_required') as mock_required:
                with patch.object(MFAService, 'authenticate_with_mfa') as mock_verify:
                    # Mock user exists
                    from models.account import Account
                    mock_account = Account(
                        id="test-id",
                        email="test@example.com",
                        name="Test User"
                    )
                    mock_auth.return_value = mock_account
                    mock_required.return_value = True
                    mock_verify.return_value = True
                    
                    response = test_client.post(
                        '/console/api/mfa/verify',
                        json={
                            "email": "test@example.com",
                            "mfa_code": "123456",
                            "remember_me": True
                        }
                    )
                    
                    assert response.status_code == 200
                    data = response.json
                    assert data["result"] == "success"
    
    def test_mfa_verify_invalid_token(self, test_client):
        """Test MFA verification with invalid token."""
        with patch('services.account_service.AccountService.authenticate') as mock_auth:
            with patch.object(MFAService, 'is_mfa_required') as mock_required:
                with patch.object(MFAService, 'authenticate_with_mfa') as mock_verify:
                    # Mock user exists
                    from models.account import Account
                    mock_account = Account(
                        id="test-id",
                        email="test@example.com",
                        name="Test User"
                    )
                    mock_auth.return_value = mock_account
                    mock_required.return_value = True
                    mock_verify.return_value = False
                    
                    response = test_client.post(
                        '/console/api/mfa/verify',
                        json={
                            "email": "test@example.com",
                            "mfa_code": "999999",
                            "remember_me": True
                        }
                    )
                    
                    assert response.status_code == 200
                    data = response.json
                    assert data["result"] == "fail"
                    assert data["code"] == "mfa_token_invalid"
    
    def test_mfa_verify_not_required(self, test_client):
        """Test MFA verification when MFA is not required."""
        with patch('services.account_service.AccountService.authenticate') as mock_auth:
            with patch.object(MFAService, 'is_mfa_required') as mock_required:
                # Mock user exists
                from models.account import Account
                mock_account = Account(
                    id="test-id",
                    email="test@example.com",
                    name="Test User"
                )
                mock_auth.return_value = mock_account
                mock_required.return_value = False
                
                response = test_client.post(
                    '/console/api/mfa/verify',
                    json={
                        "email": "test@example.com",
                        "mfa_code": "123456",
                        "remember_me": True
                    }
                )
                
                assert response.status_code == 200
                data = response.json
                assert data["result"] == "fail"
                assert data["code"] == "mfa_not_required"
    
    def test_mfa_verify_account_not_found(self, test_client):
        """Test MFA verification with non-existent account."""
        with patch('services.account_service.AccountService.authenticate') as mock_auth:
            mock_auth.return_value = None
            
            response = test_client.post(
                '/console/api/mfa/verify',
                json={
                    "email": "nonexistent@example.com",
                    "mfa_code": "123456",
                    "remember_me": True
                }
            )
            
            assert response.status_code == 200
            data = response.json
            assert data["result"] == "fail"
            assert data["code"] == "mfa_verify_failed"