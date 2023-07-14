from extensions.ext_database import db
from models.account import Tenant
from models.provider import Provider, ProviderType, ProviderName


class WorkspaceService:
    @classmethod
    def get_tenant_info(cls, tenant: Tenant):
        tenant_info = {
            'id': tenant.id,
            'name': tenant.name,
            'plan': tenant.plan,
            'status': tenant.status,
            'created_at': tenant.created_at,
            'providers': [],
            'in_trail': False,
            'trial_end_reason': 'using_custom'
        }

        # Get providers
        providers = db.session.query(Provider).filter(
            Provider.tenant_id == tenant.id
        ).all()

        # Add providers to the tenant info
        tenant_info['providers'] = providers

        custom_provider = None
        system_provider = None

        for provider in providers:
            if provider.provider_type == ProviderType.CUSTOM.value:
                if provider.is_valid and provider.encrypted_config:
                    custom_provider = provider
            elif provider.provider_type == ProviderType.SYSTEM.value:
                if provider.provider_name == ProviderName.OPENAI.value and provider.is_valid:
                    system_provider = provider

        if system_provider and not custom_provider:
            quota_used = system_provider.quota_used if system_provider.quota_used is not None else 0
            quota_limit = system_provider.quota_limit if system_provider.quota_limit is not None else 0

            if quota_used >= quota_limit:
                tenant_info['trial_end_reason'] = 'trial_exceeded'
            else:
                tenant_info['in_trail'] = True
                tenant_info['trial_end_reason'] = None

        return tenant_info
