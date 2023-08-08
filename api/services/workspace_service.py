from extensions.ext_database import db
from models.account import Tenant
from models.provider import Provider


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
            'in_trial': True,
            'trial_end_reason': None
        }

        # Get providers
        providers = db.session.query(Provider).filter(
            Provider.tenant_id == tenant.id
        ).all()

        # Add providers to the tenant info
        tenant_info['providers'] = providers

        return tenant_info
