from models import Account
from extensions.ext_database import db
from services.account_service import RegisterService, AccountService, TenantService
from .decorator import initializer
from .admin import get_admin


@initializer(priority=1)
def init_admin_account():
    if db.session.query(Account).filter_by(name="admin").first():
        return
    
    registerService = RegisterService()
    registerService.setup("admin@apo.com", "admin", "APO2024@admin", "")


@initializer(priority=2)
def init_anonymous_account():
    if db.session.query(Account).filter_by(name="anonymous").first():
        return
    
    accountService = AccountService()
    anonymous = accountService.create_account("anonymous@apo.com", "anonymous", "en-US", "APO2024@anonymous", True)

    admin = get_admin()
    tenantService = TenantService()
    tenant = tenantService.get_current_tenant_by_account(admin)
    tenantService.create_tenant_member(tenant, anonymous)