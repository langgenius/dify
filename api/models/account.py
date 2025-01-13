import enum
import json

from flask_login import UserMixin  # type: ignore
from sqlalchemy import func
from sqlalchemy.orm import Mapped, mapped_column

from .engine import db
from .types import StringUUID


class AccountStatus(enum.StrEnum):
    PENDING = "pending"
    UNINITIALIZED = "uninitialized"
    ACTIVE = "active"
    BANNED = "banned"
    CLOSED = "closed"


class Account(UserMixin, db.Model):  # type: ignore[name-defined]
    __tablename__ = "accounts"
    __table_args__ = (db.PrimaryKeyConstraint("id", name="account_pkey"), db.Index("account_email_idx", "email"))

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
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
    last_active_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    status = db.Column(db.String(16), nullable=False, server_default=db.text("'active'::character varying"))
    initialized_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def is_password_set(self):
        return self.password is not None

    @property
    def current_tenant(self):
        # FIXME: fix the type error later, because the type is important maybe cause some bugs
        return self._current_tenant  # type: ignore

    @current_tenant.setter
    def current_tenant(self, value: "Tenant"):
        tenant = value
        ta = TenantAccountJoin.query.filter_by(tenant_id=tenant.id, account_id=self.id).first()
        if ta:
            tenant.current_role = ta.role
        else:
            # FIXME: fix the type error later, because the type is important maybe cause some bugs
            tenant = None  # type: ignore
        self._current_tenant = tenant

    @property
    def current_tenant_id(self) -> str | None:
        return self._current_tenant.id if self._current_tenant else None

    @current_tenant_id.setter
    def current_tenant_id(self, value: str):
        try:
            tenant_account_join = (
                db.session.query(Tenant, TenantAccountJoin)
                .filter(Tenant.id == value)
                .filter(TenantAccountJoin.tenant_id == Tenant.id)
                .filter(TenantAccountJoin.account_id == self.id)
                .one_or_none()
            )

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
    def get_by_openid(cls, provider: str, open_id: str):
        account_integrate = (
            db.session.query(AccountIntegrate)
            .filter(AccountIntegrate.provider == provider, AccountIntegrate.open_id == open_id)
            .one_or_none()
        )
        if account_integrate:
            return db.session.query(Account).filter(Account.id == account_integrate.account_id).one_or_none()
        return None

    @property
    def is_admin_or_owner(self):
        return TenantAccountRole.is_privileged_role(self._current_tenant.current_role)

    @property
    def is_admin(self):
        return TenantAccountRole.is_admin_role(self._current_tenant.current_role)

    @property
    def is_editor(self):
        return TenantAccountRole.is_editing_role(self._current_tenant.current_role)

    @property
    def is_dataset_editor(self):
        return TenantAccountRole.is_dataset_edit_role(self._current_tenant.current_role)

    @property
    def is_dataset_operator(self):
        return self._current_tenant.current_role == TenantAccountRole.DATASET_OPERATOR


class TenantStatus(enum.StrEnum):
    NORMAL = "normal"
    ARCHIVE = "archive"


class TenantAccountRole(enum.StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    EDITOR = "editor"
    NORMAL = "normal"
    DATASET_OPERATOR = "dataset_operator"

    @staticmethod
    def is_valid_role(role: str) -> bool:
        return role in {
            TenantAccountRole.OWNER,
            TenantAccountRole.ADMIN,
            TenantAccountRole.EDITOR,
            TenantAccountRole.NORMAL,
            TenantAccountRole.DATASET_OPERATOR,
        }

    @staticmethod
    def is_privileged_role(role: str) -> bool:
        return role in {TenantAccountRole.OWNER, TenantAccountRole.ADMIN}

    @staticmethod
    def is_admin_role(role: str) -> bool:
        return role == TenantAccountRole.ADMIN

    @staticmethod
    def is_non_owner_role(role: str) -> bool:
        return role in {
            TenantAccountRole.ADMIN,
            TenantAccountRole.EDITOR,
            TenantAccountRole.NORMAL,
            TenantAccountRole.DATASET_OPERATOR,
        }

    @staticmethod
    def is_editing_role(role: str) -> bool:
        return role in {TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}

    @staticmethod
    def is_dataset_edit_role(role: str) -> bool:
        return role in {
            TenantAccountRole.OWNER,
            TenantAccountRole.ADMIN,
            TenantAccountRole.EDITOR,
            TenantAccountRole.DATASET_OPERATOR,
        }


class Tenant(db.Model):  # type: ignore[name-defined]
    __tablename__ = "tenants"
    __table_args__ = (db.PrimaryKeyConstraint("id", name="tenant_pkey"),)

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    name = db.Column(db.String(255), nullable=False)
    encrypt_public_key = db.Column(db.Text)
    plan = db.Column(db.String(255), nullable=False, server_default=db.text("'basic'::character varying"))
    status = db.Column(db.String(255), nullable=False, server_default=db.text("'normal'::character varying"))
    custom_config = db.Column(db.Text)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    def get_accounts(self) -> list[Account]:
        return (
            db.session.query(Account)
            .filter(Account.id == TenantAccountJoin.account_id, TenantAccountJoin.tenant_id == self.id)
            .all()
        )

    @property
    def custom_config_dict(self) -> dict:
        return json.loads(self.custom_config) if self.custom_config else {}

    @custom_config_dict.setter
    def custom_config_dict(self, value: dict):
        self.custom_config = json.dumps(value)


class TenantAccountJoinRole(enum.Enum):
    OWNER = "owner"
    ADMIN = "admin"
    NORMAL = "normal"
    DATASET_OPERATOR = "dataset_operator"


class TenantAccountJoin(db.Model):  # type: ignore[name-defined]
    __tablename__ = "tenant_account_joins"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="tenant_account_join_pkey"),
        db.Index("tenant_account_join_account_id_idx", "account_id"),
        db.Index("tenant_account_join_tenant_id_idx", "tenant_id"),
        db.UniqueConstraint("tenant_id", "account_id", name="unique_tenant_account_join"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id = db.Column(StringUUID, nullable=False)
    account_id = db.Column(StringUUID, nullable=False)
    current = db.Column(db.Boolean, nullable=False, server_default=db.text("false"))
    role = db.Column(db.String(16), nullable=False, server_default="normal")
    invited_by = db.Column(StringUUID, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())


class AccountIntegrate(db.Model):  # type: ignore[name-defined]
    __tablename__ = "account_integrates"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="account_integrate_pkey"),
        db.UniqueConstraint("account_id", "provider", name="unique_account_provider"),
        db.UniqueConstraint("provider", "open_id", name="unique_provider_open_id"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    account_id = db.Column(StringUUID, nullable=False)
    provider = db.Column(db.String(16), nullable=False)
    open_id = db.Column(db.String(255), nullable=False)
    encrypted_token = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())


class InvitationCode(db.Model):  # type: ignore[name-defined]
    __tablename__ = "invitation_codes"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="invitation_code_pkey"),
        db.Index("invitation_codes_batch_idx", "batch"),
        db.Index("invitation_codes_code_idx", "code", "status"),
    )

    id = db.Column(db.Integer, nullable=False)
    batch = db.Column(db.String(255), nullable=False)
    code = db.Column(db.String(32), nullable=False)
    status = db.Column(db.String(16), nullable=False, server_default=db.text("'unused'::character varying"))
    used_at = db.Column(db.DateTime)
    used_by_tenant_id = db.Column(StringUUID)
    used_by_account_id = db.Column(StringUUID)
    deprecated_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
