"""SQLite-backed tests for account invitation and activation flows."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from unittest.mock import ANY, Mock, patch

import pytest
from flask import Flask
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from controllers.console.auth import activate as activate_module
from controllers.console.auth.activate import ActivateApi, ActivateCheckApi
from controllers.console.auth.error import InvitationAccountMismatchError
from controllers.console.error import AccountInFreezeError, AlreadyActivateError
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.base import TypeBase


@dataclass(frozen=True)
class Database:
    """Typed SQLite binding matching Flask-SQLAlchemy's callable session API."""

    engine: Engine
    session: scoped_session[Session]


@pytest.fixture
def database(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[Database]:
    TypeBase.metadata.create_all(
        sqlite_engine,
        tables=[Account.__table__, Tenant.__table__, TenantAccountJoin.__table__],
    )
    session_registry = scoped_session(sessionmaker(bind=sqlite_engine, expire_on_commit=False))
    database = Database(engine=sqlite_engine, session=session_registry)
    monkeypatch.setattr(activate_module, "db", database)
    try:
        yield database
    finally:
        session_registry.remove()


@pytest.fixture
def app(database: Database) -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def invitation(database: Database) -> dict[str, object]:
    session = database.session()
    account = Account(name="Invited user", email="invitee@example.com", status=AccountStatus.PENDING)
    account.id = "account-123"
    tenant = Tenant(name="Test Workspace")
    tenant.id = "workspace-123"
    session.add_all([account, tenant])
    session.commit()
    return {
        "data": {"email": account.email},
        "tenant": tenant,
        "account": account,
    }


@pytest.fixture
def switch_tenant(monkeypatch: pytest.MonkeyPatch) -> Mock:
    switch = Mock()
    monkeypatch.setattr(activate_module.TenantService, "switch_tenant", switch)
    return switch


def _post(app: Flask, payload: dict[str, object]) -> dict[str, str]:
    with app.test_request_context("/activate", method="POST", json=payload):
        return ActivateApi().post()


def _setup_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "workspace_id": "workspace-123",
        "email": "invitee@example.com",
        "token": "valid_token",
        "name": "John Doe",
        "interface_language": "en-US",
        "timezone": "UTC",
    }
    payload.update(overrides)
    return payload


class TestActivateCheckApi:
    def test_check_valid_invitation_token(self, app: Flask, invitation: dict[str, object]) -> None:
        with (
            patch.object(
                activate_module.RegisterService,
                "get_invitation_with_case_fallback",
                return_value=invitation,
            ),
            app.test_request_context(
                "/activate/check?workspace_id=workspace-123&email=invitee@example.com&token=valid_token"
            ),
        ):
            response = ActivateCheckApi().get()

        assert response["is_valid"] is True
        assert response["data"]["workspace_name"] == "Test Workspace"
        assert response["data"]["workspace_id"] == "workspace-123"
        assert response["data"]["email"] == "invitee@example.com"

    def test_check_includes_persisted_account_status(self, app: Flask, invitation: dict[str, object]) -> None:
        account = invitation["account"]
        assert isinstance(account, Account)
        account.status = AccountStatus.ACTIVE

        with (
            patch.object(
                activate_module.RegisterService,
                "get_invitation_with_case_fallback",
                return_value=invitation,
            ),
            app.test_request_context("/activate/check?email=invitee@example.com&token=valid_token"),
        ):
            response = ActivateCheckApi().get()

        assert response["data"]["account_status"] == AccountStatus.ACTIVE
        assert response["data"]["requires_setup"] is False

    def test_check_invalid_invitation_token(self, app: Flask) -> None:
        with (
            patch.object(
                activate_module.RegisterService,
                "get_invitation_with_case_fallback",
                return_value=None,
            ),
            app.test_request_context("/activate/check?email=test@example.com&token=invalid_token"),
        ):
            assert ActivateCheckApi().get() == {"is_valid": False}

    @pytest.mark.parametrize(
        ("query", "workspace_id", "email"),
        [
            ("email=invitee@example.com&token=valid_token", None, "invitee@example.com"),
            ("workspace_id=workspace-123&token=valid_token", "workspace-123", None),
            (
                "workspace_id=workspace-123&email=Invitee@Example.com&token=valid_token",
                "workspace-123",
                "Invitee@Example.com",
            ),
        ],
    )
    def test_check_forwards_optional_lookup_fields(
        self,
        app: Flask,
        invitation: dict[str, object],
        query: str,
        workspace_id: str | None,
        email: str | None,
    ) -> None:
        with (
            patch.object(
                activate_module.RegisterService,
                "get_invitation_with_case_fallback",
                return_value=invitation,
            ) as lookup,
            app.test_request_context(f"/activate/check?{query}"),
        ):
            assert ActivateCheckApi().get()["is_valid"] is True

        lookup.assert_called_once_with(workspace_id, email, "valid_token", session=ANY)
        assert isinstance(lookup.call_args.kwargs["session"], Session)


