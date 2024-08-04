import enum
import json
from flask_login import UserMixin
from extensions.ext_database import db
from models import StringUUID


class AccountStatus(str, enum.Enum):
    PENDING = 'pending'
    UNINITIALIZED = 'uninitialized'
    ACTIVE = 'active'
    BANNED = 'banned'
    CLOSED = 'closed'


class Account(UserMixin, db.Model):
    __tablename__ = 'accounts'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='account_pkey'),
        db.Index('account_email_idx', 'email')
    )

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'))
    name = db.Column(db.String(255), nullable=False)
    email = db.Column(db.String(255), nullable=False)
    password = db.Column(db.String(255), nullable=True)
    password_salt = db.Column(db.String(255), nullable=True)
    avatar = db.Column(db.String(255))
    interface_language = db.Column(db.String(255))
    interface_theme = db.Column(db.String(255))
    timezone = db.Column(db.String(255))
    last_login_at = db.Column(db.DateTime)
    last_login_ip = db.Column(db.String(255))
    last_active_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    status = db.Column(db.String(16), nullable=False, server_default=db.text("'active'::character varying"))
    initialized_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))

    @property
    def is_password_set(self):
        return self.password is not None

    @property
    def current_tenant(self):
        return self._current_tenant

    @current_tenant.setter
    def current_tenant(self, value: "Tenant"):
        tenant = value
        ta = TenantAccountJoin.query.filter_by(tenant_id=tenant.id, account_id=self.id).first()
        if ta:
            tenant.current_role = ta.role
        else:
            tenant = None
        self._current_tenant = tenant

    @property
    def current_tenant_id(self):
        return self._current_tenant.id

    @current_tenant_id.setter
    def current_tenant_id(self, value: str):
        try:
            tenant_account_join = db.session.query(Tenant, TenantAccountJoin) \
                .filter(Tenant.id == value) \
                .filter(TenantAccountJoin.tenant_id == Tenant.id) \
                .filter(TenantAccountJoin.account_id == self.id) \
                .one_or_none()

            if tenant_account_join:
                tenant, ta = tenant_account_join
                tenant.current_role = ta.role
            else:
                tenant = None
        except:
            tenant = None

        self._current_tenant = tenant

    @property
    def current_role(self):
        return self._current_tenant.current_role

    def get_status(self) -> AccountStatus:
        status_str = self.status
        return AccountStatus(status_str)

    @classmethod
    def get_by_openid(cls, provider: str, open_id: str) -> db.Model:
        account_integrate = db.session.query(AccountIntegrate). \
            filter(AccountIntegrate.provider == provider, AccountIntegrate.open_id == open_id). \
            one_or_none()
        if account_integrate:
            return db.session.query(Account). \
                filter(Account.id == account_integrate.account_id). \
                one_or_none()
        return None

    def get_integrates(self) -> list[db.Model]:
        ai = db.Model
        return db.session.query(ai).filter(
            ai.account_id == self.id
        ).all()

    # check current_user.current_tenant.current_role in ['admin', 'owner']
    @property
    def is_admin_or_owner(self):
        return TenantAccountRole.is_privileged_role(self._current_tenant.current_role)

    @property
    def is_editor(self):
        return TenantAccountRole.is_editing_role(self._current_tenant.current_role)

    @property
    def is_dataset_editor(self):
        return TenantAccountRole.is_dataset_edit_role(self._current_tenant.current_role)

    @property
    def is_dataset_operator(self):
        return self._current_tenant.current_role == TenantAccountRole.DATASET_OPERATOR

class TenantStatus(str, enum.Enum):
    NORMAL = 'normal'
    ARCHIVE = 'archive'


class TenantAccountRole(str, enum.Enum):
    OWNER = 'owner'
    ADMIN = 'admin'
    EDITOR = 'editor'
    NORMAL = 'normal'
    DATASET_OPERATOR = 'dataset_operator'

    @staticmethod
    def is_valid_role(role: str) -> bool:
        return role and role in {TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR,
                                 TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR}

    @staticmethod
    def is_privileged_role(role: str) -> bool:
        return role and role in {TenantAccountRole.OWNER, TenantAccountRole.ADMIN}
    
    @staticmethod
    def is_non_owner_role(role: str) -> bool:
        return role and role in {TenantAccountRole.ADMIN, TenantAccountRole.EDITOR, TenantAccountRole.NORMAL,
                                 TenantAccountRole.DATASET_OPERATOR}
    
    @staticmethod
    def is_editing_role(role: str) -> bool:
        return role and role in {TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}

    @staticmethod
    def is_dataset_edit_role(role: str) -> bool:
        return role and role in {TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR,
                                 TenantAccountRole.DATASET_OPERATOR}

