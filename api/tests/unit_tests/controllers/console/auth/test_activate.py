"""Transport-boundary tests for account invitation activation."""

import re
from collections.abc import Callable, Iterator
from dataclasses import replace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import UnprocessableEntity

from controllers.console.auth.activate import ActivateApi, ActivateCheckApi
from controllers.console.auth.error import InvitationAccountMismatchError as InvitationAccountMismatchHTTPError
from controllers.console.error import (
    AccountInFreezeError,
    AlreadyActivateError,
)
from controllers.console.error import (
    EmailDomainSuspendedError as EmailDomainSuspendedHTTPError,
)
from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_redis import RedisClientWrapper
from libs.login import AccountWithTenant
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from services.account_activation_service import AccountActivationService
from services.account_errors import AccountEmailDomainSuspendedError as EmailDomainSuspendedRegistrationError
from services.account_errors import FrozenAccountError, InvalidInvitationError, InvitationAccountMismatchError
from services.entities.account_activation_entities import ActivationCheckResult


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def activation_service(
    sqlite_session_factory: sessionmaker[Session],
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    mocker: MockerFixture,
) -> AccountActivationService:
    service = build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=redis_transport[0],
    ).accounts.activation
    mocker.patch.object(service, "check")
    mocker.patch.object(service, "activate")
    return service


@pytest.fixture
def resolvable_activation_service(
    sqlite_session_factory: sessionmaker[Session],
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> AccountActivationService:
    """Wire the real activation service over a real invitation instead of a stubbed check.

    The workspace and account live in SQLite and the invitation token lives in Redis, so
    ``check`` resolves the invitation the way it does in production.
    """

    with sqlite_session_factory() as session:
        tenant = Tenant(name="Test Workspace")
        tenant.id = "workspace-123"
        account = Account(name="Invitee", email="invitee@example.com", status=AccountStatus.PENDING)
        account.id = "account-123"
        session.add_all([tenant, account])
        session.commit()

    _, commands = redis_transport
    commands.return_value = b"account-123"

    return build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=redis_transport[0],
    ).accounts.activation


@pytest.fixture
def bind_application_services(
    app: Flask,
    sqlite_session_factory: sessionmaker[Session],
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> Iterator[Callable[[AccountActivationService], None]]:
    """Expose a real service container on the app, the way production wires it.

    The controller reads ``current_app.extensions["application_services"]``, so the tests hand
    the dependency in through that container instead of patching the accessor.
    """

    services = build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=redis_transport[0],
    )
    previous = app.extensions.get("application_services")

    def bind(activation: AccountActivationService) -> None:
        app.extensions["application_services"] = replace(
            services, accounts=replace(services.accounts, activation=activation)
        )

    try:
        yield bind
    finally:
        if previous is None:
            app.extensions.pop("application_services", None)
        else:
            app.extensions["application_services"] = previous


def _assert_activated(sqlite_session_factory: sessionmaker[Session]) -> TenantAccountJoin:
    with sqlite_session_factory() as session:
        account = session.get(Account, "account-123")
        assert account is not None
        assert account.status == AccountStatus.ACTIVE
        assert (account.name, account.interface_language, account.timezone) == ("John Doe", "en-US", "UTC")
        membership = session.scalar(select(TenantAccountJoin))
        assert membership is not None
        assert membership.tenant_id == "workspace-123"
        assert membership.account_id == "account-123"
        assert membership.role == TenantAccountRole.NORMAL
        assert membership.current is True
        return membership


class TestActivateCheckApi:
    def test_serializes_a_resolvable_invitation(
        self,
        app: Flask,
        bind_application_services: Callable[[AccountActivationService], None],
        resolvable_activation_service: AccountActivationService,
    ) -> None:
        """Resolution runs for real, so the response fields come from the stored workspace and account."""
        bind_application_services(resolvable_activation_service)
        with app.test_request_context(
            "/activate/check?workspace_id=workspace-123&email=invitee@example.com&token=valid-token"
        ):
            response = ActivateCheckApi().get()

        assert response == {
            "is_valid": True,
            "data": {
                "workspace_name": "Test Workspace",
                "workspace_id": "workspace-123",
                "email": "invitee@example.com",
                "account_status": "pending",
                "requires_setup": True,
            },
        }

    def test_looks_the_invitation_up_by_workspace_and_email(
        self,
        app: Flask,
        bind_application_services: Callable[[AccountActivationService], None],
        resolvable_activation_service: AccountActivationService,
        redis_transport: tuple[RedisClientWrapper, MagicMock],
    ) -> None:
        """The workspace-scoped key is the one the invitation writer fills, so it must be preferred."""
        bind_application_services(resolvable_activation_service)
        _, commands = redis_transport
        with app.test_request_context(
            "/activate/check?workspace_id=workspace-123&email=invitee@example.com&token=valid-token"
        ):
            ActivateCheckApi().get()

        lookup_key = commands.call_args.args[1]
        assert re.fullmatch(r"member_invite_token:workspace-123, [0-9a-f]{64}:valid-token", lookup_key)

    def test_omits_data_for_invalid_invitation(
        self,
        app: Flask,
        bind_application_services: Callable[[AccountActivationService], None],
        activation_service: AccountActivationService,
    ) -> None:
        check = activation_service.check
        assert isinstance(check, MagicMock)
        check.return_value = ActivationCheckResult(is_valid=False)
        bind_application_services(activation_service)

        with app.test_request_context("/activate/check?token=invalid-token"):
            response = ActivateCheckApi().get()

        assert response == {"is_valid": False}

    def test_rejects_request_without_token(
        self,
        app: Flask,
        bind_application_services: Callable[[AccountActivationService], None],
        activation_service: AccountActivationService,
    ) -> None:
        """`token` is required, so a tokenless query must not reach the application service."""
        bind_application_services(activation_service)
        with (
            app.test_request_context("/activate/check?workspace_id=workspace-123"),
            pytest.raises(UnprocessableEntity),
        ):
            ActivateCheckApi().get()

        check = activation_service.check
        assert isinstance(check, MagicMock)
        check.assert_not_called()