class TestActivateApi:
    def test_activation_rejects_invitation_for_different_authenticated_account(
        self,
        database: Database,
        app: Flask,
        invitation: dict[str, object],
        switch_tenant: Mock,
    ) -> None:
        """A logged-in account cannot consume another account's invitation token."""
        invited_account = invitation["account"]
        assert isinstance(invited_account, Account)
        invited_account.status = AccountStatus.ACTIVE
        data = invitation["data"]
        assert isinstance(data, dict)
        data["requires_setup"] = False
        database.session().commit()
        current_account = Mock(id="current-account-id")

        with (
            patch.object(
                activate_module.RegisterService,
                "get_invitation_with_case_fallback",
                return_value=invitation,
            ),
            patch.object(
                activate_module,
                "current_account_with_tenant",
                return_value=(current_account, "current-workspace-id"),
            ),
            patch.object(activate_module, "extract_access_token", return_value="access-token") as extract_access_token,
            patch.object(activate_module.RegisterService, "revoke_token") as revoke_token,
            patch.object(activate_module.TenantService, "create_tenant_member") as create_tenant_member,
            pytest.raises(InvitationAccountMismatchError),
        ):
            _post(app, {"token": "valid_token"})

        extract_access_token.assert_called_once()
        revoke_token.assert_not_called()
        create_tenant_member.assert_not_called()
        switch_tenant.assert_not_called()
        assert database.session().scalar(select(func.count(TenantAccountJoin.id))) == 0

    def test_successful_account_activation_persists_membership(
        self,
        database: Database,
        app: Flask,
        invitation: dict[str, object],
        switch_tenant: Mock,
    ) -> None:
        with (
            patch.object(
                activate_module.RegisterService,
                "get_invitation_with_case_fallback",
                return_value=invitation,
            ),
            patch.object(activate_module.RegisterService, "revoke_token") as revoke_token,
        ):
            response = _post(app, _setup_payload())

        session = database.session()
        account = invitation["account"]
        tenant = invitation["tenant"]
        assert isinstance(account, Account)
        assert isinstance(tenant, Tenant)
        membership = session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.account_id == account.id,
                TenantAccountJoin.tenant_id == tenant.id,
            )
        )
        assert membership is not None
        assert membership.role == TenantAccountRole.NORMAL
        assert response == {"result": "success"}
        assert account.name == "John Doe"
        assert account.interface_language == "en-US"
        assert account.timezone == "UTC"
        assert account.interface_theme == "light"
        assert account.status == AccountStatus.ACTIVE
        assert account.initialized_at is not None
        revoke_token.assert_called_once_with("workspace-123", "invitee@example.com", "valid_token")
        switch_tenant.assert_called_once_with(account, tenant.id, session=ANY)
        assert isinstance(switch_tenant.call_args.kwargs["session"], Session)

    def test_missing_setup_fields_does_not_consume_invitation_or_create_membership(
        self,
        database: Database,
        app: Flask,
        invitation: dict[str, object],
        switch_tenant: Mock,
    ) -> None:
        data = invitation["data"]
        assert isinstance(data, dict)
        data["requires_setup"] = True

        with (
            patch.object(
                activate_module.RegisterService,
                "get_invitation_with_case_fallback",
                return_value=invitation,
            ),
            patch.object(activate_module.RegisterService, "revoke_token") as revoke_token,
            pytest.raises(AlreadyActivateError),
        ):
            _post(app, _setup_payload(name=None, interface_language=None, timezone=None))

        assert database.session().scalar(select(func.count(TenantAccountJoin.id))) == 0
        revoke_token.assert_not_called()
        switch_tenant.assert_not_called()

    def test_activation_with_invalid_token(self, app: Flask, switch_tenant: Mock) -> None:
        with (
            patch.object(
                activate_module.RegisterService,
                "get_invitation_with_case_fallback",
                return_value=None,
            ),
            pytest.raises(AlreadyActivateError),
        ):
            _post(app, _setup_payload(token="invalid_token"))
        switch_tenant.assert_not_called()

    def test_billing_freeze_leaves_persisted_account_pending(
        self,
        database: Database,
        app: Flask,
        invitation: dict[str, object],
        switch_tenant: Mock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        account = invitation["account"]
        assert isinstance(account, Account)
        account.email = "Invitee@Example.com"
        database.session().commit()
        monkeypatch.setattr(activate_module.dify_config, "BILLING_ENABLED", True)

        with (
            patch.object(
                activate_module.RegisterService,
                "get_invitation_with_case_fallback",
                return_value=invitation,
            ),
            patch.object(activate_module.RegisterService, "revoke_token") as revoke_token,
            patch.object(activate_module.BillingService, "is_email_in_freeze", return_value=True) as is_frozen,
            pytest.raises(AccountInFreezeError),
        ):
            _post(app, _setup_payload())

        database.session().refresh(account)
        assert account.status == AccountStatus.PENDING
        assert database.session().scalar(select(func.count(TenantAccountJoin.id))) == 0
        is_frozen.assert_called_once_with("Invitee@Example.com")
        revoke_token.assert_not_called()
        switch_tenant.assert_not_called()

    @pytest.mark.parametrize(
        ("language", "timezone"),
        [
            ("en-US", "UTC"),
            ("zh-Hans", "Asia/Shanghai"),
            ("ja-JP", "Asia/Tokyo"),
            ("es-ES", "Europe/Madrid"),
        ],
    )
    def test_activation_with_different_locales(
        self,
        app: Flask,
        invitation: dict[str, object],
        switch_tenant: Mock,
        language: str,
        timezone: str,
    ) -> None:
        with (
            patch.object(
                activate_module.RegisterService,
                "get_invitation_with_case_fallback",
                return_value=invitation,
            ),
            patch.object(activate_module.RegisterService, "revoke_token"),
        ):
            assert _post(app, _setup_payload(interface_language=language, timezone=timezone)) == {"result": "success"}

        account = invitation["account"]
        assert isinstance(account, Account)
        assert account.interface_language == language
        assert account.timezone == timezone

    def test_activation_without_workspace_id_revokes_normalized_email(
        self,
        app: Flask,
        invitation: dict[str, object],
        switch_tenant: Mock,
    ) -> None:
        with (
            patch.object(
                activate_module.RegisterService,
                "get_invitation_with_case_fallback",
                return_value=invitation,
            ) as lookup,
            patch.object(activate_module.RegisterService, "revoke_token") as revoke_token,
        ):
            response = _post(
                app,
                _setup_payload(workspace_id=None, email="Invitee@Example.com"),
            )

        assert response == {"result": "success"}
        lookup.assert_called_once_with(None, "Invitee@Example.com", "valid_token", session=ANY)
        revoke_token.assert_called_once_with(None, "invitee@example.com", "valid_token")

    def test_existing_active_account_gets_tenant_scoped_admin_membership(
        self,
        database: Database,
        app: Flask,
        invitation: dict[str, object],
        switch_tenant: Mock,
    ) -> None:
        session = database.session()
        account = invitation["account"]
        tenant = invitation["tenant"]
        data = invitation["data"]
        assert isinstance(account, Account)
        assert isinstance(tenant, Tenant)
        assert isinstance(data, dict)
        account.status = AccountStatus.ACTIVE
        data.update({"role": "admin", "requires_setup": False})
        other_tenant = Tenant(name="Other Workspace")
        other_tenant.id = "workspace-456"
        session.add(other_tenant)
        session.flush()
        session.add(
            TenantAccountJoin(
                tenant_id=other_tenant.id,
                account_id=account.id,
                role=TenantAccountRole.NORMAL,
            )
        )
        session.commit()

        with (
            patch.object(
                activate_module.RegisterService,
                "get_invitation_with_case_fallback",
                return_value=invitation,
            ),
            patch.object(activate_module.RegisterService, "revoke_token"),
        ):
            assert _post(
                app,
                {"workspace_id": tenant.id, "email": account.email, "token": "valid_token"},
            ) == {"result": "success"}

        memberships = session.scalars(select(TenantAccountJoin).where(TenantAccountJoin.account_id == account.id)).all()
        assert {(row.tenant_id, row.role) for row in memberships} == {
            (other_tenant.id, TenantAccountRole.NORMAL),
            (tenant.id, TenantAccountRole.ADMIN),
        }

    def test_existing_membership_is_not_duplicated(
        self,
        database: Database,
        app: Flask,
        invitation: dict[str, object],
        switch_tenant: Mock,
    ) -> None:
        session = database.session()
        account = invitation["account"]
        tenant = invitation["tenant"]
        assert isinstance(account, Account)
        assert isinstance(tenant, Tenant)
        account.status = AccountStatus.ACTIVE
        session.add(
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=account.id,
                role=TenantAccountRole.EDITOR,
            )
        )
        session.commit()

        with (
            patch.object(
                activate_module.RegisterService,
                "get_invitation_with_case_fallback",
                return_value=invitation,
            ),
            patch.object(activate_module.RegisterService, "revoke_token"),
        ):
            assert _post(
                app,
                {"workspace_id": tenant.id, "email": account.email, "token": "valid_token"},
            ) == {"result": "success"}

        assert session.scalar(select(func.count(TenantAccountJoin.id))) == 1
        membership = session.scalar(select(TenantAccountJoin))
        assert membership is not None
        assert membership.role == TenantAccountRole.EDITOR