class Tenant(db.Model):
    __tablename__ = 'tenants'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='tenant_pkey'),
    )

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'))
    name = db.Column(db.String(255), nullable=False)
    encrypt_public_key = db.Column(db.Text)
    plan = db.Column(db.String(255), nullable=False, server_default=db.text("'sandbox'::character varying"))
    status = db.Column(db.String(255), nullable=False, server_default=db.text("'normal'::character varying"))
    custom_config = db.Column(db.Text)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    stripe_customer_id = db.Column(db.String(255), nullable=True)


    def get_accounts(self) -> list[Account]:
        return db.session.query(Account).filter(
            Account.id == TenantAccountJoin.account_id,
            TenantAccountJoin.tenant_id == self.id
        ).all()

    @property
    def custom_config_dict(self) -> dict:
        return json.loads(self.custom_config) if self.custom_config else {}

    @custom_config_dict.setter
    def custom_config_dict(self, value: dict):
        self.custom_config = json.dumps(value)


class TenantAccountJoinRole(enum.Enum):
    OWNER = 'owner'
    ADMIN = 'admin'
    NORMAL = 'normal'
    DATASET_OPERATOR = 'dataset_operator'


class TenantAccountJoin(db.Model):
    __tablename__ = 'tenant_account_joins'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='tenant_account_join_pkey'),
        db.Index('tenant_account_join_account_id_idx', 'account_id'),
        db.Index('tenant_account_join_tenant_id_idx', 'tenant_id'),
        db.UniqueConstraint('tenant_id', 'account_id', name='unique_tenant_account_join')
    )

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(StringUUID, nullable=False)
    account_id = db.Column(StringUUID, nullable=False)
    current = db.Column(db.Boolean, nullable=False, server_default=db.text('false'))
    role = db.Column(db.String(16), nullable=False, server_default='normal')
    invited_by = db.Column(StringUUID, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))


class AccountIntegrate(db.Model):
    __tablename__ = 'account_integrates'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='account_integrate_pkey'),
        db.UniqueConstraint('account_id', 'provider', name='unique_account_provider'),
        db.UniqueConstraint('provider', 'open_id', name='unique_provider_open_id')
    )

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'))
    account_id = db.Column(StringUUID, nullable=False)
    provider = db.Column(db.String(16), nullable=False)
    open_id = db.Column(db.String(255), nullable=False)
    encrypted_token = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))


class InvitationCode(db.Model):
    __tablename__ = 'invitation_codes'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='invitation_code_pkey'),
        db.Index('invitation_codes_batch_idx', 'batch'),
        db.Index('invitation_codes_code_idx', 'code', 'status')
    )

    id = db.Column(db.Integer, nullable=False)
    batch = db.Column(db.String(255), nullable=False)
    code = db.Column(db.String(32), nullable=False)
    status = db.Column(db.String(16), nullable=False, server_default=db.text("'unused'::character varying"))
    used_at = db.Column(db.DateTime)
    used_by_tenant_id = db.Column(StringUUID)
    used_by_account_id = db.Column(StringUUID)
    deprecated_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))




class PlanType(str, enum.Enum):
    SANDBOX = 'sandbox'
    PROFESSIONAL = 'professional'
    TEAM = 'team'
    CUSTOM = 'custom'

class SupportType(str, enum.Enum):
    COMMUNITY_FORUMS = 'community_forums'
    EMAIL_SUPPORT = 'email_support'
    PRIORITY_EMAIL_CHAT = 'priority_email_chat'

class ProcessingPriority(str, enum.Enum):
    STANDARD = 'standard'
    PRIORITY = 'priority'

    