class TestActivateApi:
    def test_activates_the_invited_account_for_a_signed_in_session(
        self,
        app: Flask,
        bind_application_services: Callable[[AccountActivationService], None],
        resolvable_activation_service: AccountActivationService,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        """A signed-in invitee activates their own invitation and lands as a member of the workspace."""
        bind_application_services(resolvable_activation_service)
        payload = {
            "workspace_id": "workspace-123",
            "email": "Invitee@Example.com",
            "token": "valid-token",
            "name": "John Doe",
            "interface_language": "en-US",
            "timezone": "UTC",
        }
        account = Account(name="Invitee", email="invitee@example.com")
        account.id = "account-123"
        with (
            app.test_request_context("/activate", method="POST", json=payload),
            patch("controllers.console.auth.activate.extract_access_token", return_value="access-token"),
            patch(
                "controllers.console.auth.activate.current_account_with_tenant",
                return_value=AccountWithTenant(account=account, tenant_id="workspace-123"),
            ),
        ):
            response = ActivateApi().post()

        assert response == {"result": "success"}
        _assert_activated(sqlite_session_factory)

    def test_activates_a_token_only_invitation_without_reading_the_session(
        self,
        app: Flask,
        bind_application_services: Callable[[AccountActivationService], None],
        resolvable_activation_service: AccountActivationService,
        sqlite_session_factory: sessionmaker[Session],
        redis_transport: tuple[RedisClientWrapper, MagicMock],
    ) -> None:
        """A token-only activation completes without a session, so the workspace and email come from the token."""
        bind_application_services(resolvable_activation_service)
        _, commands = redis_transport
        commands.return_value = (
            b'{"account_id":"account-123","email":"invitee@example.com","workspace_id":"workspace-123",'
            b'"role":null,"requires_setup":true}'
        )
        payload = {
            "token": "valid-token",
            "name": "John Doe",
            "interface_language": "en-US",
            "timezone": "UTC",
        }
        with (
            app.test_request_context("/activate", method="POST", json=payload),
            patch("controllers.console.auth.activate.extract_access_token", return_value=None),
            patch("controllers.console.auth.activate.current_account_with_tenant") as resolve_account,
        ):
            response = ActivateApi().post()

        assert response == {"result": "success"}
        resolve_account.assert_not_called()
        _assert_activated(sqlite_session_factory)

    def test_refuses_a_session_that_belongs_to_another_account(
        self,
        app: Flask,
        bind_application_services: Callable[[AccountActivationService], None],
        resolvable_activation_service: AccountActivationService,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        """The invitation belongs to one account, so another signed-in account cannot consume it."""
        bind_application_services(resolvable_activation_service)
        payload = {
            "workspace_id": "workspace-123",
            "email": "invitee@example.com",
            "token": "valid-token",
            "name": "Someone Else",
            "interface_language": "en-US",
            "timezone": "UTC",
        }
        account = Account(name="Someone Else", email="someone@example.com")
        account.id = "another-account"
        with (
            app.test_request_context("/activate", method="POST", json=payload),
            patch("controllers.console.auth.activate.extract_access_token", return_value="access-token"),
            patch(
                "controllers.console.auth.activate.current_account_with_tenant",
                return_value=AccountWithTenant(account=account, tenant_id="workspace-123"),
            ),
            pytest.raises(InvitationAccountMismatchHTTPError),
        ):
            ActivateApi().post()

        with sqlite_session_factory() as session:
            invitee = session.get(Account, "account-123")
            assert invitee is not None
            assert invitee.status == AccountStatus.PENDING
            assert session.scalar(select(TenantAccountJoin)) is None

    @pytest.mark.parametrize(
        ("service_error", "http_error"),
        [
            (InvalidInvitationError(), AlreadyActivateError),
            (InvitationAccountMismatchError(), InvitationAccountMismatchHTTPError),
            (FrozenAccountError(), AccountInFreezeError),
            (EmailDomainSuspendedRegistrationError(), EmailDomainSuspendedHTTPError),
        ],
    )
    def test_translates_application_errors(
        self,
        app: Flask,
        bind_application_services: Callable[[AccountActivationService], None],
        activation_service: AccountActivationService,
        service_error: Exception,
        http_error: type[Exception],
    ) -> None:
        activate = activation_service.activate
        assert isinstance(activate, MagicMock)
        activate.side_effect = service_error
        bind_application_services(activation_service)

        with (
            app.test_request_context("/activate", method="POST", json={"token": "invalid-token"}),
            patch("controllers.console.auth.activate.extract_access_token", return_value=None),
            pytest.raises(http_error),
        ):
            ActivateApi().post()

    def test_rejects_request_without_token(
        self,
        app: Flask,
        bind_application_services: Callable[[AccountActivationService], None],
        activation_service: AccountActivationService,
    ) -> None:
        """`token` is required, so a tokenless payload must not resolve the session or reach the service."""
        bind_application_services(activation_service)
        with (
            app.test_request_context("/activate", method="POST", json={"workspace_id": "workspace-123"}),
            patch("controllers.console.auth.activate.extract_access_token") as extract_token,
            pytest.raises(UnprocessableEntity),
        ):
            ActivateApi().post()

        extract_token.assert_not_called()
        activate = activation_service.activate
        assert isinstance(activate, MagicMock)
        activate.assert_not_called()
