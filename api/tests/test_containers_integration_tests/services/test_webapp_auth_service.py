"""Integration coverage for the remaining WebAppAuthService responsibilities."""

import uuid

import pytest
from faker import Faker
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from models import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.enums import AppStatus, CustomizeTokenStrategy
from models.model import App, Site
from services.enterprise.enterprise_service import WebAppAccessMode
from services.webapp_auth_service import WebAppAuthService


def _create_account_and_tenant(session: Session) -> tuple[Account, Tenant]:
    fake = Faker()
    account = Account(
        email=f"test_{uuid.uuid4().hex[:8]}@example.com",
        name=fake.name(),
        interface_language="en-US",
        status=AccountStatus.ACTIVE,
    )
    tenant = Tenant(name=fake.company(), status=TenantStatus.NORMAL)
    session.add_all([account, tenant])
    session.flush()
    session.add(
        TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
    )
    session.commit()
    return account, tenant


def _create_app_and_site(session: Session, tenant: Tenant) -> tuple[App, Site]:
    fake = Faker()
    app = App(
        tenant_id=tenant.id,
        name=fake.company(),
        description=fake.text(max_nb_chars=100),
        mode="chat",
        icon_type="emoji",
        icon="🤖",
        icon_background="#FF6B6B",
        api_rph=100,
        api_rpm=10,
        enable_site=True,
        enable_api=True,
    )
    session.add(app)
    session.flush()
    site = Site(
        app_id=app.id,
        title=fake.company(),
        code=fake.unique.lexify(text="??????"),
        description=fake.text(max_nb_chars=100),
        default_language="en-US",
        status=AppStatus.NORMAL,
        customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
    )
    session.add(site)
    session.commit()
    return app, site


def test_create_end_user(db_session_with_containers: Session) -> None:
    _, tenant = _create_account_and_tenant(db_session_with_containers)
    app, site = _create_app_and_site(db_session_with_containers, tenant)

    result = WebAppAuthService.create_end_user(site.code, "test@example.com", db_session_with_containers)

    assert result.tenant_id == app.tenant_id
    assert result.app_id == app.id
    assert result.type == "browser"
    assert result.is_anonymous is False
    assert result.session_id == "test@example.com"


def test_create_end_user_rejects_unknown_site(db_session_with_containers: Session) -> None:
    with pytest.raises(NotFound, match="Site not found"):
        WebAppAuthService.create_end_user("missing", "test@example.com", db_session_with_containers)


@pytest.mark.parametrize(
    ("access_mode", "expected"),
    [
        pytest.param(WebAppAccessMode.PRIVATE, True, id="private"),
        pytest.param(WebAppAccessMode.PRIVATE_ALL, True, id="private-all"),
        pytest.param(WebAppAccessMode.PUBLIC, False, id="public"),
    ],
)
def test_permission_check_from_access_mode(
    db_session_with_containers: Session,
    access_mode: WebAppAccessMode,
    expected: bool,
) -> None:
    assert (
        WebAppAuthService.is_app_require_permission_check(
            access_mode=access_mode,
            session=db_session_with_containers,
        )
        is expected
    )


def test_permission_check_requires_a_reference(db_session_with_containers: Session) -> None:
    with pytest.raises(ValueError, match="Either app_code or app_id"):
        WebAppAuthService.is_app_require_permission_check(session=db_session_with_containers)
