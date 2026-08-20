"""Composition root for application services used by transport adapters."""

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

import httpx
from flask import Flask, current_app
from pydantic import ValidationError
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from constants.dsl_version import CURRENT_APP_DSL_VERSION
from core.db.session_factory import get_session_maker
from core.schemas.schema_manager import SchemaManager
from enums import DeploymentEdition, WebAppAccessMode
from extensions.ext_redis import RedisClientWrapper, redis_client
from libs.passport import PassportService
from repositories.account_activation_repository import SQLAlchemyAccountActivationRepository
from repositories.account_repository import SQLAlchemyAccountRepository
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from repositories.data_source_api_key_auth_repository import SQLAlchemyDataSourceApiKeyAuthBindingRepository
from repositories.explore_banner_query_repository import ExploreBannerQueryRepository
from repositories.installation_state_repository import InstallationStateRepository
from repositories.web_passport_repository import WebPassportRepository
from repositories.webapp_access_query_repository import WebAppAccessQueryRepository
from repositories.workspace_member_query_repository import WorkspaceMemberQueryRepository
from repositories.workspace_query_repository import WorkspaceQueryRepository
from services.account_activation_adapters import (
    BillingAccountActivationEligibility,
    BillingWorkspaceMembershipCache,
    DeploymentWorkspaceInvitePolicy,
    RegisterServiceInvitationTokenStore,
)
from services.account_activation_service import AccountActivationService
from services.account_profile_service import AccountProfileService
from services.app_definition_query_service import AppDefinitionQueryService
from services.auth.data_source_api_key_auth_gateways import (
    ProviderApiKeyAuthCredentialValidator,
    TenantApiKeyAuthCredentialEncryptor,
)
from services.auth.data_source_api_key_auth_service import DataSourceApiKeyAuthService
from services.enterprise.enterprise_service import EnterpriseService
from services.errors.enterprise import EnterpriseServiceError
from services.explore_banner_query_service import ExploreBannerQueryService
from services.feature_query_service import FeatureQueryService
from services.feature_service_gateway import FeatureServiceGateway
from services.file_service import FileService
from services.init_validation_service import InitValidationService
from services.inner_mail_service import InnerMailService
from services.schema_definition_service import SchemaDefinitionService
from services.setup_adapters import RedisSetupLock, RegisterServiceAccountProvisioner
from services.setup_service import SetupService
from services.system_feature_service import SystemFeatureService
from services.web_app_runtime_query_service import WebAppRuntimeQueryService
from services.web_passport_gateways import (
    DeploymentWebPassportAuthGateway,
    PassportTokenGateway,
)
from services.web_passport_service import WebPassportService
from services.webapp_access_query_service import (
    WebAppAccessQueryService,
    WebAppAccessUnavailableError,
)
from services.workspace_member_query_service import WorkspaceMemberQueryService
from services.workspace_member_role_resolver import DeploymentWorkspaceMemberRoleResolver
from services.workspace_plan_gateway import DeploymentWorkspacePlanGateway
from services.workspace_query_service import WorkspaceQueryService
from tasks.mail_inner_task import enqueue_inner_mail

_EXTENSION_KEY = "application_services"


def _get_enterprise_webapp_access_mode(app_id: str) -> WebAppAccessMode:
    try:
        settings = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id)
    except (EnterpriseServiceError, httpx.RequestError, json.JSONDecodeError, UnicodeDecodeError, ValidationError) as e:
        raise WebAppAccessUnavailableError from e
    try:
        return WebAppAccessMode(settings.access_mode)
    except ValueError as e:
        raise WebAppAccessUnavailableError from e


def _is_user_allowed_to_access_webapp(user_id: str, app_id: str) -> bool:
    try:
        return EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp(user_id, app_id)
    except (EnterpriseServiceError, httpx.RequestError, json.JSONDecodeError, UnicodeDecodeError) as e:
        raise WebAppAccessUnavailableError from e


@dataclass(frozen=True, slots=True)
class AccountServices:
    profile: AccountProfileService


@dataclass(frozen=True, slots=True)
class ApplicationServices:
    accounts: AccountServices
    account_activation: AccountActivationService
    app_definitions: AppDefinitionQueryService
    data_source_api_key_auth: DataSourceApiKeyAuthService
    webapp_access: WebAppAccessQueryService
    web_app_runtime: WebAppRuntimeQueryService
    explore_banner_queries: ExploreBannerQueryService
    schema_definitions: SchemaDefinitionService
    setup: SetupService
    feature_queries: FeatureQueryService
    init_validation: InitValidationService
    workspace_queries: WorkspaceQueryService
    workspace_member_queries: WorkspaceMemberQueryService
    inner_mail: InnerMailService
    web_passport: WebPassportService


