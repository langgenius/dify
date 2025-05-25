import json
from unittest.mock import patch, MagicMock

import pytest

# Assuming app_fixture.py is in the same directory or accessible via PYTHONPATH
# If app_fixture.py defines user_owner, user_normal etc., use them.
# For now, we'll create MagicMock users as needed within tests or use a generic mock_user.
from .app_fixture import mock_user as generic_mock_user_from_fixture 
# It's better to have specific mock users for roles if app_fixture provides them.
# e.g. from .app_fixture import mock_owner_user, mock_normal_user

from models.account import Tenant, TenantAccountRole 
# QuotaService will be mocked at the service layer, not imported directly unless needed for type hinting
# from services.quota_service import QuotaService 


# A basic mock user if specific ones are not available from app_fixture
def create_mock_user(role=TenantAccountRole.OWNER, tenant_id="test_tenant_id"):
    user = MagicMock()
    user.id = "test_user_id"
    user.current_tenant_id = tenant_id
    user.current_tenant = MagicMock(spec=Tenant)
    user.current_tenant.id = tenant_id
    # This role is on the TenantAccountJoin, not directly on Account.
    # The BillingService.is_tenant_owner_or_admin will query TenantAccountJoin.
    # So, for these tests, we might need to also patch BillingService.is_tenant_owner_or_admin
    # or ensure the test setup correctly creates these DB entries if not fully mocking.
    # For simplicity in this example, is_tenant_owner_or_admin will be patched.
    return user

mock_owner_user = create_mock_user(role=TenantAccountRole.OWNER)
mock_normal_user = create_mock_user(role=TenantAccountRole.NORMAL)


class TestBillingController:

    @patch('services.billing_service.BillingService.is_tenant_owner_or_admin', return_value=True)
    @patch('services.quota_service.QuotaService.get_quota_usage_summary')
    @patch('flask_login.utils._get_user')
    def test_get_quota_usage_summary_owner_success(self, mock_get_user, mock_get_quota_summary, mock_is_admin, app):
        mock_get_user.return_value = mock_owner_user # Simulate owner logged in
        
        sample_summary = {
            'limits': {'max_users': 10, 'max_apps': 5, 'max_datasets': 3, 'max_documents': 100, 'max_document_size_mb': 50, 'max_api_calls_per_day': 1000, 'max_api_calls_per_month': 10000},
            'usage': {'max_users': 1, 'max_apps': 2, 'max_datasets': 1, 'max_documents': 10, 'max_document_size_mb': 'N/A', 'max_api_calls_per_day': 'N/A', 'max_api_calls_per_month': 'N/A'}
        }
        mock_get_quota_summary.return_value = sample_summary

        with app.test_client() as client:
            response = client.get('/console/api/billing/quota/usage')

        assert response.status_code == 200
        response_data = json.loads(response.data.decode('utf-8'))
        assert response_data['limits'] == sample_summary['limits']
        assert response_data['usage'] == sample_summary['usage']
        mock_get_quota_summary.assert_called_once_with(mock_owner_user.current_tenant)
        mock_is_admin.assert_called_once_with(mock_owner_user)


    def test_get_quota_usage_summary_unauthenticated(self, app):
        with app.test_client() as client:
            response = client.get('/console/api/billing/quota/usage')
        # Should redirect to /login or return 401 if API
        # Based on typical Flask-Login behavior for @login_required,
        # it might redirect for browsers or return 401 for XHR.
        # Let's assume it's configured to return 401 for API endpoints.
        assert response.status_code == 401


    @patch('services.billing_service.BillingService.is_tenant_owner_or_admin', return_value=False)
    @patch('flask_login.utils._get_user')
    def test_get_quota_usage_summary_normal_user_forbidden(self, mock_get_user, mock_is_admin, app):
        mock_get_user.return_value = mock_normal_user # Simulate normal user logged in
        
        with app.test_client() as client:
            response = client.get('/console/api/billing/quota/usage')
        
        assert response.status_code == 403
        mock_is_admin.assert_called_once_with(mock_normal_user)

# Keep existing test if it's still relevant, or remove/move if it belongs elsewhere
# def test_post_requires_login(app):
#     with app.test_client() as client, patch("flask_login.utils._get_user", generic_mock_user_from_fixture):
#         response = client.get("/console/api/data-source/integrates")
#         assert response.status_code == 200
