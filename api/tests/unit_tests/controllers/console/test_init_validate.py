from types import SimpleNamespace
from unittest.mock import Mock, create_autospec

import pytest
from flask import Flask

from controllers.console import init_validate
from controllers.console.error import AlreadySetupError, InitValidateFailedError
from dify_app import DifyApp
from enums import DeploymentEdition
from extensions import ext_fastopenapi
from services.init_validation_service import (
    AlreadyInitializedError,
    InitValidationService,
    InvalidInitializationPasswordError,
)
from tests.helpers.unit.config_override import apply_config_overrides

"""HTTP contract tests for the FastOpenAPI initialization routes."""


class TestFastopenapiInitValidateCases:
    @staticmethod
    @pytest.fixture
    def init_validation(monkeypatch: pytest.MonkeyPatch) -> Mock:
        service = create_autospec(InitValidationService, instance=True, spec_set=True)
        services = SimpleNamespace(init_validation=service)
        monkeypatch.setattr(init_validate, "application_services", lambda: services)
        return service

    @staticmethod
    @pytest.fixture
    def app() -> DifyApp:
        app = DifyApp(__name__)
        app.config.update(TESTING=True, SECRET_KEY="test-secret")
        ext_fastopenapi.init_app(app)
        return app

    @staticmethod
    @pytest.mark.parametrize(
        ("validated", "expected_status"),
        [
            pytest.param(True, "finished", id="finished"),
            pytest.param(False, "not_started", id="not-started"),
        ],
    )
    def test_get_init_status(
        app: DifyApp,
        init_validation: Mock,
        validated: bool,
        expected_status: str,
    ) -> None:
        init_validation.is_validated.return_value = validated

        response = app.test_client().get("/console/api/init")

        assert response.status_code == 200
        assert response.get_json() == {"status": expected_status}
        init_validation.is_validated.assert_called_once_with(session_validated=False)

    @staticmethod
    def test_validate_init_password_success(
        app: DifyApp,
        init_validation: Mock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        client = app.test_client()

        response = client.post("/console/api/init", json={"password": "expected"})

        assert response.status_code == 201
        assert response.get_json() == {"result": "success"}
        init_validation.validate_password.assert_called_once_with("expected")
        with client.session_transaction() as browser_session:
            assert browser_session["is_init_validated"] is True

    @staticmethod
    def test_validate_init_password_rejects_a_mismatch(
        app: DifyApp,
        init_validation: Mock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        init_validation.validate_password.side_effect = InvalidInitializationPasswordError
        client = app.test_client()

        response = client.post("/console/api/init", json={"password": "wrong"})

        assert response.status_code == 401
        with client.session_transaction() as browser_session:
            assert browser_session["is_init_validated"] is False

    @staticmethod
    def test_validate_init_password_rejects_an_initialized_installation(
        app: DifyApp,
        init_validation: Mock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        init_validation.validate_password.side_effect = AlreadyInitializedError

        response = app.test_client().post("/console/api/init", json={"password": "expected"})

        assert response.status_code == 403

    @staticmethod
    @pytest.mark.parametrize(
        "payload",
        [
            pytest.param({}, id="missing-password"),
            pytest.param({"password": "x" * 31}, id="password-too-long"),
        ],
    )
    def test_validate_init_password_rejects_an_invalid_payload(
        app: DifyApp,
        init_validation: Mock,
        monkeypatch: pytest.MonkeyPatch,
        payload: dict[str, str],
    ) -> None:
        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)

        response = app.test_client().post("/console/api/init", json=payload)

        assert response.status_code == 422
        init_validation.validate_password.assert_not_called()

    @staticmethod
    def test_validate_init_password_is_not_available_in_cloud(
        app: DifyApp,
        init_validation: Mock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)

        response = app.test_client().post("/console/api/init", json={"password": "expected"})

        assert response.status_code == 404
        init_validation.validate_password.assert_not_called()


"""Tests for the Flask adapter around initialization validation."""


class TestInitValidateCases:
    @staticmethod
    @pytest.fixture
    def init_validation(monkeypatch: pytest.MonkeyPatch) -> Mock:
        service = create_autospec(InitValidationService, instance=True, spec_set=True)
        application_services = SimpleNamespace(init_validation=service)
        monkeypatch.setattr(init_validate, "application_services", lambda: application_services)
        return service

    @staticmethod
    def test_get_init_status_finished(app: Flask, init_validation: Mock) -> None:
        init_validation.is_validated.return_value = True
        app.secret_key = "test-secret"

        with app.test_request_context("/console/api/init", method="GET"):
            result = init_validate.get_init_status()

            assert result.status == "finished"

    @staticmethod
    def test_get_init_status_not_started(app: Flask, init_validation: Mock) -> None:
        init_validation.is_validated.return_value = False
        app.secret_key = "test-secret"

        with app.test_request_context("/console/api/init", method="GET"):
            result = init_validate.get_init_status()

            assert result.status == "not_started"

    @staticmethod
    def test_validate_init_password_already_setup(
        app: Flask,
        init_validation: Mock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        init_validation.validate_password.side_effect = AlreadyInitializedError
        app.secret_key = "test-secret"

        with app.test_request_context("/console/api/init", method="POST"), pytest.raises(AlreadySetupError):
            init_validate.validate_init_password(init_validate.InitValidatePayload(password="pw"))

    @staticmethod
    def test_validate_init_password_wrong_password(
        app: Flask,
        init_validation: Mock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        init_validation.validate_password.side_effect = InvalidInitializationPasswordError
        app.secret_key = "test-secret"

        with app.test_request_context("/console/api/init", method="POST"):
            with pytest.raises(InitValidateFailedError):
                init_validate.validate_init_password(init_validate.InitValidatePayload(password="wrong"))
            assert init_validate.session.get("is_init_validated") is False

    @staticmethod
    def test_validate_init_password_success(
        app: Flask,
        init_validation: Mock,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        app.secret_key = "test-secret"

        with app.test_request_context("/console/api/init", method="POST"):
            result = init_validate.validate_init_password(init_validate.InitValidatePayload(password="expected"))

            assert result.result == "success"
            assert init_validate.session.get("is_init_validated") is True
            init_validation.validate_password.assert_called_once_with("expected")

    @staticmethod
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
