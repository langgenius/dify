"""Transport-boundary tests for account invitation activation."""

import re
from collections.abc import Callable, Iterator
from dataclasses import replace
from http import HTTPStatus
from unittest.mock import MagicMock

import pytest
from flask import Flask
from flask.testing import FlaskClient
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import UnprocessableEntity

from controllers.console import bp as console_blueprint
from controllers.console.auth.activate import ActivateApi, ActivateCheckApi
from controllers.console.auth.error import InvitationAccountMismatchError as InvitationAccountMismatchHTTPError
from controllers.console.error import (
    AccountInFreezeError,
    AlreadyActivateError,
    InvitationWorkspaceMemberLimitError,
)
from controllers.console.error import (
    EmailDomainSuspendedError as EmailDomainSuspendedHTTPError,
)
from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_login import (
    DifyLoginManager,
    bind_account_loader,
    bind_account_only_loader,
    load_user_from_request,
    unauthorized_handler,
)
from extensions.ext_redis import RedisClientWrapper
from libs.external_api import ErrorResponse
from libs.passport import PassportService
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from services.account_activation_service import AccountActivationService
from services.account_errors import AccountEmailDomainSuspendedError as EmailDomainSuspendedRegistrationError
from services.account_errors import (
    FrozenAccountError,
    InvalidInvitationError,
    InvitationAccountMismatchError,
    InvitationWorkspaceFullError,
)
from services.entities.account_activation_entities import ActivationCheckResult, InvitationLookup
from tests.helpers.unit.config_override import config_overrides_context


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
    ``check`` resolves the invitation the way it does in production. The invitee also has a
    current membership in another workspace so the real console identity loader can resolve them.
    """

    with sqlite_session_factory() as session:
        tenant = Tenant(name="Test Workspace")
        tenant.id = "workspace-123"
        existing_tenant = Tenant(name="Existing Workspace")
        existing_tenant.id = "workspace-existing"
        account = Account(name="Invitee", email="invitee@example.com", status=AccountStatus.PENDING)
        account.id = "account-123"
        session.add_all([tenant, existing_tenant, account])
        session.flush()
        session.add(
            TenantAccountJoin(
                tenant_id=existing_tenant.id,
                account_id=account.id,
                role=TenantAccountRole.NORMAL,
                current=True,
            )
        )
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
    previous_account_loader = app.extensions.get("account_identity_loader")
    previous_account_only_loader = app.extensions.get("account_only_identity_loader")
    # Production wires both loaders; the activate resource is account-scoped, so it resolves
    # through the account-only loader and must not fall back to workspace admission.
    bind_account_loader(app, services.accounts.identity.load_user)
    bind_account_only_loader(app, services.accounts.identity.load_account)

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
        if previous_account_loader is None:
            app.extensions.pop("account_identity_loader", None)
        else:
            app.extensions["account_identity_loader"] = previous_account_loader
        if previous_account_only_loader is None:
            app.extensions.pop("account_only_identity_loader", None)
        else:
            app.extensions["account_only_identity_loader"] = previous_account_only_loader


@pytest.fixture
def console_client(app: Flask) -> Iterator[FlaskClient]:
    """Serve the real activation resource on a console route with real bearer auth."""
    with config_overrides_context(
        LOGIN_DISABLED=False,
        SECRET_KEY="activate-console-test-secret-at-least-32-bytes",
    ):
        login_manager = DifyLoginManager()
        login_manager.request_loader(load_user_from_request)
        login_manager.unauthorized_handler(unauthorized_handler)
        login_manager.init_app(app)
        app.register_blueprint(console_blueprint)
        yield app.test_client()


def _assert_activated(sqlite_session_factory: sessionmaker[Session]) -> TenantAccountJoin:
    with sqlite_session_factory() as session:
        account = session.get(Account, "account-123")
        assert account is not None
        assert account.status == AccountStatus.ACTIVE
        assert (account.name, account.interface_language, account.timezone) == ("John Doe", "en-US", "UTC")
        membership = session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == "workspace-123",
                TenantAccountJoin.account_id == "account-123",
            )
        )
        assert membership is not None
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

        lookup_key = next(
            command.args[1]
            for command in commands.call_args_list
            if command.args[0] == "GET" and command.args[1].startswith("member_invite_token:workspace-123, ")
        )
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
        console_client: FlaskClient,
        bind_application_services: Callable[[AccountActivationService], None],
        resolvable_activation_service: AccountActivationService,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        """A real console session activates its invitation through the registered route."""
        bind_application_services(resolvable_activation_service)
        payload = {
            "workspace_id": "workspace-123",
            "email": "Invitee@Example.com",
            "token": "valid-token",
            "name": "John Doe",
            "interface_language": "en-US",
            "timezone": "UTC",
        }
        headers = {
            "Authorization": f"Bearer {PassportService().issue({'user_id': 'account-123'})}",
        }

        response = console_client.post("/console/api/activate", json=payload, headers=headers)

        assert response.status_code == HTTPStatus.OK
        assert response.get_json() == {"result": "success"}
        _assert_activated(sqlite_session_factory)

    def test_activates_a_token_only_invitation_without_reading_the_session(
        self,
        console_client: FlaskClient,
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

        response = console_client.post("/console/api/activate", json=payload)

        assert response.status_code == HTTPStatus.OK
        assert response.get_json() == {"result": "success"}
        _assert_activated(sqlite_session_factory)

    def test_refuses_a_session_that_belongs_to_another_account(
        self,
        console_client: FlaskClient,
        bind_application_services: Callable[[AccountActivationService], None],
        resolvable_activation_service: AccountActivationService,
        redis_transport: tuple[RedisClientWrapper, MagicMock],
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        """A mismatched console session cannot activate the account or revoke its invitation."""
        bind_application_services(resolvable_activation_service)
        with sqlite_session_factory.begin() as session:
            other_account = Account(
                name="Someone Else",
                email="someone@example.com",
                status=AccountStatus.ACTIVE,
            )
            other_tenant = Tenant(name="Someone Else's Workspace")
            session.add_all([other_account, other_tenant])
            session.flush()
            session.add(
                TenantAccountJoin(
                    tenant_id=other_tenant.id,
                    account_id=other_account.id,
                    role=TenantAccountRole.OWNER,
                    current=True,
                )
            )
            other_account_id = other_account.id

        payload = {
            "workspace_id": "workspace-123",
            "email": "invitee@example.com",
            "token": "valid-token",
            "name": "Someone Else",
            "interface_language": "en-US",
            "timezone": "UTC",
        }
        headers = {
            "Authorization": f"Bearer {PassportService().issue({'user_id': other_account_id})}",
        }

        response = console_client.post("/console/api/activate", json=payload, headers=headers)

        assert response.status_code == HTTPStatus.FORBIDDEN
        body = ErrorResponse.model_validate_json(response.get_data())
        assert body.code == "invitation_account_mismatch"
        assert body.status == HTTPStatus.FORBIDDEN

        invitation = InvitationLookup(workspace_id="workspace-123", email="invitee@example.com", token="valid-token")
        assert resolvable_activation_service.check(invitation).is_valid
        _, commands = redis_transport
        invitation_lookup_key = next(
            command.args[1]
            for command in commands.call_args_list
            if command.args[0] == "GET" and command.args[1].startswith("member_invite_token:workspace-123, ")
        )
        assert not any(command.args[:2] == ("DEL", invitation_lookup_key) for command in commands.call_args_list)

        with sqlite_session_factory() as session:
            invitee = session.get(Account, "account-123")
            assert invitee is not None
            assert invitee.status == AccountStatus.PENDING
            assert (
                session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.tenant_id == "workspace-123")) is None
            )

    @pytest.mark.parametrize(
        ("service_error", "http_error"),
        [
            (InvalidInvitationError(), AlreadyActivateError),
            (InvitationAccountMismatchError(), InvitationAccountMismatchHTTPError),
            (FrozenAccountError(), AccountInFreezeError),
            (EmailDomainSuspendedRegistrationError(), EmailDomainSuspendedHTTPError),
            (InvitationWorkspaceFullError(), InvitationWorkspaceMemberLimitError),
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
            pytest.raises(UnprocessableEntity),
        ):
            ActivateApi().post()

        activate = activation_service.activate
        assert isinstance(activate, MagicMock)
        activate.assert_not_called()
