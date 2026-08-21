import builtins
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock, create_autospec

import pytest
from flask.views import MethodView

from controllers.console import setup as setup_controller
from controllers.console import wraps
from controllers.console.error import AlreadySetupError, NotInitValidateError
from dify_app import DifyApp
from enums import DeploymentEdition
from extensions import ext_fastopenapi
from services.setup_service import (
    InitializationValidationRequiredError,
    SetupAlreadyCompletedError,
    SetupInput,
    SetupService,
    SetupStatus,
)

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def setup_service(monkeypatch: pytest.MonkeyPatch) -> Mock:
    service = create_autospec(SetupService, instance=True, spec_set=True)
    services = SimpleNamespace(setup=service)
    monkeypatch.setattr(setup_controller, "application_services", lambda: services)
    return service


@pytest.fixture
def app() -> DifyApp:
    app = DifyApp(__name__)
    app.config["TESTING"] = True
    ext_fastopenapi.init_app(app)
    return app


def test_console_setup_fastopenapi_get_not_started(app: DifyApp, setup_service: Mock) -> None:
    setup_service.get_status.return_value = SetupStatus(completed=False)

    response = app.test_client().get("/console/api/setup")

    assert response.status_code == 200
    assert response.get_json() == {"step": "not_started", "setup_at": None}


def test_console_setup_fastopenapi_get_finished(app: DifyApp, setup_service: Mock) -> None:
    setup_at = datetime(2026, 8, 6, 10, 30)
    setup_service.get_status.return_value = SetupStatus(completed=True, setup_at=setup_at)

    response = app.test_client().get("/console/api/setup")

    assert response.status_code == 200
    assert response.get_json() == {"step": "finished", "setup_at": "2026-08-06T10:30:00"}


def test_console_setup_fastopenapi_get_finished_without_setup_time(app: DifyApp, setup_service: Mock) -> None:
    setup_service.get_status.return_value = SetupStatus(completed=True)

    response = app.test_client().get("/console/api/setup")

    assert response.status_code == 200
    assert response.get_json() == {"step": "finished", "setup_at": None}


@pytest.mark.parametrize(
    "deployment_edition",
    [DeploymentEdition.COMMUNITY, DeploymentEdition.ENTERPRISE],
    ids=["community", "enterprise"],
)
def test_console_setup_fastopenapi_post_success(
    app: DifyApp,
    setup_service: Mock,
    monkeypatch: pytest.MonkeyPatch,
    deployment_edition: DeploymentEdition,
) -> None:
    monkeypatch.setattr(wraps.dify_config, "DEPLOYMENT_EDITION", deployment_edition)
    monkeypatch.setattr(setup_controller, "is_init_validated", lambda: True)
    mark_setup_completed = Mock()
    monkeypatch.setattr(setup_controller, "mark_setup_completed", mark_setup_completed)
    payload = {
        "email": "admin@example.com",
        "name": "Admin",
        "password": "Passw0rd1",
        "language": "en-US",
    }

    response = app.test_client().post(
        "/console/api/setup",
        json=payload,
        headers={"CF-Connecting-IP": "203.0.113.7"},
    )

    assert response.status_code == 201
    assert response.get_json() == {"result": "success"}
    setup_service.initialize.assert_called_once_with(
        SetupInput(
            email="admin@example.com",
            name="Admin",
            password="Passw0rd1",
            ip_address="203.0.113.7",
            language="en-US",
        ),
        initialization_validated=True,
    )
    mark_setup_completed.assert_called_once_with()


def test_console_setup_fastopenapi_post_rejects_cloud_edition(
    app: DifyApp,
    setup_service: Mock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(wraps.dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)

    response = app.test_client().post(
        "/console/api/setup",
        json={
            "email": "admin@example.com",
            "name": "Admin",
            "password": "Passw0rd1",
            "language": "en-US",
        },
    )

    assert response.status_code == 404
    setup_service.initialize.assert_not_called()


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param(
            {
                "email": "not-an-email",
                "name": "Admin",
                "password": "Passw0rd1",
                "language": "en-US",
            },
            id="invalid-email",
        ),
        pytest.param(
            {
                "email": "admin@example.com",
                "name": "Admin",
                "password": "short",
                "language": "en-US",
            },
            id="invalid-password",
        ),
        pytest.param(
            {
                "email": "admin@example.com",
                "name": "a" * 31,
                "password": "Passw0rd1",
                "language": "en-US",
            },
            id="name-too-long",
        ),
    ],
)
def test_console_setup_fastopenapi_post_rejects_invalid_payload_before_service_call(
    app: DifyApp,
    setup_service: Mock,
    monkeypatch: pytest.MonkeyPatch,
    payload: dict[str, str],
) -> None:
    monkeypatch.setattr(wraps.dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)

    response = app.test_client().post("/console/api/setup", json=payload)

    assert response.status_code == 422
    setup_service.initialize.assert_not_called()


@pytest.mark.parametrize(
    ("service_error", "expected_controller_error"),
    [
        pytest.param(SetupAlreadyCompletedError(), AlreadySetupError, id="already-setup"),
        pytest.param(
            InitializationValidationRequiredError(),
            NotInitValidateError,
            id="init-validation-required",
        ),
    ],
)
def test_console_setup_translates_service_errors_to_controller_errors(
    app: DifyApp,
    setup_service: Mock,
    monkeypatch: pytest.MonkeyPatch,
    service_error: Exception,
    expected_controller_error: type[Exception],
) -> None:
    monkeypatch.setattr(wraps.dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    monkeypatch.setattr(setup_controller, "is_init_validated", lambda: False)
    mark_setup_completed = Mock()
    monkeypatch.setattr(setup_controller, "mark_setup_completed", mark_setup_completed)
    setup_service.initialize.side_effect = service_error

    payload = setup_controller.SetupRequestPayload.model_validate(
        {
            "email": "admin@example.com",
            "name": "Admin",
            "password": "Passw0rd1",
            "language": "en-US",
        }
    )
    with app.test_request_context(
        "/console/api/setup",
        method="POST",
        headers={"CF-Connecting-IP": "203.0.113.7"},
    ):
        with pytest.raises(expected_controller_error) as raised:
            setup_controller.setup_system(payload)

    assert type(raised.value) is expected_controller_error
    mark_setup_completed.assert_not_called()


def test_console_setup_fastopenapi_does_not_mark_setup_completed_when_service_fails(
    app: DifyApp,
    setup_service: Mock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(wraps.dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    monkeypatch.setattr(setup_controller, "is_init_validated", lambda: True)
    mark_setup_completed = Mock()
    monkeypatch.setattr(setup_controller, "mark_setup_completed", mark_setup_completed)
    setup_service.initialize.side_effect = RuntimeError("provision failed")

    response = app.test_client().post(
        "/console/api/setup",
        json={
            "email": "admin@example.com",
            "name": "Admin",
            "password": "Passw0rd1",
            "language": "en-US",
        },
    )

    assert response.status_code == 500
    mark_setup_completed.assert_not_called()
