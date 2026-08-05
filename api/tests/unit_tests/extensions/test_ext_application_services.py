"""Tests for application-service dependency wiring."""

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from enums.deployment_edition import DeploymentEdition
from extensions import ext_application_services
from models.model import DifySetup
from services.init_validation_service import InvalidInitializationPasswordError


@pytest.mark.parametrize(
    ("deployment_edition", "initialization_password", "session_validated", "setup_exists", "expected"),
    [
        pytest.param(DeploymentEdition.CLOUD, "expected", False, False, True, id="cloud"),
        pytest.param(DeploymentEdition.COMMUNITY, None, False, False, True, id="no-password"),
        pytest.param(DeploymentEdition.COMMUNITY, "", False, False, True, id="empty-password"),
        pytest.param(DeploymentEdition.COMMUNITY, "expected", False, False, False, id="not-validated"),
        pytest.param(DeploymentEdition.ENTERPRISE, "expected", False, False, False, id="enterprise"),
        pytest.param(DeploymentEdition.COMMUNITY, "expected", True, False, True, id="browser-session"),
        pytest.param(DeploymentEdition.COMMUNITY, "expected", False, True, True, id="setup-record"),
    ],
)
def test_build_application_services_configures_init_validation(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    deployment_edition: DeploymentEdition,
    initialization_password: str | None,
    session_validated: bool,
    setup_exists: bool,
    expected: bool,
) -> None:
    if setup_exists:
        sqlite_session.add(DifySetup(version="test-version"))
        sqlite_session.commit()

    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=deployment_edition,
        initialization_password=initialization_password,
    )

    assert services.init_validation.is_validated(session_validated=session_validated) is expected


def test_build_application_services_passes_the_expected_password(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="expected",
    )

    services.init_validation.validate_password("expected")
    with pytest.raises(InvalidInitializationPasswordError):
        services.init_validation.validate_password("wrong")


def test_init_app_registers_services_for_the_current_app(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app = Flask(__name__)
    monkeypatch.setattr(ext_application_services, "get_session_maker", lambda: sqlite_session_factory)
    monkeypatch.setattr(ext_application_services.dify_config, "EDITION", "SELF_HOSTED")
    monkeypatch.setattr(ext_application_services.dify_config, "ENTERPRISE_ENABLED", False)
    monkeypatch.setattr(ext_application_services.dify_config, "INIT_PASSWORD", "expected")

    ext_application_services.init_app(app)

    with app.app_context():
        services = ext_application_services.application_services()
        assert services is app.extensions["application_services"]
        assert services.init_validation.is_validated(session_validated=False) is False