def build_application_services(
    *,
    database_client: sessionmaker[Session],
    deployment_edition: DeploymentEdition,
    initialization_password: str,
    redis: RedisClientWrapper,
) -> ApplicationServices:
    installation_state = InstallationStateRepository(client=database_client)
    data_source_api_key_auth_bindings = SQLAlchemyDataSourceApiKeyAuthBindingRepository(session_factory=database_client)
    app_definition_repository = AppDefinitionQueryRepository(session_factory=database_client)
    feature_gateway = FeatureServiceGateway()
    return ApplicationServices(
        accounts=AccountServices(
            profile=AccountProfileService(accounts=SQLAlchemyAccountRepository(database_client)),
        ),
        account_activation=AccountActivationService(
            tokens=RegisterServiceInvitationTokenStore(),
            accounts=SQLAlchemyAccountActivationRepository(database_client),
            workspace_policy=DeploymentWorkspaceInvitePolicy(),
            eligibility=BillingAccountActivationEligibility(
                enabled=deployment_edition == DeploymentEdition.CLOUD,
            ),
            membership_cache=BillingWorkspaceMembershipCache(
                enabled=deployment_edition == DeploymentEdition.CLOUD,
            ),
        ),
        app_definitions=AppDefinitionQueryService(
            definitions=app_definition_repository,
            builtin_icon_url_prefix=(
                dify_config.CONSOLE_API_URL + "/console/api/workspaces/current/tool-provider/builtin/"
            ),
        ),
        data_source_api_key_auth=DataSourceApiKeyAuthService(
            bindings=data_source_api_key_auth_bindings,
            validator=ProviderApiKeyAuthCredentialValidator(),
            encryptor=TenantApiKeyAuthCredentialEncryptor(),
        ),
        webapp_access=WebAppAccessQueryService(
            access=WebAppAccessQueryRepository(session_factory=database_client),
            webapp_auth_enabled=SystemFeatureService.is_webapp_auth_enabled(deployment_edition=deployment_edition),
            access_mode_for_app=_get_enterprise_webapp_access_mode,
            is_user_allowed_for_app=_is_user_allowed_to_access_webapp,
        ),
        web_app_runtime=WebAppRuntimeQueryService(
            runtime=app_definition_repository,
            file_service=FileService(database_client),
            workspace_features=feature_gateway.get_workspace_features,
            files_url=dify_config.FILES_URL,
        ),
        explore_banner_queries=ExploreBannerQueryService(
            banners=ExploreBannerQueryRepository(client=database_client),
            enabled=SystemFeatureService.is_explore_banner_enabled(),
        ),
        schema_definitions=SchemaDefinitionService(source_factory=SchemaManager),
        setup=SetupService(
            state=installation_state,
            accounts=RegisterServiceAccountProvisioner(client=database_client),
            lock=RedisSetupLock(client=redis),
            setup_required=deployment_edition != DeploymentEdition.CLOUD,
        ),
        feature_queries=FeatureQueryService(
            features=feature_gateway,
            trial_models=SystemFeatureService.get_trial_models(),
            app_dsl_version=CURRENT_APP_DSL_VERSION,
        ),
        init_validation=InitValidationService(
            state=installation_state,
            validation_required=(deployment_edition != DeploymentEdition.CLOUD and bool(initialization_password)),
            expected_password=initialization_password,
        ),
        workspace_queries=WorkspaceQueryService(
            workspaces=WorkspaceQueryRepository(
                client=database_client,
            ),
            plans=DeploymentWorkspacePlanGateway(),
        ),
        workspace_member_queries=WorkspaceMemberQueryService(
            members=WorkspaceMemberQueryRepository(
                session_factory=database_client,
            ),
            roles=DeploymentWorkspaceMemberRoleResolver(),
        ),
        inner_mail=InnerMailService(dispatch=enqueue_inner_mail),
        web_passport=WebPassportService(
            passports=WebPassportRepository(
                session_factory=database_client,
                generate_session_id=lambda: str(uuid4()),
            ),
            auth=DeploymentWebPassportAuthGateway(
                webapp_auth_enabled=SystemFeatureService.is_webapp_auth_enabled(deployment_edition=deployment_edition),
                get_app_access_mode=EnterpriseService.WebAppAuth.get_app_access_mode_by_id,
            ),
            tokens=PassportTokenGateway(passport=PassportService()),
            now=lambda: datetime.now(UTC),
            access_token_expire_minutes=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES,
        ),
    )


def init_app(app: Flask) -> None:
    app.extensions[_EXTENSION_KEY] = build_application_services(
        database_client=get_session_maker(),
        deployment_edition=dify_config.DEPLOYMENT_EDITION,
        initialization_password=dify_config.INIT_PASSWORD,
        redis=redis_client,
    )


def application_services() -> ApplicationServices:
    """Return the application services bound to the current Flask app."""
    return cast(ApplicationServices, current_app.extensions[_EXTENSION_KEY])
