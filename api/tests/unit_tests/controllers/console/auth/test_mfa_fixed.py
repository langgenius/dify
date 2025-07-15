import pytest
from unittest.mock import patch
from flask import Flask
from flask_login import LoginManager

from models.account import Account, AccountStatus
from extensions.ext_database import db
from services.mfa_service import MFAService


class TestMFAEndpointsFixed:
    """Test MFA endpoints using proper Flask test client approach."""
    
    @pytest.fixture
    def setup_flask_app(self, app):
        """Set up Flask app with proper login manager."""
        # This fixture uses the app from conftest which already has LoginManager configured
        return app
    
    @pytest.fixture
    def test_account(self, setup_flask_app):
        """Create a test account."""
        with setup_flask_app.app_context():
            account = Account(
                id="test-account-id",
                email="test@example.com",
                name="Test User",
                password="hashed_password",
                status=AccountStatus.ACTIVE.value,
                password_salt="salt"
            )
            db.session.add(account)
            db.session.commit()
            yield account
            # Cleanup
            db.session.delete(account)
            db.session.commit()
    
    @pytest.fixture
    def auth_headers(self, setup_flask_app, test_account):
        """Get authentication headers by simulating login."""
        with setup_flask_app.test_client() as client:
            # Mock the authentication to return our test account
            with patch('services.account_service.AccountService.authenticate') as mock_auth:
                mock_auth.return_value = test_account
                
                # Perform login to get token
                response = client.post('/console/api/login', json={
                    'email': test_account.email,
                    'password': 'test_password'
                })
                
                # Extract token from response
                token = response.json.get('data', {}).get('access_token')
                return {'Authorization': f'Bearer {token}'}
    
    def test_mfa_status_success(self, setup_flask_app, test_account, auth_headers):
        """Test successful MFA status check."""
        with setup_flask_app.test_client() as client:
            with setup_flask_app.app_context():
                # Mock the MFA service
                with patch.object(MFAService, 'get_mfa_status') as mock_status:
                    mock_status.return_value = {"enabled": False, "setup_at": None}
                    
                    response = client.get(
                        '/console/api/account/mfa/status',
                        headers=auth_headers
                    )
                    
                    assert response.status_code == 200
                    data = response.json
                    assert data["enabled"] is False
                    assert data["setup_at"] is None
    
    def test_mfa_setup_init_success(self, setup_flask_app, test_account, auth_headers):
        """Test successful MFA setup initialization."""
        with setup_flask_app.test_client() as client:
            with setup_flask_app.app_context():
                # Mock MFA service methods
                with patch.object(MFAService, 'get_mfa_status') as mock_status:
                    with patch.object(MFAService, 'generate_mfa_setup_data') as mock_generate:
                        mock_status.return_value = {"enabled": False}
                        mock_generate.return_value = {
                            "secret": "TEST_SECRET",
                            "qr_code": "data:image/png;base64,test"
                        }
                        
                        response = client.post(
                            '/console/api/account/mfa/setup',
                            headers=auth_headers
                        )
                        
                        assert response.status_code == 200
                        data = response.json
                        assert data["secret"] == "TEST_SECRET"
                        assert data["qr_code"] == "data:image/png;base64,test"
    
    def test_mfa_setup_complete_success(self, setup_flask_app, test_account, auth_headers):
        """Test successful MFA setup completion."""
        with setup_flask_app.test_client() as client:
            with setup_flask_app.app_context():
                # Mock MFA service
                with patch.object(MFAService, 'setup_mfa') as mock_setup:
                    mock_setup.return_value = {
                        "message": "MFA has been successfully enabled",
                        "backup_codes": ["CODE1", "CODE2", "CODE3", "CODE4", "CODE5", "CODE6", "CODE7", "CODE8"],
                        "setup_at": "2024-01-01T00:00:00"
                    }
                    
                    response = client.post(
                        '/console/api/account/mfa/setup/complete',
                        headers=auth_headers,
                        json={"totp_token": "123456"}
                    )
                    
                    assert response.status_code == 200
                    data = response.json
                    assert data["message"] == "MFA has been successfully enabled"
                    assert len(data["backup_codes"]) == 8
    
    def test_mfa_disable_success(self, setup_flask_app, test_account, auth_headers):
        """Test successful MFA disable."""
        with setup_flask_app.test_client() as client:
            with setup_flask_app.app_context():
                # Mock MFA service
                with patch.object(MFAService, 'disable_mfa') as mock_disable:
                    mock_disable.return_value = {"message": "MFA has been disabled"}
                    
                    response = client.post(
                        '/console/api/account/mfa/disable',
                        headers=auth_headers,
                        json={"password": "test_password"}
                    )
                    
                    assert response.status_code == 200
                    data = response.json
                    assert data["message"] == "MFA has been disabled"