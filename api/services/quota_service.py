from extensions.ext_database import db
from models.account import Tenant, TenantAccountJoin
from models.model import App
from models.dataset import Dataset, Document
from services.errors.quota import QuotaExceededError

class QuotaService:
    @staticmethod
    def get_tenant_quota(tenant: Tenant) -> dict:
        """
        Retrieves the tenant's quota information.
        """
        return tenant.quota

    @staticmethod
    def check_quota(tenant: Tenant, resource: str, current_usage: int) -> bool:
        """
        Checks if the tenant has exceeded the quota for the given resource.
        Returns True if quota is exceeded, False otherwise.
        """
        quota_info = tenant.quota
        resource_limit = quota_info.get(resource)

        if resource_limit is not None and current_usage >= resource_limit:
            return True  # Quota exceeded
        return False  # Quota not exceeded

    @staticmethod
    def handle_quota_overage(tenant: Tenant, resource: str):
        """
        Handles quota overages by raising a QuotaExceededError.
        """
        # Additional logic for handling quota overage can be added here in the future
        # For example, sending notifications, logging, etc.
        raise QuotaExceededError(resource=resource, message=f"Quota for resource '{resource}' exceeded for tenant {tenant.id}.")

    @staticmethod
    def get_quota_usage_summary(tenant: Tenant) -> dict:
        """
        Retrieves the tenant's quota limits and current usage for various resources.
        """
        quota_limits = tenant.quota

        # Calculate current usage
        current_users = db.session.query(TenantAccountJoin).filter(TenantAccountJoin.tenant_id == tenant.id).count()
        # Note: Document model might need to be specific to the tenant if not already filtered by dataset.tenant_id
        # Assuming Document table has a direct tenant_id or can be joined through Dataset.
        # For simplicity, let's assume Documents are implicitly tenant-specific via their Datasets.
        current_documents = db.session.query(Document).join(Dataset, Document.dataset_id == Dataset.id).filter(Dataset.tenant_id == tenant.id).count()
        current_apps = db.session.query(App).filter(App.tenant_id == tenant.id).count()
        current_datasets = db.session.query(Dataset).filter(Dataset.tenant_id == tenant.id).count()

        # max_document_size_mb and api calls are not directly counted here as they are usage metrics,
        # not simple counts of db entities. This summary focuses on countable entities.
        # These could be added if specific tracking mechanisms for them exist.

        usage = {
            "max_users": current_users,
            "max_documents": current_documents,
            "max_apps": current_apps,
            "max_datasets": current_datasets,
            # Placeholder for other usage metrics if they were to be counted
            "max_document_size_mb": "N/A (refer to individual document sizes)", # Or a sum if meaningful
            "max_api_calls_per_day": "N/A (tracked externally)",
            "max_api_calls_per_month": "N/A (tracked externally)",
        }

        return {
            "limits": quota_limits,
            "usage": usage
        }
