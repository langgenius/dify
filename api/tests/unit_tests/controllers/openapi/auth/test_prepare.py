import uuid
from types import SimpleNamespace
from unittest.mock import PropertyMock, patch

import pytest
from flask import Flask
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound, Unauthorized

from controllers.openapi.auth.data import AuthData, ExternalIdentity
from controllers.openapi.auth.prepare import (
    load_account,
    load_app,
    load_app_access_mode,
    load_tenant,
    load_tenant_from_request,
    load_workspace_role,
    resolve_external_user,
)
from libs.oauth_bearer import TokenType
from models import Account, App, EndUser, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole, TenantStatus
from models.enums import AppStatus
from models.model import AppMode, IconType
from services import end_user_service
from services.enterprise.enterprise_service import WebAppAccessMode

APP_ID = "00000000-0000-0000-0000-000000000001"
TENANT_ID = "00000000-0000-0000-0000-000000000002"
ACCOUNT_ID = "00000000-0000-0000-0000-000000000003"


def _make_auth_data(**kwargs: object) -> AuthData:
    return AuthData(
        token_type=kwargs.pop("token_type", TokenType.OAUTH_ACCOUNT),
        token_hash=kwargs.pop("token_hash", "testhash"),
        scopes=kwargs.pop("scopes", frozenset()),
        **kwargs,
    )


def _app(
    *,
    app_id: str = APP_ID,
    tenant_id: str = TENANT_ID,
    enable_api: bool = True,
) -> App:
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name="OpenAPI app",
        description="",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#FFFFFF",
        status=AppStatus.NORMAL,
        enable_site=True,
        enable_api=enable_api,
        max_active_requests=None,
    )


def _tenant(*, tenant_id: str = TENANT_ID, status: TenantStatus = TenantStatus.NORMAL) -> Tenant:
    tenant = Tenant(name="OpenAPI tenant", status=status)
    tenant.id = tenant_id
    return tenant


def _account(*, status: AccountStatus = AccountStatus.ACTIVE) -> Account:
    account = Account(name="OpenAPI account", email="account@example.com", status=status)
    account.id = ACCOUNT_ID
    return account


def _persist(session: Session, *models: object) -> None:
    session.add_all(models)
    session.commit()


class TestLoadApp:
    def test_writes_persisted_app_to_data(self, sqlite_session: Session) -> None:
        _persist(sqlite_session, _app())
        data = _make_auth_data(path_params={"app_id": APP_ID})

        load_app(data)

        assert data.app is not None
        assert data.app.id == APP_ID

    def test_rejects_non_uuid_and_missing_app(self) -> None:
        with pytest.raises(NotFound, match="app not found"):
            load_app(_make_auth_data(path_params={"app_id": "not-a-uuid"}))
        with pytest.raises(NotFound, match="app not found"):
            load_app(_make_auth_data(path_params={"app_id": APP_ID}))

    def test_rejects_non_normal_app(self) -> None:
        app = _app()
        app.status = "archived"  # type: ignore[assignment]

        with (
            patch("controllers.openapi.auth.prepare.AppService.get_app_by_id", return_value=app),
            pytest.raises(NotFound, match="app not found"),
        ):
            load_app(_make_auth_data(path_params={"app_id": APP_ID}))

    def test_stashes_app_even_when_api_disabled(self, sqlite_session: Session) -> None:
        _persist(sqlite_session, _app(enable_api=False))
        data = _make_auth_data(path_params={"app_id": APP_ID})

        load_app(data)

        assert data.app is not None
        assert data.app.enable_api is False

    def test_skips_when_already_set(self) -> None:
        existing_app = _app()
        data = _make_auth_data(app=existing_app, path_params={"app_id": "invalid"})

        load_app(data)

        assert data.app is existing_app


