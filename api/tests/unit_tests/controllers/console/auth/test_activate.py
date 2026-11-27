"""Transport-boundary tests for account invitation activation."""

from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Unauthorized, UnprocessableEntity

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
from extensions.ext_redis import RedisClientWrapper
from models.account import Account
from services.account_activation_service import AccountActivationService
from services.account_errors import AccountEmailDomainSuspendedError as EmailDomainSuspendedRegistrationError
from services.account_errors import (
    FrozenAccountError,
    InvalidInvitationError,
    InvitationAccountMismatchError,
    InvitationWorkspaceFullError,
)
from services.entities.account_activation_entities import (
    ActivationCheckData,
    ActivationCheckResult,
    ActivationCommand,
    InvitationLookup,
)


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


def _services(service: AccountActivationService) -> SimpleNamespace:
    return SimpleNamespace(accounts=SimpleNamespace(activation=service))


class TestActivateCheckApi:
    def test_serializes_valid_invitation(
        self,
        app: Flask,
        activation_service: AccountActivationService,
    ) -> None:
        activation_service.check.return_value = ActivationCheckResult(
            is_valid=True,
            data=ActivationCheckData(
                workspace_name="Test Workspace",
                workspace_id="workspace-123",
                email="invitee@example.com",
                account_status="pending",
                requires_setup=True,
                is_current_account=True,
            ),
        )
        account = Account(name="User", email="invitee@example.com")
        account.id = "account-123"
        with (
            app.test_request_context(
                "/activate/check?workspace_id=workspace-123&email=invitee@example.com&token=valid-token"
            ),
            patch(
                "controllers.console.auth.activate.application_services",
                return_value=_services(activation_service),
            ),
            patch("controllers.console.auth.activate.extract_access_token", return_value="access-token"),
            patch(
                "controllers.console.auth.activate.current_account_with_tenant_optional",
                return_value=(account, None),
            ),
        ):
            response = ActivateCheckApi().get()

        assert response.headers["Cache-Control"] == "no-store"
        assert response.get_json() == {
            "is_valid": True,
            "data": {
                "workspace_name": "Test Workspace",
                "workspace_id": "workspace-123",
                "email": "invitee@example.com",
                "account_status": "pending",
                "requires_setup": True,
                "is_current_account": True,
            },
        }
        activation_service.check.assert_called_once_with(
            InvitationLookup(
                workspace_id="workspace-123",
                email="invitee@example.com",
                token="valid-token",
            ),
            authenticated_account_id="account-123",
        )

    def test_treats_unauthorized_session_as_unauthenticated_during_check(
        self,
        app: Flask,
        activation_service: AccountActivationService,
    ) -> None:
        check_mock = cast(MagicMock, activation_service.check)
        check_mock.return_value = ActivationCheckResult(
            is_valid=True,
            data=ActivationCheckData(
                workspace_name="Test Workspace",
                workspace_id="workspace-123",
                email="invitee@example.com",
                account_status="active",
                requires_setup=False,
                is_current_account=False,
            ),
        )
        with (
            app.test_request_context("/activate/check?token=valid-token"),
            patch(
                "controllers.console.auth.activate.application_services",
                return_value=_services(activation_service),
            ),
            patch("controllers.console.auth.activate.extract_access_token", return_value="banned-token"),
            patch(
                "controllers.console.auth.activate.current_account_with_tenant_optional",
                side_effect=Unauthorized("Account is banned."),
            ),
        ):
            response = ActivateCheckApi().get()

        assert response.headers["Cache-Control"] == "no-store"
        assert response.get_json() == {
            "is_valid": True,
            "data": {
                "workspace_name": "Test Workspace",
                "workspace_id": "workspace-123",
                "email": "invitee@example.com",
                "account_status": "active",
                "requires_setup": False,
                "is_current_account": False,
            },
        }
        check_mock.assert_called_once_with(
            InvitationLookup(workspace_id=None, email=None, token="valid-token"),
            authenticated_account_id=None,
        )

    def test_omits_data_for_invalid_invitation(self, app: Flask, activation_service: AccountActivationService) -> None:
        activation_service.check.return_value = ActivationCheckResult(is_valid=False)

        with (
            app.test_request_context("/activate/check?token=invalid-token"),
            patch(
                "controllers.console.auth.activate.application_services",
                return_value=_services(activation_service),
            ),
            patch("controllers.console.auth.activate.extract_access_token", return_value=None),
        ):
            response = ActivateCheckApi().get()

        assert response.headers["Cache-Control"] == "no-store"
        assert response.get_json() == {"is_valid": False}

    def test_rejects_request_without_token(self, app: Flask, activation_service: AccountActivationService) -> None:
        """`token` is required, so a tokenless query must not reach the application service."""
        with (
            app.test_request_context("/activate/check?workspace_id=workspace-123"),
            patch(
                "controllers.console.auth.activate.application_services",
                return_value=_services(activation_service),
            ),
            pytest.raises(UnprocessableEntity),
        ):
            ActivateCheckApi().get()

        activation_service.check.assert_not_called()


