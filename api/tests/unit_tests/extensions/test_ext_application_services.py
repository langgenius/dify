"""Tests for application-service dependency wiring."""

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from enums import DeploymentEdition
from extensions import ext_application_services
from extensions.ext_redis import RedisClientWrapper
from models.model import DifySetup
from services.init_validation_service import InvalidInitializationPasswordError


@pytest.mark.parametrize(
    ("deployment_edition", "initialization_password", "session_validated", "setup_exists", "expected"),
    [
        pytest.param(DeploymentEdition.CLOUD, "expected", False, False, True, id="cloud"),
        pytest.param(DeploymentEdition.COMMUNITY, "", False, False, True, id="no-password"),
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
    initialization_password: str,
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
        redis=MagicMock(spec=RedisClientWrapper),
    )

    assert services.init_validation.is_validated(session_validated=session_validated) is expected


def test_build_application_services_passes_the_expected_password(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="expected",
        redis=MagicMock(spec=RedisClientWrapper),
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
    monkeypatch.setattr(
        ext_application_services.dify_config,
        "DEPLOYMENT_EDITION",
        DeploymentEdition.COMMUNITY,
    )
    monkeypatch.setattr(ext_application_services.dify_config, "INIT_PASSWORD", "expected")

    ext_application_services.init_app(app)

    with app.app_context():
        services = ext_application_services.application_services()
        assert services is app.extensions["application_services"]
        assert services.init_validation.is_validated(session_validated=False) is False


@pytest.mark.parametrize(
    ("deployment_edition", "setup_completed"),
    [
        pytest.param(DeploymentEdition.CLOUD, True, id="cloud"),
        pytest.param(DeploymentEdition.COMMUNITY, False, id="community"),
        pytest.param(DeploymentEdition.ENTERPRISE, False, id="enterprise"),
    ],
)
def test_build_application_services_configures_setup_policy(
    sqlite_session_factory: sessionmaker[Session],
    deployment_edition: DeploymentEdition,
    setup_completed: bool,
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=deployment_edition,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    assert services.setup.get_status().completed is setup_completed


def test_build_application_services_wires_builtin_schema_definitions(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    definitions = services.schema_definitions.list()

    assert definitions
    assert all({"name", "label", "schema"} <= definition.keys() for definition in definitions)


def test_build_application_services_does_not_construct_schema_manager(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with patch("extensions.ext_application_services.SchemaManager") as schema_manager:
        ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=MagicMock(spec=RedisClientWrapper),
        )

    schema_manager.assert_not_called()
