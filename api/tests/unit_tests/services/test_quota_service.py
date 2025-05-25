import unittest
from unittest.mock import patch, MagicMock, PropertyMock

from extensions.ext_database import db # Needed for mocking db.session
from models.account import Tenant, TenantAccountJoin
from models.model import App
from models.dataset import Dataset, Document
from services.quota_service import QuotaService
from services.errors.quota import QuotaExceededError

class TestQuotaService(unittest.TestCase):

    def test_get_tenant_quota(self):
        mock_tenant = MagicMock(spec=Tenant)
        mock_quota_data = {"max_users": 10, "max_apps": 5}
        type(mock_tenant).quota = PropertyMock(return_value=mock_quota_data)

        result = QuotaService.get_tenant_quota(mock_tenant)
        self.assertEqual(result, mock_quota_data)

    def test_check_quota(self):
        mock_tenant = MagicMock(spec=Tenant)

        # Scenario 1: Quota not exceeded
        type(mock_tenant).quota = PropertyMock(return_value={"max_users": 10})
        self.assertFalse(QuotaService.check_quota(mock_tenant, "max_users", 5))

        # Scenario 2: Quota exceeded
        type(mock_tenant).quota = PropertyMock(return_value={"max_users": 10})
        self.assertTrue(QuotaService.check_quota(mock_tenant, "max_users", 10))
        self.assertTrue(QuotaService.check_quota(mock_tenant, "max_users", 11))
        
        # Scenario 3: Quota limit is None (unlimited)
        type(mock_tenant).quota = PropertyMock(return_value={"max_users": None})
        self.assertFalse(QuotaService.check_quota(mock_tenant, "max_users", 100))

        # Scenario 4: Unknown resource
        type(mock_tenant).quota = PropertyMock(return_value={"max_users": 10})
        self.assertFalse(QuotaService.check_quota(mock_tenant, "unknown_resource", 5))
        
        # Scenario 5: Resource limit is 0
        type(mock_tenant).quota = PropertyMock(return_value={"max_users": 0})
        self.assertTrue(QuotaService.check_quota(mock_tenant, "max_users", 0))
        self.assertTrue(QuotaService.check_quota(mock_tenant, "max_users", 1))

        # Scenario 6: Resource not in quota (should be treated as no limit / not enforced)
        type(mock_tenant).quota = PropertyMock(return_value={}) # empty dict
        self.assertFalse(QuotaService.check_quota(mock_tenant, "max_users", 10))


    def test_handle_quota_overage(self):
        mock_tenant = MagicMock(spec=Tenant)
        mock_tenant.id = "test_tenant_id"
        resource_name = "max_apps"

        with self.assertRaises(QuotaExceededError) as context:
            QuotaService.handle_quota_overage(mock_tenant, resource_name)
        
        self.assertEqual(context.exception.resource, resource_name)
        self.assertIn(resource_name, context.exception.message)
        self.assertIn(mock_tenant.id, context.exception.message)

    @patch('extensions.ext_database.db.session.query')
    def test_get_quota_usage_summary(self, mock_db_query):
        mock_tenant = MagicMock(spec=Tenant)
        mock_tenant.id = "tenant_123"
        mock_limits = {
            "max_users": 10,
            "max_documents": 100,
            "max_document_size_mb": 50,
            "max_api_calls_per_day": 1000,
            "max_api_calls_per_month": 10000,
            "max_apps": 5,
            "max_datasets": 3,
        }
        type(mock_tenant).quota = PropertyMock(return_value=mock_limits)

        # Mocking chain for db.session.query(...).filter(...).count()
        # Users count
        mock_query_users = MagicMock()
        mock_query_users.filter.return_value.count.return_value = 7
        
        # Documents count
        mock_query_documents = MagicMock()
        mock_query_documents.join.return_value.filter.return_value.count.return_value = 50
        
        # Apps count
        mock_query_apps = MagicMock()
        mock_query_apps.filter.return_value.count.return_value = 3
        
        # Datasets count
        mock_query_datasets = MagicMock()
        mock_query_datasets.filter.return_value.count.return_value = 2

        # Configure mock_db_query to return the correct mock based on the model
        def side_effect(model):
            if model == TenantAccountJoin:
                return mock_query_users
            elif model == Document:
                return mock_query_documents
            elif model == App:
                return mock_query_apps
            elif model == Dataset:
                return mock_query_datasets
            return MagicMock() # Default mock for any other queries

        mock_db_query.side_effect = side_effect
        
        summary = QuotaService.get_quota_usage_summary(mock_tenant)

        expected_usage = {
            "max_users": 7,
            "max_documents": 50,
            "max_apps": 3,
            "max_datasets": 2,
            "max_document_size_mb": "N/A (refer to individual document sizes)",
            "max_api_calls_per_day": "N/A (tracked externally)",
            "max_api_calls_per_month": "N/A (tracked externally)",
        }

        self.assertEqual(summary["limits"], mock_limits)
        self.assertEqual(summary["usage"], expected_usage)

        # Verify calls to db.session.query
        mock_db_query.assert_any_call(TenantAccountJoin)
        mock_query_users.filter.assert_called_with(TenantAccountJoin.tenant_id == mock_tenant.id)
        
        mock_db_query.assert_any_call(Document)
        mock_query_documents.join.assert_called_with(Dataset, Document.dataset_id == Dataset.id)
        mock_query_documents.join.return_value.filter.assert_called_with(Dataset.tenant_id == mock_tenant.id)
        
        mock_db_query.assert_any_call(App)
        mock_query_apps.filter.assert_called_with(App.tenant_id == mock_tenant.id)
        
        mock_db_query.assert_any_call(Dataset)
        mock_query_datasets.filter.assert_called_with(Dataset.tenant_id == mock_tenant.id)

if __name__ == '__main__':
    unittest.main()
