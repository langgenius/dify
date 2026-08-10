"""Tests for application-service dependency wiring."""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from enums import DeploymentEdition, WebAppAccessMode
from extensions import ext_application_services
from extensions.ext_redis import RedisClientWrapper
from models.model import AccountTrialAppRecord, DifySetup
from repositories.account_activation_repository import SQLAlchemyAccountActivationRepository
from repositories.account_integration_repository import SQLAlchemyAccountIntegrationRepository
from repositories.account_repository import SQLAlchemyAccountRepository
from services import recommended_app_catalog_gateway
from services.account_activation_adapters import (
    BillingAccountActivationEligibility,
    BillingWorkspaceMembershipCache,
    DeploymentWorkspaceInvitePolicy,
    RegisterServiceInvitationTokenStore,
)
from services.account_avatar_file_gateway import SQLAlchemyAccountAvatarFileGateway
from services.auth.data_source_api_key_auth_service import DataSourceApiKeyAuthService
from services.enterprise.enterprise_service import WebAppSettings
from services.errors.enterprise import EnterpriseAPIError, EnterpriseAPINotFoundError
from services.init_validation_service import InvalidInitializationPasswordError
from services.tag_application_service import TagApplicationService
from services.webapp_access_query_service import WebAppAccessUnavailableError


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


