import enum
import json
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Mapped, mapped_column

from .engine import db
from .types import StringUUID


class OrganizationType(enum.StrEnum):
    SCHOOL = "school"
    UNIVERSITY = "university"
    COMPANY = "company"
    ORGANIZATION = "organization"


class Organization(db.Model):  # type: ignore[name-defined]
    """
    Organization model to represent schools or companies under a single tenant.
    This allows a single app provider (tenant) to serve multiple organizations
    with separate data and configurations.
    """

    __tablename__ = "organizations"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="organization_pkey"),
        db.Index("organization_tenant_id_idx", "tenant_id"),
        db.Index("organization_code_idx", "code"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)  # The owning tenant (app provider)
    name: Mapped[str] = mapped_column(db.String(255), nullable=False)
    code: Mapped[str] = mapped_column(db.String(64), nullable=False, unique=True)  # Unique code for the organization
    description: Mapped[str] = mapped_column(db.Text, nullable=True)
    type: Mapped[str] = mapped_column(db.String(64), nullable=False, default="school")
    logo: Mapped[str] = mapped_column(db.String(255), nullable=True)
    settings: Mapped[str] = mapped_column(db.Text, nullable=True)  # JSON settings
    status: Mapped[str] = mapped_column(
        db.String(16), nullable=False, server_default=db.text("'active'::character varying")
    )
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def settings_dict(self) -> dict:
        """Get organization settings as a dictionary"""
        return json.loads(self.settings) if self.settings else {}

    @settings_dict.setter
    def settings_dict(self, value: dict):
        """Set organization settings from a dictionary"""
        self.settings = json.dumps(value)

    @property
    def allowed_email_domains(self) -> list[str]:
        """Get list of allowed email domains for this organization"""
        settings = self.settings_dict
        return settings.get('allowed_email_domains', [])

    @allowed_email_domains.setter
    def allowed_email_domains(self, domains: list[str]):
        """Set allowed email domains for this organization"""
        settings = self.settings_dict
        settings['allowed_email_domains'] = domains
        self.settings_dict = settings

    @property
    def is_email_restricted(self) -> bool:
        """Check if organization restricts registration by email domain"""
        return len(self.allowed_email_domains) > 0

    def validate_email(self, email: str) -> bool:
        """Validate if an email is allowed for this organization"""
        if not self.is_email_restricted:
            return True

        email_domain = email.split('@')[-1].lower()
        return email_domain in self.allowed_email_domains

    @property
    def available_apps(self):
        """Get apps available for this organization"""
        app_access = (
            db.session.query(AppOrganizationAccess).filter(AppOrganizationAccess.organization_id == self.id).all()
        )

        if not app_access:
            return []

        from .model import App

        app_ids = [access.app_id for access in app_access]
        return db.session.query(App).filter(App.id.in_(app_ids)).all()


class OrganizationRole(enum.StrEnum):
    """Roles within an organization (school/company)"""

    ADMIN = "admin"  # Can manage the organization
    TEACHER = "teacher"  # For educational orgs
    STUDENT = "student"  # For educational orgs
    STAFF = "staff"  # General staff
    MANAGER = "manager"  # Department manager
    EMPLOYEE = "employee"  # Regular employee
    GUEST = "guest"  # Guest access

    @property
    def is_admin(self) -> bool:
        return self == OrganizationRole.ADMIN

    @property
    def is_staff(self) -> bool:
        return self in {
            OrganizationRole.ADMIN,
            OrganizationRole.TEACHER,
            OrganizationRole.STAFF,
            OrganizationRole.MANAGER,
        }


class OrganizationMember(db.Model):  # type: ignore[name-defined]
    """Represents membership of an account in an organization"""

    __tablename__ = "organization_members"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="organization_member_pkey"),
        db.Index("org_member_org_idx", "organization_id"),
        db.Index("org_member_account_idx", "account_id"),
        db.UniqueConstraint("organization_id", "account_id", name="unique_org_account"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    organization_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    role: Mapped[str] = mapped_column(db.String(64), nullable=False)
    department: Mapped[str] = mapped_column(db.String(255), nullable=True)
    title: Mapped[str] = mapped_column(db.String(255), nullable=True)
    is_default: Mapped[bool] = mapped_column(db.Boolean, nullable=False, server_default=db.text("false"))
    meta_data: Mapped[str] = mapped_column(db.Text, nullable=True)  # Additional metadata as JSON
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def metadata_dict(self) -> dict:
        """Get member metadata as a dictionary"""
        return json.loads(self.meta_data) if self.meta_data else {}

    @metadata_dict.setter
    def metadata_dict(self, value: dict):
        """Set member metadata from a dictionary"""
        self.meta_data = json.dumps(value)


class AppOrganizationAccess(db.Model):  # type: ignore[name-defined]
    """Controls which apps are accessible to which organizations"""

    __tablename__ = "app_organization_access"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="app_organization_access_pkey"),
        db.Index("app_org_access_app_idx", "app_id"),
        db.Index("app_org_access_org_idx", "organization_id"),
        db.UniqueConstraint("app_id", "organization_id", name="unique_app_organization"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    organization_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    permissions: Mapped[str] = mapped_column(db.Text, nullable=True)  # JSON permissions
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def permissions_dict(self) -> dict:
        """Get permissions as a dictionary"""
        return json.loads(self.permissions) if self.permissions else {}

    @permissions_dict.setter
    def permissions_dict(self, value: dict):
        """Set permissions from a dictionary"""
        self.permissions = json.dumps(value)
