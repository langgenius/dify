"""Tests for the Flask adapter around initialization validation."""

from types import SimpleNamespace
from unittest.mock import Mock, create_autospec

import pytest
from flask import Flask

from controllers.console import init_validate, wraps
from controllers.console.error import AlreadySetupError, InitValidateFailedError
from enums import DeploymentEdition
from services.init_validation_service import (
    AlreadyInitializedError,
    InitValidationService,
    InvalidInitializationPasswordError,
)


@pytest.fixture
def init_validation(monkeypatch: pytest.MonkeyPatch) -> Mock:
    service = create_autospec(InitValidationService, instance=True, spec_set=True)
    application_services = SimpleNamespace(init_validation=service)
    monkeypatch.setattr(init_validate, "application_services", lambda: application_services)
    return service


def test_get_init_status_finished(app: Flask, init_validation: Mock) -> None:
    init_validation.is_validated.return_value = True
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="GET"):
        result = init_validate.get_init_status()

        assert result.status == "finished"


def test_get_init_status_not_started(app: Flask, init_validation: Mock) -> None:
    init_validation.is_validated.return_value = False
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="GET"):
        result = init_validate.get_init_status()

        assert result.status == "not_started"


def test_validate_init_password_already_setup(
    app: Flask,
    init_validation: Mock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(wraps.dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    init_validation.validate_password.side_effect = AlreadyInitializedError
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="POST"):
        with pytest.raises(AlreadySetupError):
            init_validate.validate_init_password(init_validate.InitValidatePayload(password="pw"))


def test_validate_init_password_wrong_password(
    app: Flask,
    init_validation: Mock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(wraps.dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    init_validation.validate_password.side_effect = InvalidInitializationPasswordError
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="POST"):
        with pytest.raises(InitValidateFailedError):
            init_validate.validate_init_password(init_validate.InitValidatePayload(password="wrong"))
        assert init_validate.session.get("is_init_validated") is False


def test_validate_init_password_success(
    app: Flask,
    init_validation: Mock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(wraps.dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="POST"):
        result = init_validate.validate_init_password(init_validate.InitValidatePayload(password="expected"))

        assert result.result == "success"
        assert init_validate.session.get("is_init_validated") is True
        init_validation.validate_password.assert_called_once_with("expected")


@pytest.mark.parametrize(
    ("session_value", "expected"),
    [
        pytest.param(None, False, id="missing"),
        pytest.param(False, False, id="not-validated"),
        pytest.param(True, True, id="validated"),
    ],
)
def test_is_init_validated_passes_session_state(
    app: Flask,
    init_validation: Mock,
    session_value: bool | None,
    expected: bool,
) -> None:
    init_validation.is_validated.return_value = True
    app.secret_key = "test-secret"

    with app.test_request_context("/console/api/init", method="GET"):
        if session_value is not None:
            init_validate.session["is_init_validated"] = session_value

        assert init_validate.is_init_validated() is True
        init_validation.is_validated.assert_called_once_with(session_validated=expected)