def test_build_application_services_wires_tag_boundary(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    assert isinstance(services.tags, TagApplicationService)


def test_build_application_services_wires_account_profile_repository(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    accounts = services.accounts.profile._accounts
    assert isinstance(accounts, SQLAlchemyAccountRepository)
    assert accounts._session_factory is sqlite_session_factory
    assert services.accounts.password._accounts is accounts
    assert services.accounts.initialization._accounts is accounts
    assert not services.accounts.initialization._invitation_required
    assert services.accounts.change_email._accounts is accounts
    assert services.accounts.education._accounts is accounts
    assert services.accounts.deletion._accounts is accounts
    assert services.accounts.deletion._memberships is services.workspace_queries._workspaces
    integrations = services.accounts.integrations._integrations
    assert isinstance(integrations, SQLAlchemyAccountIntegrationRepository)
    assert integrations._session_factory is sqlite_session_factory
    avatar_files = services.accounts.avatar._files
    assert isinstance(avatar_files, SQLAlchemyAccountAvatarFileGateway)
    assert avatar_files._session_factory is sqlite_session_factory


def test_build_application_services_requires_invitation_for_cloud_initialization(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.CLOUD,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    assert services.accounts.initialization._invitation_required


@pytest.mark.parametrize(
    ("deployment_edition", "billing_enabled"),
    [
        pytest.param(DeploymentEdition.CLOUD, True, id="cloud"),
        pytest.param(DeploymentEdition.COMMUNITY, False, id="community"),
        pytest.param(DeploymentEdition.ENTERPRISE, False, id="enterprise"),
    ],
)
def test_build_application_services_wires_account_activation(
    sqlite_session_factory: sessionmaker[Session],
    deployment_edition: DeploymentEdition,
    billing_enabled: bool,
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=deployment_edition,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    activation = services.account_activation
    assert isinstance(activation._tokens, RegisterServiceInvitationTokenStore)
    assert isinstance(activation._accounts, SQLAlchemyAccountActivationRepository)
    assert activation._accounts._session_factory is sqlite_session_factory
    assert isinstance(activation._workspace_policy, DeploymentWorkspaceInvitePolicy)
    assert isinstance(activation._eligibility, BillingAccountActivationEligibility)
    assert activation._eligibility._enabled is billing_enabled
    assert isinstance(activation._membership_cache, BillingWorkspaceMembershipCache)
    assert activation._membership_cache._enabled is billing_enabled


def test_build_application_services_wires_data_source_api_key_auth(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    assert isinstance(services.data_source_api_key_auth, DataSourceApiKeyAuthService)


def test_build_application_services_wires_trial_app_usage(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )
    app_id = str(uuid4())
    account_id = str(uuid4())

    services.trial_app_usage.record(app_id=app_id, account_id=account_id)

    with sqlite_session_factory() as session:
        record = session.scalar(
            select(AccountTrialAppRecord).where(
                AccountTrialAppRecord.app_id == app_id,
                AccountTrialAppRecord.account_id == account_id,
            )
        )
    assert record is not None
    assert record.count == 1


def test_build_application_services_adapts_enterprise_webapp_access_mode(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with (
        patch("extensions.ext_application_services.FeatureService.is_webapp_auth_enabled", return_value=True),
        patch(
            "extensions.ext_application_services.EnterpriseService.WebAppAuth.get_app_access_mode_by_id",
            return_value=SimpleNamespace(access_mode="private_all"),
        ) as get_access_mode,
    ):
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=MagicMock(spec=RedisClientWrapper),
        )
        result = services.webapp_access.get_access_mode(app_id="app-1", app_code=None)

    assert result is WebAppAccessMode.PRIVATE_ALL
    get_access_mode.assert_called_once_with("app-1")


@pytest.mark.parametrize(
    "enterprise_error",
    [
        pytest.param(EnterpriseAPINotFoundError(), id="not-found"),
        pytest.param(EnterpriseAPIError(), id="api-error"),
        pytest.param(httpx.ConnectError("connection failed"), id="transport"),
        pytest.param(json.JSONDecodeError("invalid", "", 0), id="invalid-json"),
        pytest.param(UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid"), id="invalid-encoding"),
        pytest.param(
            ValidationError.from_exception_data(WebAppSettings.__name__, []),
            id="invalid-response",
        ),
    ],
)
def test_build_application_services_maps_known_enterprise_errors(
    sqlite_session_factory: sessionmaker[Session],
    enterprise_error: Exception,
) -> None:
    with (
        patch("extensions.ext_application_services.FeatureService.is_webapp_auth_enabled", return_value=True),
        patch(
            "extensions.ext_application_services.EnterpriseService.WebAppAuth.get_app_access_mode_by_id",
            side_effect=enterprise_error,
        ),
    ):
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=MagicMock(spec=RedisClientWrapper),
        )

        with pytest.raises(WebAppAccessUnavailableError) as raised:
            services.webapp_access.get_access_mode(app_id="app-1", app_code=None)

    assert raised.value.__cause__ is enterprise_error


def test_build_application_services_maps_invalid_access_mode_to_unavailable(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with (
        patch("extensions.ext_application_services.FeatureService.is_webapp_auth_enabled", return_value=True),
        patch(
            "extensions.ext_application_services.EnterpriseService.WebAppAuth.get_app_access_mode_by_id",
            return_value=SimpleNamespace(access_mode="invalid"),
        ),
    ):
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=MagicMock(spec=RedisClientWrapper),
        )

        with pytest.raises(WebAppAccessUnavailableError) as raised:
            services.webapp_access.get_access_mode(app_id="app-1", app_code=None)

    assert isinstance(raised.value.__cause__, ValueError)


def test_build_application_services_does_not_hide_unknown_enterprise_errors(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    failure = TypeError("adapter bug")
    with (
        patch("extensions.ext_application_services.FeatureService.is_webapp_auth_enabled", return_value=True),
        patch(
            "extensions.ext_application_services.EnterpriseService.WebAppAuth.get_app_access_mode_by_id",
            side_effect=failure,
        ),
    ):
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=MagicMock(spec=RedisClientWrapper),
        )

        with pytest.raises(TypeError) as raised:
            services.webapp_access.get_access_mode(app_id="app-1", app_code=None)

    assert raised.value is failure


def test_build_application_services_wires_webapp_permission(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with (
        patch(
            "extensions.ext_application_services.FeatureService.is_webapp_auth_enabled", return_value=True
        ) as enabled,
        patch(
            "extensions.ext_application_services.EnterpriseService.WebAppAuth.get_app_access_mode_by_id",
            return_value=SimpleNamespace(access_mode="private"),
        ) as get_access_mode,
        patch(
            "extensions.ext_application_services.EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp",
            return_value=False,
        ) as is_user_allowed,
    ):
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=MagicMock(spec=RedisClientWrapper),
        )
        requires_permission = services.webapp_access.requires_permission_check("app-1")
        allowed = services.webapp_access.is_user_allowed(user_id="user-1", app_id="app-1")

    assert requires_permission is True
    assert allowed is False
    enabled.assert_called_once_with()
    get_access_mode.assert_called_once_with("app-1")
    is_user_allowed.assert_called_once_with("user-1", "app-1")


def test_webapp_permission_adapter_maps_connection_failure() -> None:
    failure = httpx.ConnectError("connection failed")
    with (
        patch(
            "extensions.ext_application_services.EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp",
            side_effect=failure,
        ),
        pytest.raises(WebAppAccessUnavailableError) as raised,
    ):
        ext_application_services._is_user_allowed_to_access_webapp("user-1", "app-1")

    assert raised.value.__cause__ is failure


def test_build_application_services_wires_dynamic_recommended_catalog(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ext_application_services.dify_config, "HOSTED_FETCH_APP_TEMPLATES_MODE", "builtin")
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    builtin_payload = json.dumps(
        {
            "recommended_apps": {
                "en-US": {
                    "recommended_apps": [{"app": None, "app_id": "app-1", "categories": []}],
                    "categories": [],
                }
            }
        }
    )
    with patch.object(recommended_app_catalog_gateway.Path, "read_text", return_value=builtin_payload):
        result = services.recommended_app_queries.list_recommended(
            requested_language="en-US",
            interface_language=None,
        )
    assert result.recommended_apps

    monkeypatch.setattr(ext_application_services.dify_config, "HOSTED_FETCH_APP_TEMPLATES_MODE", "invalid")
    with pytest.raises(ValueError, match="invalid fetch recommended apps mode: invalid"):
        services.recommended_app_queries.list_recommended(
            requested_language="en-US",
            interface_language=None,
        )