class TestLoadTenant:
    def test_writes_persisted_tenant(self, sqlite_session: Session) -> None:
        app = _app()
        _persist(sqlite_session, app, _tenant())
        data = _make_auth_data(app=app)

        load_tenant(data)

        assert data.tenant is not None
        assert data.tenant.id == TENANT_ID

    def test_skips_when_already_set(self) -> None:
        tenant = _tenant()
        data = _make_auth_data(app=_app(), tenant=tenant)

        load_tenant(data)

        assert data.tenant is tenant

    @pytest.mark.parametrize("persist_archived", [True, False])
    def test_rejects_archived_or_missing_tenant(self, sqlite_session: Session, persist_archived: bool) -> None:
        app = _app()
        models: list[object] = [app]
        if persist_archived:
            models.append(_tenant(status=TenantStatus.ARCHIVE))
        _persist(sqlite_session, *models)

        with pytest.raises(Forbidden, match="workspace unavailable"):
            load_tenant(_make_auth_data(app=app))

    def test_rejects_missing_app_context(self) -> None:
        with pytest.raises(InternalServerError, match="app not loaded"):
            load_tenant(_make_auth_data())


class TestLoadAccount:
    def test_writes_persisted_caller(self, sqlite_session: Session) -> None:
        _persist(sqlite_session, _account())
        data = _make_auth_data(account_id=uuid.UUID(ACCOUNT_ID))

        load_account(data)

        assert data.caller is not None
        assert data.caller.id == ACCOUNT_ID
        assert data.caller_kind == "account"

    def test_sets_current_tenant_from_real_membership(self, sqlite_session: Session) -> None:
        account = _account()
        tenant = _tenant()
        membership = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            current=True,
            role=TenantAccountRole.ADMIN,
        )
        _persist(sqlite_session, account, tenant, membership)
        data = _make_auth_data(account_id=uuid.UUID(ACCOUNT_ID), tenant=tenant)

        load_account(data)

        assert isinstance(data.caller, Account)
        assert data.caller.current_tenant_id == TENANT_ID
        assert data.caller.role == TenantAccountRole.ADMIN

    def test_skips_when_caller_already_set(self) -> None:
        account = _account()
        data = _make_auth_data(account_id=uuid.UUID(ACCOUNT_ID), caller=account)

        load_account(data)

        assert data.caller is account

    def test_rejects_missing_account(self) -> None:
        with pytest.raises(Unauthorized, match="account not found"):
            load_account(_make_auth_data(account_id=uuid.UUID(ACCOUNT_ID)))


class TestResolveExternalUser:
    def test_persists_and_writes_end_user(
        self,
        sqlite_engine: Engine,
        sqlite_session: Session,
    ) -> None:
        app = _app()
        tenant = _tenant()
        _persist(sqlite_session, app, tenant)
        data = _make_auth_data(
            tenant=tenant,
            app=app,
            external_identity=ExternalIdentity(email="user@sso.com"),
        )

        with patch.object(type(end_user_service.db), "engine", new_callable=PropertyMock) as engine:
            engine.return_value = sqlite_engine
            resolve_external_user(data)

        assert isinstance(data.caller, EndUser)
        assert data.caller_kind == "end_user"
        with Session(sqlite_engine) as observer:
            persisted = observer.scalar(select(EndUser).where(EndUser.session_id == "user@sso.com"))
        assert persisted is not None
        assert persisted.tenant_id == TENANT_ID
        assert persisted.app_id == APP_ID

    def test_rejects_missing_context(self) -> None:
        data = _make_auth_data(app=_app(), external_identity=ExternalIdentity(email="u@s.com"))

        with pytest.raises(Unauthorized, match="missing context"):
            resolve_external_user(data)


class TestLoadAppAccessMode:
    def test_writes_mode(self) -> None:
        data = _make_auth_data(app=_app())
        settings = SimpleNamespace(access_mode="public")

        with patch(
            "controllers.openapi.auth.prepare.EnterpriseService.WebAppAuth.get_app_access_mode_by_id",
            return_value=settings,
        ):
            load_app_access_mode(data)

        assert data.app_access_mode == WebAppAccessMode.PUBLIC

    def test_writes_none_when_provider_raises(self) -> None:
        data = _make_auth_data(app=_app())
        with patch(
            "controllers.openapi.auth.prepare.EnterpriseService.WebAppAuth.get_app_access_mode_by_id",
            side_effect=ValueError("No data found."),
        ):
            load_app_access_mode(data)
        assert data.app_access_mode is None

    def test_noop_without_app(self) -> None:
        data = _make_auth_data()
        load_app_access_mode(data)
        assert data.app_access_mode is None


