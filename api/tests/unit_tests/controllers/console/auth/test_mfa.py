import json
import unittest
from unittest.mock import Mock, patch

from flask import Flask
from flask_restful import Api

from controllers.console.auth.mfa import MFADisableApi, MFASetupCompleteApi, MFASetupInitApi, MFAStatusApi, MFAVerifyApi
from models.account import Account


class TestMFAEndpoints(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config['TESTING'] = True
        self.api = Api(self.app)
        
        # Register endpoints (matching production paths)
        self.api.add_resource(MFASetupInitApi, '/account/mfa/setup')
        self.api.add_resource(MFASetupCompleteApi, '/account/mfa/setup/complete')
        self.api.add_resource(MFADisableApi, '/account/mfa/disable')
        self.api.add_resource(MFAStatusApi, '/account/mfa/status')
        self.api.add_resource(MFAVerifyApi, '/mfa/verify')
        
        self.client = self.app.test_client()
        
        # Mock account
        self.mock_account = Mock(spec=Account)
        self.mock_account.id = "test-account-id"
        self.mock_account.email = "test@example.com"

    @patch('controllers.console.auth.mfa.request')
    @patch('controllers.console.auth.mfa.MFAService.get_mfa_status')
    @patch('controllers.console.auth.mfa.MFAService.generate_mfa_setup_data')
    def test_mfa_setup_init_success(self, mock_generate_data, mock_get_status, mock_request):
        """Test successful MFA setup initialization."""
        # Mock authenticated user
        mock_request.current_user = self.mock_account
        
        # Mock MFA not enabled
        mock_get_status.return_value = {"enabled": False}
        
        # Mock setup data generation
        mock_generate_data.return_value = {
            "secret": "TESTSECRET123",
            "qr_code": "data:image/png;base64,test"
        }
        
        with patch('controllers.console.auth.mfa.login_required') as mock_login, \
             patch('controllers.console.auth.mfa.account_initialization_required') as mock_init:
            # Mock decorators to pass through
            mock_login.return_value = lambda f: f
            mock_init.return_value = lambda f: f
            
            response = self.client.post('/account/mfa/setup')
            
            self.assertEqual(response.status_code, 200)
            data = json.loads(response.data)
            self.assertEqual(data["secret"], "TESTSECRET123")
            self.assertEqual(data["qr_code"], "data:image/png;base64,test")

    @patch('controllers.console.auth.mfa.request')
    @patch('controllers.console.auth.mfa.MFAService.get_mfa_status')
    def test_mfa_setup_init_already_enabled(self, mock_get_status, mock_request):
        """Test MFA setup initialization when already enabled."""
        mock_request.current_user = self.mock_account
        mock_get_status.return_value = {"enabled": True}
        
        with patch('controllers.console.auth.mfa.login_required') as mock_login, \
             patch('controllers.console.auth.mfa.account_initialization_required') as mock_init:
            mock_login.return_value = lambda f: f
            mock_init.return_value = lambda f: f
            
            response = self.client.post('/account/mfa/setup')
            
            self.assertEqual(response.status_code, 400)
            data = json.loads(response.data)
            self.assertIn("already enabled", data["error"])

    @patch('controllers.console.auth.mfa.request')
    @patch('controllers.console.auth.mfa.db.session')
    @patch('controllers.console.auth.mfa.MFAService.setup_mfa')
    def test_mfa_setup_complete_success(self, mock_setup_mfa, mock_query, mock_request):
        """Test successful MFA setup completion."""
        mock_request.current_user.id = self.mock_account.id
        mock_query.filter_by.return_value.first.return_value = self.mock_account
        
        mock_setup_mfa.return_value = {
            "backup_codes": ["CODE1", "CODE2", "CODE3"],
            "setup_at": "2025-01-01T12:00:00"
        }
        
        with patch('controllers.console.auth.mfa.login_required') as mock_login, \
             patch('controllers.console.auth.mfa.account_initialization_required') as mock_init:
            mock_login.return_value = lambda f: f
            mock_init.return_value = lambda f: f
            
            response = self.client.post('/account/mfa/setup/complete', 
                                      json={"totp_token": "123456"})
            
            self.assertEqual(response.status_code, 200)
            data = json.loads(response.data)
            self.assertIn("success", data["message"])
            self.assertEqual(len(data["backup_codes"]), 3)

    @patch('controllers.console.auth.mfa.request')
    @patch('controllers.console.auth.mfa.db.session')
    @patch('controllers.console.auth.mfa.MFAService.setup_mfa')
    def test_mfa_setup_complete_invalid_token(self, mock_setup_mfa, mock_query, mock_request):
        """Test MFA setup completion with invalid token."""
        mock_request.current_user.id = self.mock_account.id
        mock_query.filter_by.return_value.first.return_value = self.mock_account
        
        mock_setup_mfa.side_effect = ValueError("Invalid TOTP token")
        
        with patch('controllers.console.auth.mfa.login_required') as mock_login, \
             patch('controllers.console.auth.mfa.account_initialization_required') as mock_init:
            mock_login.return_value = lambda f: f
            mock_init.return_value = lambda f: f
            
            response = self.client.post('/account/mfa/setup/complete', 
                                      json={"totp_token": "invalid"})
            
            self.assertEqual(response.status_code, 400)
            data = json.loads(response.data)
            self.assertIn("Invalid TOTP token", data["error"])

    def test_mfa_setup_complete_missing_token(self):
        """Test MFA setup completion without TOTP token."""
        with patch('controllers.console.auth.mfa.login_required') as mock_login, \
             patch('controllers.console.auth.mfa.account_initialization_required') as mock_init:
            mock_login.return_value = lambda f: f
            mock_init.return_value = lambda f: f
            
            response = self.client.post('/account/mfa/setup/complete', json={})
            
            self.assertEqual(response.status_code, 400)

    @patch('controllers.console.auth.mfa.request')
    @patch('controllers.console.auth.mfa.db.session')
    @patch('controllers.console.auth.mfa.MFAService.get_mfa_status')
    @patch('controllers.console.auth.mfa.MFAService.disable_mfa')
    def test_mfa_disable_success(self, mock_disable_mfa, mock_get_status, mock_query, mock_request):
        """Test successful MFA disable."""
        mock_request.current_user.id = self.mock_account.id
        mock_query.filter_by.return_value.first.return_value = self.mock_account
        mock_get_status.return_value = {"enabled": True}
        mock_disable_mfa.return_value = True
        
        with patch('controllers.console.auth.mfa.login_required') as mock_login, \
             patch('controllers.console.auth.mfa.account_initialization_required') as mock_init:
            mock_login.return_value = lambda f: f
            mock_init.return_value = lambda f: f
            
            response = self.client.post('/account/mfa/disable', 
                                      json={"password": "test_password"})
            
            self.assertEqual(response.status_code, 200)
            data = json.loads(response.data)
            self.assertIn("disabled successfully", data["message"])

    @patch('controllers.console.auth.mfa.request')
    @patch('controllers.console.auth.mfa.db.session')
    @patch('controllers.console.auth.mfa.MFAService.get_mfa_status')
    def test_mfa_disable_not_enabled(self, mock_get_status, mock_query, mock_request):
        """Test MFA disable when not enabled."""
        mock_request.current_user.id = self.mock_account.id
        mock_query.filter_by.return_value.first.return_value = self.mock_account
        mock_get_status.return_value = {"enabled": False}
        
        with patch('controllers.console.auth.mfa.login_required') as mock_login, \
             patch('controllers.console.auth.mfa.account_initialization_required') as mock_init:
            mock_login.return_value = lambda f: f
            mock_init.return_value = lambda f: f
            
            response = self.client.post('/account/mfa/disable', 
                                      json={"password": "test_password"})
            
            self.assertEqual(response.status_code, 400)
            data = json.loads(response.data)
            self.assertIn("not enabled", data["error"])

    @patch('controllers.console.auth.mfa.request')
    @patch('controllers.console.auth.mfa.db.session')
    @patch('controllers.console.auth.mfa.MFAService.get_mfa_status')
    @patch('controllers.console.auth.mfa.MFAService.disable_mfa')
    def test_mfa_disable_wrong_password(self, mock_disable_mfa, mock_get_status, mock_query, mock_request):
        """Test MFA disable with wrong password."""
        mock_request.current_user.id = self.mock_account.id
        mock_query.filter_by.return_value.first.return_value = self.mock_account
        mock_get_status.return_value = {"enabled": True}
        mock_disable_mfa.return_value = False
        
        with patch('controllers.console.auth.mfa.login_required') as mock_login, \
             patch('controllers.console.auth.mfa.account_initialization_required') as mock_init:
            mock_login.return_value = lambda f: f
            mock_init.return_value = lambda f: f
            
            response = self.client.post('/account/mfa/disable', 
                                      json={"password": "wrong_password"})
            
            self.assertEqual(response.status_code, 400)
            data = json.loads(response.data)
            self.assertIn("Invalid password", data["error"])

    @patch('controllers.console.auth.mfa.request')
    @patch('controllers.console.auth.mfa.db.session')
    @patch('controllers.console.auth.mfa.MFAService.get_mfa_status')
    def test_mfa_status_success(self, mock_get_status, mock_query, mock_request):
        """Test getting MFA status."""
        mock_request.current_user.id = self.mock_account.id
        mock_query.filter_by.return_value.first.return_value = self.mock_account
        
        expected_status = {
            "enabled": True,
            "setup_at": "2025-01-01T12:00:00",
            "has_backup_codes": True
        }
        mock_get_status.return_value = expected_status
        
        with patch('controllers.console.auth.mfa.login_required') as mock_login, \
             patch('controllers.console.auth.mfa.account_initialization_required') as mock_init:
            mock_login.return_value = lambda f: f
            mock_init.return_value = lambda f: f
            
            response = self.client.get('/account/mfa/status')
            
            self.assertEqual(response.status_code, 200)
            data = json.loads(response.data)
            self.assertEqual(data, expected_status)

    @patch('controllers.console.auth.mfa.db.session')
    @patch('controllers.console.auth.mfa.MFAService.is_mfa_required')
    @patch('controllers.console.auth.mfa.MFAService.authenticate_with_mfa')
    def test_mfa_verify_success(self, mock_auth_mfa, mock_is_required, mock_query):
        """Test successful MFA verification."""
        mock_query.filter_by.return_value.first.return_value = self.mock_account
        mock_is_required.return_value = True
        mock_auth_mfa.return_value = True
        
        response = self.client.post('/mfa/verify', 
                                  json={
                                      "email": "test@example.com",
                                      "mfa_token": "123456"
                                  })
        
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn("successful", data["message"])

    @patch('controllers.console.auth.mfa.db.session')
    def test_mfa_verify_account_not_found(self, mock_query):
        """Test MFA verification with non-existent account."""
        mock_query.filter_by.return_value.first.return_value = None
        
        response = self.client.post('/mfa/verify', 
                                  json={
                                      "email": "nonexistent@example.com",
                                      "mfa_token": "123456"
                                  })
        
        self.assertEqual(response.status_code, 404)
        data = json.loads(response.data)
        self.assertIn("not found", data["error"])

    @patch('controllers.console.auth.mfa.db.session')
    @patch('controllers.console.auth.mfa.MFAService.is_mfa_required')
    def test_mfa_verify_not_required(self, mock_is_required, mock_query):
        """Test MFA verification when MFA not required."""
        mock_query.filter_by.return_value.first.return_value = self.mock_account
        mock_is_required.return_value = False
        
        response = self.client.post('/mfa/verify', 
                                  json={
                                      "email": "test@example.com",
                                      "mfa_token": "123456"
                                  })
        
        self.assertEqual(response.status_code, 400)
        data = json.loads(response.data)
        self.assertIn("not required", data["error"])

    @patch('controllers.console.auth.mfa.db.session')
    @patch('controllers.console.auth.mfa.MFAService.is_mfa_required')
    @patch('controllers.console.auth.mfa.MFAService.authenticate_with_mfa')
    def test_mfa_verify_invalid_token(self, mock_auth_mfa, mock_is_required, mock_query):
        """Test MFA verification with invalid token."""
        mock_query.filter_by.return_value.first.return_value = self.mock_account
        mock_is_required.return_value = True
        mock_auth_mfa.return_value = False
        
        response = self.client.post('/mfa/verify', 
                                  json={
                                      "email": "test@example.com",
                                      "mfa_token": "invalid"
                                  })
        
        self.assertEqual(response.status_code, 400)
        data = json.loads(response.data)
        self.assertIn("Invalid MFA token", data["error"])

    def test_mfa_verify_missing_parameters(self):
        """Test MFA verification with missing parameters."""
        # Missing email
        response = self.client.post('/mfa/verify', 
                                  json={"mfa_token": "123456"})
        self.assertEqual(response.status_code, 400)
        
        # Missing mfa_token
        response = self.client.post('/mfa/verify', 
                                  json={"email": "test@example.com"})
        self.assertEqual(response.status_code, 400)
        
        # Missing both
        response = self.client.post('/mfa/verify', json={})
        self.assertEqual(response.status_code, 400)


if __name__ == '__main__':
    unittest.main()