class TestActivateApi:
    def test_passes_parsed_command_to_application_service(
        self,
        app: Flask,
        activation_service: AccountActivationService,
    ) -> None:
        payload = {
            "workspace_id": "workspace-123",
            "email": "Invitee@Example.com",
            "token": "valid-token",
            "name": "John Doe",
            "interface_language": "en-US",
            "timezone": "UTC",
        }
        account = Account(name="User", email="user@example.com")
        account.id = "account-123"
        with (
            app.test_request_context("/activate", method="POST", json=payload),
            patch(
                "controllers.console.auth.activate.application_services",
                return_value=_services(activation_service),
            ),
            patch("controllers.console.auth.activate.extract_access_token", return_value="access-token"),
            patch(
                "controllers.console.auth.activate.current_account_with_tenant_optional",
                return_value=(account, None),
            ),
        ):
            response = ActivateApi().post()

        assert response == {"result": "success"}
        activation_service.activate.assert_called_once_with(
            ActivationCommand(
                invitation=InvitationLookup(
                    workspace_id="workspace-123",
                    email="Invitee@Example.com",
                    token="valid-token",
                ),
                name="John Doe",
                interface_language="en-US",
                timezone="UTC",
            ),
            authenticated_account_id="account-123",
        )

    def test_passes_no_authenticated_account_for_token_only_activation(
        self,
        app: Flask,
        activation_service: AccountActivationService,
    ) -> None:
        with (
            app.test_request_context("/activate", method="POST", json={"token": "valid-token"}),
            patch(
                "controllers.console.auth.activate.application_services",
                return_value=_services(activation_service),
            ),
            patch("controllers.console.auth.activate.extract_access_token", return_value=None),
            patch("controllers.console.auth.activate.current_account_with_tenant_optional") as resolve_account,
        ):
            response = ActivateApi().post()

        assert response == {"result": "success"}
        activation_service.activate.assert_called_once_with(
            ActivationCommand(invitation=InvitationLookup(workspace_id=None, email=None, token="valid-token")),
            authenticated_account_id=None,
        )
        resolve_account.assert_not_called()

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
        activation_service: AccountActivationService,
        service_error: Exception,
        http_error: type[Exception],
    ) -> None:
        activation_service.activate.side_effect = service_error

        with (
            app.test_request_context("/activate", method="POST", json={"token": "invalid-token"}),
            patch(
                "controllers.console.auth.activate.application_services",
                return_value=_services(activation_service),
            ),
            patch("controllers.console.auth.activate.extract_access_token", return_value=None),
            pytest.raises(http_error),
        ):
            ActivateApi().post()

    def test_rejects_request_without_token(self, app: Flask, activation_service: AccountActivationService) -> None:
        """`token` is required, so a tokenless payload must not resolve the session or reach the service."""
        with (
            app.test_request_context("/activate", method="POST", json={"workspace_id": "workspace-123"}),
            patch(
                "controllers.console.auth.activate.application_services",
                return_value=_services(activation_service),
            ),
            patch("controllers.console.auth.activate.extract_access_token") as extract_token,
            pytest.raises(UnprocessableEntity),
        ):
            ActivateApi().post()

        extract_token.assert_not_called()
        activation_service.activate.assert_not_called()
