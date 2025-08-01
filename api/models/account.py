import enum
import json
from datetime import datetime
from typing import Optional, cast

from flask_login import UserMixin  # type: ignore
from sqlalchemy import DateTime, String, func, select
from sqlalchemy.orm import Mapped, mapped_column, reconstructor

from models.base import Base

from .engine import db
from .types import StringUUID


class TenantAccountRole(enum.StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    EDITOR = "editor"
    NORMAL = "normal"
    DATASET_OPERATOR = "dataset_operator"

    @staticmethod
    def is_valid_role(role: str) -> bool:
        if not role:
            return False
        return role in {
            TenantAccountRole.OWNER,
            TenantAccountRole.ADMIN,
            TenantAccountRole.EDITOR,
            TenantAccountRole.NORMAL,
            TenantAccountRole.DATASET_OPERATOR,
        }

    @staticmethod
    def is_privileged_role(role: Optional["TenantAccountRole"]) -> bool:
        if not role:
            return False
        return role in {TenantAccountRole.OWNER, TenantAccountRole.ADMIN}

    @staticmethod
    def is_admin_role(role: Optional["TenantAccountRole"]) -> bool:
        if not role:
            return False
        return role == TenantAccountRole.ADMIN

    @staticmethod
    def is_non_owner_role(role: Optional["TenantAccountRole"]) -> bool:
        if not role:
            return False
        return role in {
            TenantAccountRole.ADMIN,
            TenantAccountRole.EDITOR,
            TenantAccountRole.NORMAL,
            TenantAccountRole.DATASET_OPERATOR,
        }

    @staticmethod
    def is_editing_role(role: Optional["TenantAccountRole"]) -> bool:
        if not role:
            return False
        return role in {TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}

    @staticmethod
    def is_dataset_edit_role(role: Optional["TenantAccountRole"]) -> bool:
        if not role:
            return False
        return role in {
            TenantAccountRole.OWNER,
            TenantAccountRole.ADMIN,
            TenantAccountRole.EDITOR,
            TenantAccountRole.DATASET_OPERATOR,
        }


class AccountStatus(enum.StrEnum):
    PENDING = "pending"
    UNINITIALIZED = "uninitialized"
    ACTIVE = "active"
    BANNED = "banned"
    CLOSED = "closed"


class Account(UserMixin, Base):
    __tablename__ = "accounts"
    __table_args__ = (db.PrimaryKeyConstraint("id", name="account_pkey"), db.Index("account_email_idx", "email"))

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255))
    password: Mapped[Optional[str]] = mapped_column(String(255))
    password_salt: Mapped[Optional[str]] = mapped_column(String(255))
    avatar: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    interface_language: Mapped[Optional[str]] = mapped_column(String(255))
    interface_theme: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    timezone: Mapped[Optional[str]] = mapped_column(String(255))
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_login_ip: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    last_active_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)
    status: Mapped[str] = mapped_column(String(16), server_default=db.text("'active'::character varying"))
    initialized_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)

    @reconstructor
    def init_on_load(self):
        self.role: Optional[TenantAccountRole] = None
        self._current_tenant: Optional[Tenant] = None

    @property
    def is_password_set(self):
        return self.password is not None

    @property
    def current_tenant(self):
        return self._current_tenant

    @current_tenant.setter
    def current_tenant(self, tenant: "Tenant"):
        ta = db.session.scalar(select(TenantAccountJoin).filter_by(tenant_id=tenant.id, account_id=self.id).limit(1))
        if ta:
            self.role = TenantAccountRole(ta.role)
            self._current_tenant = tenant
            return
        self._current_tenant = None

    @property
    def current_tenant_id(self) -> str | None:
        return self._current_tenant.id if self._current_tenant else None

    def set_tenant_id(self, tenant_id: str):
        tenant_account_join = cast(
            tuple[Tenant, TenantAccountJoin],
            (
                db.session.query(Tenant, TenantAccountJoin)
                .where(Tenant.id == tenant_id)
                .where(TenantAccountJoin.tenant_id == Tenant.id)
                .where(TenantAccountJoin.account_id == self.id)
                .one_or_none()
            ),
        )

        if not tenant_account_join:
            return

        tenant, join = tenant_account_join
        self.role = TenantAccountRole(join.role)
        self._current_tenant = tenant

    @property
    def current_role(self):
        return self.role

    def get_status(self) -> AccountStatus:
        status_str = self.status
        return AccountStatus(status_str)

    @classmethod
    def get_by_openid(cls, provider: str, open_id: str):
        account_integrate = (
            db.session.query(AccountIntegrate)
            .where(AccountIntegrate.provider == provider, AccountIntegrate.open_id == open_id)
            .one_or_none()
        )
        if account_integrate:
            return db.session.query(Account).where(Account.id == account_integrate.account_id).one_or_none()
        return None

    # check current_user.current_tenant.current_role in ['admin', 'owner']
    @property
    def is_admin_or_owner(self):
        return TenantAccountRole.is_privileged_role(self.role)

    @property
    def is_admin(self):
        return TenantAccountRole.is_admin_role(self.role)

    @property
    def is_editor(self):
        return TenantAccountRole.is_editing_role(self.role)

    @property
    def is_dataset_editor(self):
        return TenantAccountRole.is_dataset_edit_role(self.role)

    @property
    def is_dataset_operator(self):
        return self.role == TenantAccountRole.DATASET_OPERATOR


