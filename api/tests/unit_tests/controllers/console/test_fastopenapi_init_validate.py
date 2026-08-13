"""HTTP contract tests for the FastOpenAPI initialization routes."""

from types import SimpleNamespace
from unittest.mock import Mock, create_autospec

import pytest

from controllers.console import init_validate
from dify_app import DifyApp
from enums import DeploymentEdition
from extensions import ext_fastopenapi
from services.init_validation_service import (
    AlreadyInitializedError,
    InitValidationService,
    InvalidInitializationPasswordError,
)


@pytest.fixture
def init_validation(monkeypatch: pytest.MonkeyPatch) -> Mock:
    service = create_autospec(InitValidationService, instance=True, spec_set=True)
    services = SimpleNamespace(init_validation=service)
    monkeypatch.setattr(init_validate, "application_services", lambda: services)
    return service


@pytest.fixture
def app() -> DifyApp:
    app = DifyApp(__name__)
    app.config.update(TESTING=True, SECRET_KEY="test-secret")
    ext_fastopenapi.init_app(app)
    return app


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


def test_validate_init_password_success(
    app: DifyApp,
    init_validation: Mock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "controllers.console.wraps.dify_config.DEPLOYMENT_EDITION",
        DeploymentEdition.COMMUNITY,
    )
    client = app.test_client()

    response = client.post("/console/api/init", json={"password": "expected"})

    assert response.status_code == 201
    assert response.get_json() == {"result": "success"}
    init_validation.validate_password.assert_called_once_with("expected")
    with client.session_transaction() as browser_session:
        assert browser_session["is_init_validated"] is True


def test_validate_init_password_rejects_a_mismatch(
    app: DifyApp,
    init_validation: Mock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "controllers.console.wraps.dify_config.DEPLOYMENT_EDITION",
        DeploymentEdition.COMMUNITY,
    )
    init_validation.validate_password.side_effect = InvalidInitializationPasswordError
    client = app.test_client()

    response = client.post("/console/api/init", json={"password": "wrong"})

    assert response.status_code == 401
    with client.session_transaction() as browser_session:
        assert browser_session["is_init_validated"] is False


def test_validate_init_password_rejects_an_initialized_installation(
    app: DifyApp,
    init_validation: Mock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "controllers.console.wraps.dify_config.DEPLOYMENT_EDITION",
        DeploymentEdition.COMMUNITY,
    )
    init_validation.validate_password.side_effect = AlreadyInitializedError

    response = app.test_client().post("/console/api/init", json={"password": "expected"})

    assert response.status_code == 403


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
    monkeypatch.setattr(
        "controllers.console.wraps.dify_config.DEPLOYMENT_EDITION",
        DeploymentEdition.COMMUNITY,
    )

    response = app.test_client().post("/console/api/init", json=payload)

    assert response.status_code == 422
    init_validation.validate_password.assert_not_called()


def test_validate_init_password_is_not_available_in_cloud(
    app: DifyApp,
    init_validation: Mock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "controllers.console.wraps.dify_config.DEPLOYMENT_EDITION",
        DeploymentEdition.CLOUD,
    )

    response = app.test_client().post("/console/api/init", json={"password": "expected"})

    assert response.status_code == 404
    init_validation.validate_password.assert_not_called()
