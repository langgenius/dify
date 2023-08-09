from flask_login import current_user
from extensions.ext_database import db
from models.account import Tenant, TenantAccountJoin
from models.provider import Provider


class WorkspaceService:
    @classmethod
    def get_tenant_info(cls, tenant: Tenant):
        if not tenant:
            return None
        tenant_info = {
            'id': tenant.id,
            'name': tenant.name,
            'plan': tenant.plan,
            'status': tenant.status,
            'created_at': tenant.created_at,
            'providers': [],
            'in_trail': True,
            'trial_end_reason': None,
            'role': 'normal',
        }

        # Get role of user
        tenant_account_join = db.session.query(TenantAccountJoin).filter(
            TenantAccountJoin.tenant_id == tenant.id,
            TenantAccountJoin.account_id == current_user.id
        ).first()
        tenant_info['role'] = tenant_account_join.role

        # Get providers
        providers = db.session.query(Provider).filter(
            Provider.tenant_id == tenant.id
        ).all()

        # Add providers to the tenant info
        tenant_info['providers'] = providers

        return tenant_info