class TestLoadTenantFromRequest:
    def test_loads_from_path_or_query(
        self,
        app: Flask,
        sqlite_session: Session,
    ) -> None:
        _persist(sqlite_session, _tenant())
        for path_params, path in (({"workspace_id": TENANT_ID}, "/test"), ({}, f"/test?workspace_id={TENANT_ID}")):
            data = _make_auth_data(path_params=path_params)
            with app.test_request_context(path):
                load_tenant_from_request(data)
            assert data.tenant is not None
            assert data.tenant.id == TENANT_ID

    def test_skips_when_already_set(self, app: Flask) -> None:
        tenant = _tenant()
        data = _make_auth_data(tenant=tenant)
        with app.test_request_context("/test"):
            load_tenant_from_request(data)
        assert data.tenant is tenant

    def test_rejects_missing_or_invalid_id(self, app: Flask) -> None:
        for path_params in ({}, {"workspace_id": "not-a-uuid"}):
            with app.test_request_context("/test"), pytest.raises(NotFound, match="workspace not found"):
                load_tenant_from_request(_make_auth_data(path_params=path_params))

    @pytest.mark.parametrize("tenant_status", [None, TenantStatus.ARCHIVE])
    def test_rejects_missing_or_archived_tenant(
        self,
        app: Flask,
        sqlite_session: Session,
        tenant_status: TenantStatus | None,
    ) -> None:
        if tenant_status is not None:
            _persist(sqlite_session, _tenant(status=tenant_status))
        data = _make_auth_data(path_params={"workspace_id": TENANT_ID})

        with app.test_request_context("/test"), pytest.raises(NotFound, match="workspace not found"):
            load_tenant_from_request(data)


class TestLoadWorkspaceRole:
    def test_loads_real_membership_role(self, sqlite_session: Session) -> None:
        account = _account()
        tenant = _tenant()
        membership = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            current=True,
            role=TenantAccountRole.ADMIN,
        )
        _persist(sqlite_session, account, tenant, membership)
        data = _make_auth_data(
            account_id=uuid.UUID(ACCOUNT_ID),
            tenant=tenant,
            caller=account,
        )

        load_workspace_role(data)

        assert data.tenant_role == TenantAccountRole.ADMIN

    def test_none_when_not_member(self, sqlite_session: Session) -> None:
        account = _account()
        tenant = _tenant()
        _persist(sqlite_session, account, tenant)
        data = _make_auth_data(account_id=uuid.UUID(ACCOUNT_ID), tenant=tenant, caller=account)

        load_workspace_role(data)

        assert data.tenant_role is None

    def test_none_when_account_inactive(self) -> None:
        data = _make_auth_data(
            account_id=uuid.UUID(ACCOUNT_ID),
            tenant=_tenant(),
            caller=_account(status=AccountStatus.BANNED),
        )
        load_workspace_role(data)
        assert data.tenant_role is None

    def test_skips_when_already_set(self) -> None:
        data = _make_auth_data(
            account_id=uuid.UUID(ACCOUNT_ID),
            tenant=_tenant(),
            caller=_account(),
            tenant_role=TenantAccountRole.OWNER,
        )
        load_workspace_role(data)
        assert data.tenant_role == TenantAccountRole.OWNER

    @pytest.mark.parametrize(
        "data",
        [
            _make_auth_data(account_id=uuid.UUID(ACCOUNT_ID)),
            _make_auth_data(tenant=_tenant(), account_id=None),
        ],
    )
    def test_skips_without_tenant_or_account(self, data: AuthData) -> None:
        load_workspace_role(data)
        assert data.tenant_role is None
