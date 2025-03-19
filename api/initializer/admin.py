from extensions.ext_database import db
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole

def get_admin() -> Account:
    admin = db.session.query(Account).filter_by(name="admin").first()
    tenant_account_join = db.session.query(TenantAccountJoin).filter_by(account_id=admin.id, role=TenantAccountRole.OWNER).first()
    tenant = db.session.query(Tenant).filter_by(id=tenant_account_join.tenant_id).first()
    admin.current_tenant = tenant
    admin.current_tenant_id = tenant.id
    return admin
    