class TenantStatus(enum.StrEnum):
    NORMAL = "normal"
    ARCHIVE = "archive"


class Tenant(Base):
    __tablename__ = "tenants"
    __table_args__ = (db.PrimaryKeyConstraint("id", name="tenant_pkey"),)

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    name: Mapped[str] = mapped_column(String(255))
    encrypt_public_key = db.Column(db.Text)
    plan: Mapped[str] = mapped_column(String(255), server_default=db.text("'basic'::character varying"))
    status: Mapped[str] = mapped_column(String(255), server_default=db.text("'normal'::character varying"))
    custom_config: Mapped[Optional[str]] = mapped_column(db.Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp())

    def get_accounts(self) -> list[Account]:
        return (
            db.session.query(Account)
            .where(Account.id == TenantAccountJoin.account_id, TenantAccountJoin.tenant_id == self.id)
            .all()
        )

    @property
    def custom_config_dict(self) -> dict:
        return json.loads(self.custom_config) if self.custom_config else {}

    @custom_config_dict.setter
    def custom_config_dict(self, value: dict):
        self.custom_config = json.dumps(value)


class TenantAccountJoin(Base):
    __tablename__ = "tenant_account_joins"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="tenant_account_join_pkey"),
        db.Index("tenant_account_join_account_id_idx", "account_id"),
        db.Index("tenant_account_join_tenant_id_idx", "tenant_id"),
        db.UniqueConstraint("tenant_id", "account_id", name="unique_tenant_account_join"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    account_id: Mapped[str] = mapped_column(StringUUID)
    current: Mapped[bool] = mapped_column(db.Boolean, server_default=db.text("false"))
    role: Mapped[str] = mapped_column(String(16), server_default="normal")
    invited_by: Mapped[Optional[str]] = mapped_column(StringUUID)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp())


class AccountIntegrate(Base):
    __tablename__ = "account_integrates"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="account_integrate_pkey"),
        db.UniqueConstraint("account_id", "provider", name="unique_account_provider"),
        db.UniqueConstraint("provider", "open_id", name="unique_provider_open_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    account_id: Mapped[str] = mapped_column(StringUUID)
    provider: Mapped[str] = mapped_column(String(16))
    open_id: Mapped[str] = mapped_column(String(255))
    encrypted_token: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.current_timestamp())


class InvitationCode(Base):
    __tablename__ = "invitation_codes"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="invitation_code_pkey"),
        db.Index("invitation_codes_batch_idx", "batch"),
        db.Index("invitation_codes_code_idx", "code", "status"),
    )

    id: Mapped[int] = mapped_column(db.Integer)
    batch: Mapped[str] = mapped_column(String(255))
    code: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), server_default=db.text("'unused'::character varying"))
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    used_by_tenant_id: Mapped[Optional[str]] = mapped_column(StringUUID)
    used_by_account_id: Mapped[Optional[str]] = mapped_column(StringUUID)
    deprecated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=db.text("CURRENT_TIMESTAMP(0)"))


class TenantPluginPermission(Base):
    class InstallPermission(enum.StrEnum):
        EVERYONE = "everyone"
        ADMINS = "admins"
        NOBODY = "noone"

    class DebugPermission(enum.StrEnum):
        EVERYONE = "everyone"
        ADMINS = "admins"
        NOBODY = "noone"

    __tablename__ = "account_plugin_permissions"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="account_plugin_permission_pkey"),
        db.UniqueConstraint("tenant_id", name="unique_tenant_plugin"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    install_permission: Mapped[InstallPermission] = mapped_column(String(16), nullable=False, server_default="everyone")
    debug_permission: Mapped[DebugPermission] = mapped_column(String(16), nullable=False, server_default="noone")


class TenantPluginAutoUpgradeStrategy(Base):
    class StrategySetting(enum.StrEnum):
        DISABLED = "disabled"
        FIX_ONLY = "fix_only"
        LATEST = "latest"

    class UpgradeMode(enum.StrEnum):
        ALL = "all"
        PARTIAL = "partial"
        EXCLUDE = "exclude"

    __tablename__ = "tenant_plugin_auto_upgrade_strategies"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="tenant_plugin_auto_upgrade_strategy_pkey"),
        db.UniqueConstraint("tenant_id", name="unique_tenant_plugin_auto_upgrade_strategy"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    strategy_setting: Mapped[StrategySetting] = mapped_column(String(16), nullable=False, server_default="fix_only")
    upgrade_time_of_day: Mapped[int] = mapped_column(db.Integer, nullable=False, default=0)  # seconds of the day
    upgrade_mode: Mapped[UpgradeMode] = mapped_column(String(16), nullable=False, server_default="exclude")
    exclude_plugins: Mapped[list[str]] = mapped_column(db.ARRAY(String(255)), nullable=False)  # plugin_id (author/name)
    include_plugins: Mapped[list[str]] = mapped_column(db.ARRAY(String(255)), nullable=False)  # plugin_id (author/name)
    created_at = db.Column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(DateTime, nullable=False, server_default=func.current_timestamp())
