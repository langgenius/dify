"""Transport-boundary tests for account invitation activation."""

from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from flask import Flask

from controllers.console.auth.activate import ActivateApi, ActivateCheckApi
from controllers.console.auth.error import InvitationAccountMismatchError as InvitationAccountMismatchHTTPError
from controllers.console.error import (
    AccountInFreezeError,
    AlreadyActivateError,
)
from controllers.console.error import (
    EmailDomainSuspendedError as EmailDomainSuspendedHTTPError,
)
from services.account_activation_service import (
    AccountActivationService,
    FrozenAccountError,
    InvalidInvitationError,
    InvitationAccountMismatchError,
)
from services.account_activation_service import (
    EmailDomainSuspendedError as EmailDomainSuspendedRegistrationError,
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
def activation_service() -> Mock:
    return Mock(spec=AccountActivationService)


def _services(service: Mock) -> SimpleNamespace:
    return SimpleNamespace(account_activation=service)


class TestActivateCheckApi:
    def test_serializes_valid_invitation(
        self,
        app: Flask,
        activation_service: Mock,
    ) -> None:
        activation_service.check.return_value = ActivationCheckResult(
            is_valid=True,
            data=ActivationCheckData(
                workspace_name="Test Workspace",
                workspace_id="workspace-123",
                email="invitee@example.com",
                account_status="pending",
                requires_setup=True,
            ),
        )
        with (
            app.test_request_context(
                "/activate/check?workspace_id=workspace-123&email=invitee@example.com&token=valid-token"
            ),
            patch(
                "controllers.console.auth.activate.application_services",
                return_value=_services(activation_service),
            ),
        ):
            response = unwrap(ActivateCheckApi.get)(ActivateCheckApi())

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
        activation_service.check.assert_called_once_with(
            InvitationLookup(
                workspace_id="workspace-123",
                email="invitee@example.com",
                token="valid-token",
            ),
        )

    def test_omits_data_for_invalid_invitation(self, app: Flask, activation_service: Mock) -> None:
        activation_service.check.return_value = ActivationCheckResult(is_valid=False)

        with (
            app.test_request_context("/activate/check?token=invalid-token"),
            patch(
                "controllers.console.auth.activate.application_services",
                return_value=_services(activation_service),
            ),
        ):
            response = unwrap(ActivateCheckApi.get)(ActivateCheckApi())

        assert response == {"is_valid": False}


class TestActivateApi:
    def test_passes_parsed_command_to_application_service(
        self,
        app: Flask,
        activation_service: Mock,
    ) -> None:
        payload = {
            "workspace_id": "workspace-123",
            "email": "Invitee@Example.com",
            "token": "valid-token",
            "name": "John Doe",
            "interface_language": "en-US",
            "timezone": "UTC",
        }
        with (
            app.test_request_context("/activate", method="POST", json=payload),
            patch(
                "controllers.console.auth.activate.application_services",
                return_value=_services(activation_service),
            ),
            patch("controllers.console.auth.activate.extract_access_token", return_value="access-token"),
            patch(
                "controllers.console.auth.activate.current_account_with_tenant",
                return_value=SimpleNamespace(account=SimpleNamespace(id="account-123")),
            ),
        ):
            response = unwrap(ActivateApi.post)(ActivateApi())

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
        activation_service: Mock,
    ) -> None:
        with (
            app.test_request_context("/activate", method="POST", json={"token": "valid-token"}),
            patch(
                "controllers.console.auth.activate.application_services",
                return_value=_services(activation_service),
            ),
            patch("controllers.console.auth.activate.extract_access_token", return_value=None),
            patch("controllers.console.auth.activate.current_account_with_tenant") as resolve_account,
        ):
            response = unwrap(ActivateApi.post)(ActivateApi())

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
        ],
    )
    def test_translates_application_errors(
        self,
        app: Flask,
        activation_service: Mock,
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
            unwrap(ActivateApi.post)(ActivateApi())