class BasePlan(db.Model):
    __tablename__ = 'base_plans'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='base_plan_pkey'),
        db.UniqueConstraint('plan_type', name='unique_plan_type')
    )

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'))
    plan_type = db.Column(db.String(255), nullable=False , server_default=db.text("'sandbox'::character varying"))
    name = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text)
    stripe_product_id = db.Column(db.String(255), nullable=True)
    price_monthly = db.Column(db.Float, nullable=False)
    price_yearly = db.Column(db.Float, nullable=False)
    price_id_monthly = db.Column(db.String(255), nullable=False ) # stripe price id
    price_id_yearly = db.Column(db.String(255), nullable=False ) # stripe price id
    message_credits = db.Column(db.Integer, nullable=False)
    team_members = db.Column(db.Integer, nullable=False)
    build_apps = db.Column(db.Integer, nullable=False)
    vector_storage = db.Column(db.Integer, nullable=False)  # in MB
    documents_upload_quota = db.Column(db.Integer, nullable=False)
    documents_bulk_upload = db.Column(db.Boolean, nullable=False)
    document_processing_priority = db.Column(db.String(255), nullable=False , server_default=db.text("'standard'::character varying"))
    message_requests = db.Column(db.Integer, nullable=False)
    annotation_quota_limit = db.Column(db.Integer, nullable=False)
    logs_history = db.Column(db.Integer, nullable=False)  # in days
    custom_tools = db.Column(db.Integer, nullable=False)
    support = db.Column(db.String(255), nullable=False , server_default=db.text("'community_forums'::character varying"))
    custom_branding = db.Column(db.Boolean, nullable=False)  # for web app logo change
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    model_load_balancing_enabled = db.Column(db.Boolean, nullable=False, server_default=db.text('false'))
    dataset_operator_enabled = db.Column(db.Boolean, nullable=False, server_default=db.text('false'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))

    def __repr__(self):
        return f'<BasePlan {self.plan_type}>'

        
        
class PaymentStatus(str, enum.Enum):
    PENDING = 'pending'
    SUCCEEDED = 'succeeded'
    FAILED = 'failed'
    REFUNDED = 'refunded'




class PlanInterval(str, enum.Enum):
    MONTHLY = 'monthly'
    YEARLY = 'yearly'


class TenantPlan(db.Model):
    __tablename__ = 'tenant_plans'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='tenant_plan_pkey'),
        db.UniqueConstraint('tenant_id', 'base_plan_id', 'start_date', name='unique_tenant_plan')
    )

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(StringUUID, nullable=False)
    base_plan_id = db.Column(StringUUID, nullable=False)
    start_date = db.Column(db.DateTime, nullable=False)
    end_date = db.Column(db.DateTime, nullable=False)
    interval = db.Column(db.String(255), nullable=False , server_default=db.text("'monthly'::character varying"))
    is_active = db.Column(db.Boolean, nullable=False, default=True) # TODO : update this to false 
    discount = db.Column(db.Float, nullable=False, default=0.0)  # Percentage
    has_paid = db.Column(db.Boolean, nullable=False, default=False)
    amount = db.Column(db.Float, nullable=False, default=0.0)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))

    def __repr__(self):
        return f'<TenantPlan {self.tenant_id} - {self.base_plan_id}>'


class Transaction(db.Model):
    __tablename__ = 'transactions'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='transaction_pkey'),
    )

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(StringUUID, nullable=False)
    tenant_plan_id = db.Column(StringUUID, nullable=False)
    amount = db.Column(db.Float, nullable=False)
    currency = db.Column(db.String(3), nullable=False)
    status = db.Column(db.String(255), nullable=False , server_default=db.text("'pending'::character varying"))
    stripe_payment_intent_id = db.Column(db.String(255), nullable=True)
    stripe_customer_id = db.Column(db.String(255), nullable=True)
    stripe_payment_method_id = db.Column(db.String(255), nullable=True)
    stripe_invoice_id = db.Column(db.String(255), nullable=True)
    stripe_subscription_id = db.Column(db.String(255), nullable=True)
    payment_method_type = db.Column(db.String(50), nullable=True)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))

    def __repr__(self):
        return f'<Transaction {self.id} - {self.status}>'




class TenantCustomerId(db.Model):
    __tablename__ = 'tenant_customer_id'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='tenant_customer_id_pkey'),
        db.Index('tenant_customer_id_tenant_id_idx', 'tenant_id'),
        db.Index('tenant_customer_id_customer_id_idx', 'customer_id')
    )

    id = db.Column(StringUUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(StringUUID, nullable=False)
    customer_id = db.Column(StringUUID, nullable=False) # stripe customer id , used to send invoice
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))

    def __repr__(self):
        return f'<TenantCustomerId {self.id}>'