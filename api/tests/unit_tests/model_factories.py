"""Builders for the model instances unit tests construct over and over.

Every builder returns a transient (unpersisted) instance carrying the field set
that most call sites need, so a test module only spells out the values it
actually asserts on. Keyword arguments map one-to-one onto model columns.
"""

from datetime import datetime

from models.account import Account, AccountStatus, Tenant, TenantAccountRole, TenantStatus
from models.enums import AppStatus, EndUserType
from models.model import App, AppMode, EndUser, IconType
from services.entities.account_entities import AccountSnapshot


def make_app(
    *,
    app_id: str = "app-1",
    tenant_id: str = "tenant-1",
    name: str = "Test App",
    description: str = "",
    mode: AppMode = AppMode.CHAT,
    icon_type: IconType | None = IconType.EMOJI,
    icon: str | None = "robot",
    icon_background: str | None = "#FFFFFF",
    status: AppStatus = AppStatus.NORMAL,
    app_model_config_id: str | None = None,
    workflow_id: str | None = None,
    enable_site: bool = True,
    enable_api: bool = True,
    api_rpm: int = 0,
    api_rph: int = 0,
    is_demo: bool = False,
    is_public: bool = False,
    is_universal: bool = False,
    max_active_requests: int | None = None,
    tracing: str | None = None,
    created_by: str | None = None,
    maintainer: str | None = None,
    use_icon_as_answer_icon: bool = False,
) -> App:
    """Build a transient ``App``.

    ``app_id`` is spelled out instead of ``id`` so call sites never shadow the
    builtin. ``icon_type=None`` clears ``icon`` and ``icon_background`` too, for
    the tests that assert on an app without icon metadata.
    """
    if icon_type is None:
        icon = None
        icon_background = None
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name=name,
        description=description,
        mode=mode,
        icon_type=icon_type,
        icon=icon,
        icon_background=icon_background,
        status=status,
        app_model_config_id=app_model_config_id,
        workflow_id=workflow_id,
        enable_site=enable_site,
        enable_api=enable_api,
        api_rpm=api_rpm,
        api_rph=api_rph,
        is_demo=is_demo,
        is_public=is_public,
        is_universal=is_universal,
        max_active_requests=max_active_requests,
        tracing=tracing,
        created_by=created_by,
        maintainer=maintainer,
        use_icon_as_answer_icon=use_icon_as_answer_icon,
    )


def make_account(
    *,
    account_id: str | None = "account-1",
    name: str = "Test User",
    email: str = "test@example.com",
    status: AccountStatus = AccountStatus.ACTIVE,
    interface_language: str | None = None,
    timezone: str | None = None,
    role: TenantAccountRole | None = None,
    tenant: Tenant | None = None,
) -> Account:
    """Build a transient ``Account``.

    ``id``, ``role`` and ``_current_tenant`` are ``init=False`` on the dataclass
    model, so they are assigned after construction. Passing ``account_id=None``
    keeps the generated identifier.
    """
    account = Account(
        name=name,
        email=email,
        status=status,
        interface_language=interface_language,
        timezone=timezone,
    )
    if account_id is not None:
        account.id = account_id
    account.role = role
    account._current_tenant = tenant
    return account


def make_tenant(
    *,
    tenant_id: str | None = "tenant-1",
    name: str = "Test Tenant",
    status: TenantStatus = TenantStatus.NORMAL,
    encrypt_public_key: str | None = None,
) -> Tenant:
    """Build a transient ``Tenant``; ``tenant_id=None`` keeps the generated one."""
    tenant = Tenant(name=name, status=status, encrypt_public_key=encrypt_public_key)
    if tenant_id is not None:
        tenant.id = tenant_id
    return tenant


def make_end_user(
    *,
    end_user_id: str = "end-user-1",
    tenant_id: str = "tenant-1",
    app_id: str | None = None,
    end_user_type: EndUserType = EndUserType.BROWSER,
    session_id: str = "session-1",
    external_user_id: str | None = None,
    name: str | None = None,
    is_anonymous: bool = True,
) -> EndUser:
    """Build a transient ``EndUser``."""
    return EndUser(
        id=end_user_id,
        tenant_id=tenant_id,
        app_id=app_id,
        type=end_user_type,
        session_id=session_id,
        external_user_id=external_user_id,
        name=name,
        is_anonymous=is_anonymous,
    )


def make_account_snapshot(
    *,
    account_id: str = "account-1",
    name: str = "Account",
    email: str = "account@example.com",
    avatar: str | None = None,
    is_password_set: bool = False,
    interface_language: str | None = "en-US",
    interface_theme: str | None = "light",
    timezone: str | None = "UTC",
    last_login_at: datetime | None = None,
    last_login_ip: str | None = None,
    status: str = "active",
    initialized_at: datetime | None = None,
    created_at: datetime = datetime(2026, 1, 1),
) -> AccountSnapshot:
    """Build the framework-neutral ``AccountSnapshot`` the account services return."""
    return AccountSnapshot(
        id=account_id,
        name=name,
        email=email,
        avatar=avatar,
        is_password_set=is_password_set,
        interface_language=interface_language,
        interface_theme=interface_theme,
        timezone=timezone,
        last_login_at=last_login_at,
        last_login_ip=last_login_ip,
        status=status,
        initialized_at=initialized_at,
        created_at=created_at,
    )


__all__ = [
    "make_account",
    "make_account_snapshot",
    "make_app",
    "make_end_user",
    "make_tenant",
]
