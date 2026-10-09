"""Composition root for application services used by transport adapters."""

import json
import logging
import time
from collections.abc import Mapping, Sequence
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
from core.tools.tool_file_manager import ToolFileManager
from enums import DeploymentEdition, WebAppAccessMode
from extensions.application_services.account import AccountServices, build_account_services
from extensions.application_services.agent import AgentAppServices, build_agent_app_services
from extensions.application_services.app import AppServices, build_app_api_key_service, build_app_services
from extensions.application_services.data_sources import (
    DataSourceServices,
    build_data_source_credentials,
    build_data_source_services,
)
from extensions.application_services.datasets import build_dataset_dependencies
from extensions.application_services.installed_app import InstalledAppServices, build_installed_app_services
from extensions.application_services.knowledge import (
    KnowledgeServices,
    build_dataset_api_key_service,
    build_knowledge_services,
)
from extensions.application_services.resource_access_token import build_resource_access_token_service
from extensions.application_services.trial_app import TrialAppServices, build_trial_app_services
from extensions.application_services.workflow import build_workflow_execution_dependencies, build_workflow_suggestions
from extensions.application_services.workflow_variables import (
    build_console_workflow_variables,
    build_workflow_variable_service,
)
from extensions.application_services.workspace import (
    WorkspaceServices,
    build_workspace_membership_services,
    build_workspace_services,
)
from extensions.ext_redis import RedisClientWrapper, redis_client
from extensions.ext_storage import storage
from libs.helper import RateLimiter
from libs.passport import PassportService
from models.model import EndUser
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.account_activation_repository import SQLAlchemyAccountActivationRepository
from repositories.account_integration_repository import SQLAlchemyAccountIntegrationRepository
from repositories.api_based_extension_repository import APIBasedExtensionRepository
from repositories.app.mcp_server_repository import AppMCPServerRepository
from repositories.app.site_command_repository import AppSiteCommandRepository
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from repositories.app_preview_query_repository import AppPreviewQueryRepository
from repositories.app_scoped_end_user_repository import AppScopedEndUserRepo
from repositories.app_statistic_query_repository import AppStatisticQueryRepository
from repositories.credentials.query_repository import CredentialQueryRepository
from repositories.explore_banner_query_repository import ExploreBannerQueryRepository
from repositories.factory import DifyAPIRepositoryFactory
from repositories.file_grant_repository import FileGrantRepository
from repositories.human_input_file_upload_repository import SQLAlchemyHumanInputFileUploadRepository
from repositories.installation_state_repository import InstallationStateRepository
from repositories.message_file_preview_repository import MessageFilePreviewQueryRepository
from repositories.oauth_device_token_repository import SQLAlchemyOAuthDeviceTokenRepository
from repositories.oauth_server_repository import RedisOAuthServerTokenRepository, SQLAlchemyOAuthServerRepository
from repositories.plugin_file_upload_repository import SQLAlchemyPluginFileUploadOwnerRepository
from repositories.recommended_app_catalog_repository import DatabaseRecommendedAppCatalogRepository
from repositories.saved_message_repository import SQLAlchemySavedMessageRepository
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from repositories.step_by_step_tour_repository import SQLAlchemyStepByStepTourStateRepository
from repositories.tag_repository import TagRepository
from repositories.trial_app_repository import TrialAppRepository
from repositories.upload_file_delivery_repository import UploadFileDeliveryQueryRepository
from repositories.web_passport_repository import WebPassportRepository
from repositories.webapp_access_query_repository import WebAppAccessQueryRepository
from repositories.workflow_app_log_query_repository import WorkflowAppLogQueryRepository
from repositories.workflow_run_archive_repository import WorkflowRunArchiveBundleQueryRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.account.adapters import (
    InstallationTelemetryGateway,
    RedisInvitationTokenStore,
)
from services.account.forgot_password_adapters import RedisForgotPasswordSecurityGateway
from services.account.forgot_password_service import (
    FORGOT_PASSWORD_SEND_RATE_LIMIT_MAX_ATTEMPTS,
    FORGOT_PASSWORD_SEND_RATE_LIMIT_PREFIX,
    FORGOT_PASSWORD_SEND_RATE_LIMIT_WINDOW_SECONDS,
)
from services.account.login_adapters import RedisConsoleAuthSecurityGateway
from services.account.service import AccountSetupProvisioner
from services.account_password_hasher import DefaultAccountPasswordHasher
from services.agent.roster_package_exporter import RosterAgentPackageExporter
from services.api_based_extension_adapters import APIBasedExtensionPingProbe, WorkspaceTokenCipher
from services.api_based_extension_application_service import APIBasedExtensionApplicationService
from services.app.advanced_prompt_template_service import AdvancedPromptTemplateService
from services.app.api_key_service import AppApiKeyService
from services.app.generation.runtime import AppGenerationRuntime
from services.app.mcp_server_service import AppMCPServerService
from services.app_audio_adapters import AppAudioRuntime
from services.app_audio_service import AppAudio
from services.app_definition_query_service import AppDefinitionQueryService
from services.app_preview_details_adapters import AppPreviewDetailsRuntime
from services.app_preview_details_service import AppPreviewDetails
from services.app_preview_query_service import AppPreviewQueryService
from services.app_scoped_end_user_query_service import AppScopedEndUserQueryService
from services.app_scoped_end_user_service import AppScopedEndUserService
from services.app_site_service import AppSiteService
from services.app_statistic_query import AppStatisticQuery
from services.app_task_service import AppTaskControlService
from services.app_tracing_config_gateway import OpsTraceManagerGateway
from services.app_tracing_config_service import AppTracingConfigService
from services.billing_portal_service import BillingPortalService
from services.billing_service import BillingService
from services.compliance_download_service import ComplianceDownloadService
from services.credentials.query import CredentialQuery
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.file_grant_entities import FileGrantLimits
from services.errors.enterprise import EnterpriseServiceError
from services.explore_banner_query_service import ExploreBannerQueryService
from services.feature_query_service import FeatureQueryService
from services.feature_service_gateway import FeatureServiceGateway
from services.file_grant_gateways import FileGrantFileGateway, FileGrantRemoteFileGateway, FileGrantTokenGateway
from services.file_grant_service import FileGrantService
from services.file_service import FileService
from services.human_input_file_upload_service import HumanInputFileUploadService
from services.init_validation_service import InitValidationService
from services.inner_mail_service import InnerMailService
from services.knowledge.api_key_service import DatasetApiKeyService
from services.message_file_preview_service import MessageFilePreviewService
from services.message_suggested_questions_adapters import MessageSuggestedQuestionsRuntime
from services.message_suggested_questions_service import MessageSuggestedQuestions
from services.notification_gateway import BillingNotificationGateway
from services.notification_service import NotificationService
from services.oauth_device_adapters import (
    DifyConfigOAuthDeviceSettings,
    EnterpriseOAuthDeviceSSOGateway,
    EnvironmentOAuthDeviceTokenTTLPolicy,
    OAuthDeviceTokenIssuanceGateway,
    RedisExternalApprovalLimiter,
)
from services.oauth_device_application_service import (
    DeviceWorkspaceQuery,
    OAuthDeviceAccountQuery,
    OAuthDeviceApplicationService,
)
from services.oauth_device_flow import DeviceFlowRedis
from services.oauth_server_service import OAUTH_ACCESS_TOKEN_EXPIRES_IN, OAuthServerService
from services.plugin_file_upload_gateway import ToolFilePluginUploadGateway
from services.plugin_file_upload_service import PluginFileUploadService
from services.recommended_app_catalog_gateway import (
    BuiltinRecommendedAppCatalogGateway,
    RecommendedAppCatalogRouter,
    RemoteRecommendedAppCatalogGateway,
)
from services.recommended_app_package_service import RecommendedAppPackageService
from services.recommended_app_query_service import RecommendedAppQueryService
from services.remote_file_service import RemoteFileService
from services.resource_access_token_service import ResourceAccessTokenService
from services.retention.workflow_run.archive_download_adapters import (
    dispatch_workflow_run_archive_download_task,
    sign_workflow_run_archive_download_url,
)
from services.retention.workflow_run.archive_download_task_cache import WorkflowRunArchiveDownloadTaskCache
from services.retention.workflow_run.archive_log_service import WorkflowRunArchiveService
from services.saved_message_service import SavedMessageService
from services.schema_definition_service import SchemaDefinitionService
from services.setup_adapters import RedisSetupLock
from services.setup_service import SetupService
from services.step_by_step_tour_service import StepByStepTourService
from services.system_feature_service import SystemFeatureService
from services.tag_application_service import TagApplicationService
from services.tool_file_download_service import ToolFileDownloadService
from services.upload_file_delivery_service import UploadFileDeliveryService
from services.web_app_runtime_query_service import WebAppRuntimeQueryService
from services.web_authentication_adapters import (
    AccountWebAuthenticationSecurityGateway,
    LoggingWebAuthenticationAuditGateway,
    PassportWebAppSessionGateway,
    TokenManagerWebAuthenticationGateway,
)
from services.web_authentication_service import WebAuthenticationService
from services.web_passport_gateways import (
    DeploymentWebPassportAuthGateway,
    PassportTokenGateway,
)
from services.web_passport_service import WebPassportService
from services.webapp_access_adapters import EnterpriseWebAppAccessPolicyGateway
from services.webapp_access_query_service import WebAppAccessQueryService, WebAppAccessUnavailableError
from services.workflow.console_variable_service import ConsoleWorkflowVariableService
from services.workflow.generation.suggestions import WorkflowInstructionSuggestions
from services.workflow.variable_service import WorkflowVariableService
from services.workflow_app_log_query_service import WorkflowAppLogQueryService
from services.workflow_run_service import WorkflowRunService
from services.workflow_statistic_query_service import WorkflowStatisticQueryService
from tasks.mail_inner_task import enqueue_inner_mail

logger = logging.getLogger(__name__)

_EXTENSION_KEY = "application_services"


# TODO: Normalize EnterpriseService.WebAppAuth result/error contracts in the SDK,
# migrate its callers, then inject its batch methods directly and remove these wrappers.
# Define SDK errors for timeouts, transport failures, upstream status and invalid
# responses before adding finer HTTP mappings; these wrappers report unavailability.
# Validate required fields and real booleans there, replacing legacy permission
# truthiness conversion. Missing fields currently become False, {} or a default mode.
# Replace response-shape ValueError/KeyError/AttributeError with typed SDK errors;
# ordinary ValueError can still reach the global 400 invalid_param handler. The
# lost field information cannot be recovered by translating exceptions here.
def _batch_get_enterprise_webapp_access_modes(*, app_ids: Sequence[str]) -> Mapping[str, WebAppAccessMode]:
    try:
        settings = EnterpriseService.WebAppAuth.batch_get_app_access_mode_by_id(list(app_ids))
    except (EnterpriseServiceError, httpx.RequestError, json.JSONDecodeError, UnicodeDecodeError, ValidationError) as e:
        raise WebAppAccessUnavailableError from e
    access_modes: dict[str, WebAppAccessMode] = {}
    for app_id, setting in settings.items():
        try:
            access_mode = WebAppAccessMode(setting.access_mode)
        except ValueError:
            logger.warning("Skipping invalid web app access mode %r for app %s", setting.access_mode, app_id)
            continue
        access_modes[app_id] = access_mode
    return access_modes


def _batch_get_enterprise_webapp_user_permissions(*, user_id: str, app_ids: Sequence[str]) -> Mapping[str, bool]:
    try:
        permissions = EnterpriseService.WebAppAuth.batch_is_user_allowed_to_access_webapps(
            user_id=user_id, app_ids=list(app_ids)
        )
    except (EnterpriseServiceError, httpx.RequestError, json.JSONDecodeError, UnicodeDecodeError) as e:
        raise WebAppAccessUnavailableError from e
    return {app_id: bool(allowed) for app_id, allowed in permissions.items()}


@dataclass(frozen=True, slots=True)
class AppScopedEndUserServices:
    commands: AppScopedEndUserService[EndUser]
    queries: AppScopedEndUserQueryService


@dataclass(frozen=True, slots=True)
class ApplicationServices:
    workflow_runtime: AppGenerationRuntime
    workflow_variables: WorkflowVariableService
    console_workflow_variables: ConsoleWorkflowVariableService
    workflow_suggestions: WorkflowInstructionSuggestions
    agent_apps: AgentAppServices
    advanced_prompt_templates: AdvancedPromptTemplateService
    api_based_extensions: APIBasedExtensionApplicationService
    credential_queries: CredentialQuery
    accounts: AccountServices
    app_api_keys: AppApiKeyService
    dataset_api_keys: DatasetApiKeyService
    resource_access_tokens: ResourceAccessTokenService
    apps: AppServices
    app_definitions: AppDefinitionQueryService
    app_mcp_servers: AppMCPServerService
    app_preview_details: AppPreviewDetails
    app_previews: AppPreviewQueryService
    app_sites: AppSiteService
    app_statistics: AppStatisticQuery
    app_tracing_configs: AppTracingConfigService
    billing_portal: BillingPortalService
    compliance_downloads: ComplianceDownloadService
    data_sources: DataSourceServices
    knowledge: KnowledgeServices
    app_scoped_end_users: AppScopedEndUserServices
    webapp_access: WebAppAccessQueryService
    web_authentication: WebAuthenticationService
    web_app_runtime: WebAppRuntimeQueryService
    explore_banner_queries: ExploreBannerQueryService
    schema_definitions: SchemaDefinitionService
    setup: SetupService
    feature_queries: FeatureQueryService
    file_grants: FileGrantService
    files: FileService
    human_input_file_uploads: HumanInputFileUploadService
    message_file_previews: MessageFilePreviewService
    message_suggested_questions: MessageSuggestedQuestions
    plugin_file_uploads: PluginFileUploadService
    tool_file_downloads: ToolFileDownloadService
    upload_file_delivery: UploadFileDeliveryService
    oauth_server: OAuthServerService
    oauth_device: OAuthDeviceApplicationService
    init_validation: InitValidationService
    installed_apps: InstalledAppServices
    notifications: NotificationService
    step_by_step_tour: StepByStepTourService
    recommended_app_queries: RecommendedAppQueryService
    recommended_app_packages: RecommendedAppPackageService
    remote_files: RemoteFileService
    saved_messages: SavedMessageService
    app_tasks: AppTaskControlService
    app_audio: AppAudio
    trial_apps: TrialAppServices
    workflow_run_archives: WorkflowRunArchiveService
    workflow_runs: WorkflowRunService
    workspaces: WorkspaceServices
    workflow_app_logs: WorkflowAppLogQueryService
    inner_mail: InnerMailService
    web_passport: WebPassportService
    tags: TagApplicationService
    workflow_statistics: WorkflowStatisticQueryService


def _build_oauth_server_service(
    *,
    database_client: sessionmaker[Session],
    redis: RedisClientWrapper,
) -> OAuthServerService:
    return OAuthServerService(
        repository=SQLAlchemyOAuthServerRepository(session_factory=database_client),
        tokens=RedisOAuthServerTokenRepository(redis=redis),
        access_token_expires_in=OAUTH_ACCESS_TOKEN_EXPIRES_IN,
    )


def _build_oauth_device_service(
    *,
    database_client: sessionmaker[Session],
    redis: RedisClientWrapper,
    accounts: OAuthDeviceAccountQuery,
    workspaces: DeviceWorkspaceQuery,
) -> OAuthDeviceApplicationService:
    token_repository = SQLAlchemyOAuthDeviceTokenRepository(session_factory=database_client, redis=redis)
    return OAuthDeviceApplicationService(
        store=DeviceFlowRedis(redis),
        accounts=accounts,
        workspaces=workspaces,
        tokens=OAuthDeviceTokenIssuanceGateway(
            tokens=token_repository,
            ttl_policy=EnvironmentOAuthDeviceTokenTTLPolicy(),
        ),
        sessions=token_repository,
        sso=EnterpriseOAuthDeviceSSOGateway(
            redis=redis,
            enterprise_service=EnterpriseService(),
        ),
        external_approval_limiter=RedisExternalApprovalLimiter(redis=redis),
        settings=DifyConfigOAuthDeviceSettings(),
    )


def _build_file_grant_service(*, database_client: sessionmaker[Session]) -> FileGrantService:
    repository = FileGrantRepository(session_factory=database_client)
    return FileGrantService(
        repository=repository,
        files=FileGrantFileGateway(
            load_end_user=repository.get_end_user,
            subject_exists=repository.subject_exists,
            file_service=FileService(session_factory=database_client),
            tool_files=ToolFileManager(),
            storage=storage,
        ),
        remote_files=FileGrantRemoteFileGateway(),
        tokens=FileGrantTokenGateway(
            secret_key=dify_config.SECRET_KEY,
            external_files_url=dify_config.FILES_URL,
            internal_files_url=dify_config.INTERNAL_FILES_URL or dify_config.FILES_URL,
            content_token_ttl_seconds=dify_config.FILES_ACCESS_TIMEOUT,
            now=lambda: int(time.time()),
        ),
        limits=FileGrantLimits(
            file_size_limit=dify_config.UPLOAD_FILE_SIZE_LIMIT,
            image_file_size_limit=dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT,
            audio_file_size_limit=dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT,
            video_file_size_limit=dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT,
            workflow_file_upload_limit=dify_config.WORKFLOW_FILE_UPLOAD_LIMIT,
            batch_count_limit=dify_config.UPLOAD_FILE_BATCH_LIMIT,
        ),
        now=lambda: int(time.time()),
    )


def build_application_services(
    *,
    database_client: sessionmaker[Session],
    deployment_edition: DeploymentEdition,
    initialization_password: str,
    redis: RedisClientWrapper,
) -> ApplicationServices:
    installation_state = InstallationStateRepository(session_factory=database_client)
    app_definition_repository = AppDefinitionQueryRepository(session_factory=database_client)
    app_definitions = AppDefinitionQueryService(
        definitions=app_definition_repository,
        builtin_icon_url_prefix=(
            dify_config.CONSOLE_API_URL + "/console/api/workspaces/current/tool-provider/builtin/"
        ),
    )
    webapp_auth_enabled = SystemFeatureService.is_webapp_auth_enabled(deployment_edition=deployment_edition)
    webapp_access_repository = WebAppAccessQueryRepository(session_factory=database_client)
    webapp_access = WebAppAccessQueryService(
        access=webapp_access_repository,
        policy=EnterpriseWebAppAccessPolicyGateway(webapp_auth=EnterpriseService.WebAppAuth),
        webapp_auth_enabled=webapp_auth_enabled,
        get_access_modes=_batch_get_enterprise_webapp_access_modes,
        get_user_permissions=_batch_get_enterprise_webapp_user_permissions,
    )
    app_preview_repository = AppPreviewQueryRepository(session_factory=database_client)
    feature_gateway = FeatureServiceGateway()
    accounts = SQLAlchemyAccountRepository(session_factory=database_client)
    integrations = SQLAlchemyAccountIntegrationRepository(session_factory=database_client)
    trial_app_enabled = SystemFeatureService.is_trial_app_enabled()
    trial_apps = TrialAppRepository(session_factory=database_client)
    database_catalog = DatabaseRecommendedAppCatalogRepository(session_factory=database_client, redis=redis)
    builtin_catalog = BuiltinRecommendedAppCatalogGateway()
    remote_catalog = RemoteRecommendedAppCatalogGateway()
    recommended_app_catalog = RecommendedAppCatalogRouter(
        remote=remote_catalog,
        database=database_catalog,
        builtin=builtin_catalog,
    )
    workspace_repository = WorkspaceRepository(session_factory=database_client)
    recommended_app_queries = RecommendedAppQueryService(
        catalog=recommended_app_catalog,
        trial_apps=trial_apps,
        trial_enabled=trial_app_enabled,
    )
    recommended_app_packages = RecommendedAppPackageService(
        sources=database_catalog, exporter=RosterAgentPackageExporter()
    )
    dataset_dependencies = build_dataset_dependencies(
        database_client=database_client,
        workspace_roles=workspace_repository,
    )
    datasource_credentials = build_data_source_credentials(database_client=database_client)
    data_sources = build_data_source_services(
        database_client=database_client,
        dataset_access=dataset_dependencies.access,
        datasets=dataset_dependencies.datasets,
        documents=dataset_dependencies.documents,
        actor_credentials=datasource_credentials.actor,
        providers=datasource_credentials.providers,
    )
    oauth_server = _build_oauth_server_service(database_client=database_client, redis=redis)
    apps = build_app_services(
        database_client=database_client,
        oauth=oauth_server,
        recommended_packages=recommended_app_packages,
    )
    tags = TagApplicationService(tags=TagRepository(session_factory=database_client))
    knowledge = build_knowledge_services(
        database_client=database_client,
        dataset_access=dataset_dependencies.access,
        datasets=dataset_dependencies.datasets,
        documents=dataset_dependencies.documents,
        actor_credentials=datasource_credentials.actor,
        stored_credentials=datasource_credentials.stored,
        providers=datasource_credentials.providers,
        redis=redis,
        tags=tags,
        app_queries=apps.queries,
    )
    app_scoped_end_user_repository = AppScopedEndUserRepo(session_factory=database_client)
    file_service = FileService(session_factory=database_client)
    remote_file_service = RemoteFileService(files=file_service)
    passwords = DefaultAccountPasswordHasher()
    web_authentication_tokens = TokenManagerWebAuthenticationGateway(
        reset_password_rate_limiter=RateLimiter(
            prefix=FORGOT_PASSWORD_SEND_RATE_LIMIT_PREFIX,
            max_attempts=FORGOT_PASSWORD_SEND_RATE_LIMIT_MAX_ATTEMPTS,
            time_window=FORGOT_PASSWORD_SEND_RATE_LIMIT_WINDOW_SECONDS,
            redis_client=redis,
        ),
        access_token_expire_minutes=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES,
    )
    invitation_tokens = RedisInvitationTokenStore(redis=redis)
    activation_accounts = SQLAlchemyAccountActivationRepository(session_factory=database_client)
    workflow_run_repository = DifyAPISQLAlchemyWorkflowRunRepository(session_maker=database_client)
    workflow_node_execution_repository = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
        session_maker=database_client
    )
    workspace_members, workspace_provisioning = build_workspace_membership_services(
        database_client=database_client,
        workspaces=workspace_repository,
        accounts=accounts,
    )
    account_services = build_account_services(
        database_client=database_client,
        deployment_edition=deployment_edition,
        redis=redis,
        accounts=accounts,
        integrations=integrations,
        workspace_repository=workspace_repository,
        workspace_provisioning=workspace_provisioning,
        passwords=passwords,
        invitation_tokens=invitation_tokens,
        activation_accounts=activation_accounts,
    )
    workspace_services = build_workspace_services(
        workspaces=workspace_repository,
        accounts=accounts,
        files=file_service,
        redis=redis,
        members=workspace_members,
        provisioning=workspace_provisioning,
        registration=account_services.lifecycle,
        invitation_tokens=invitation_tokens,
    )
    workflow_variables = build_workflow_variable_service(database_client=database_client)
    return ApplicationServices(
        workflow_runtime=build_workflow_execution_dependencies(database_client),
        workflow_variables=workflow_variables,
        console_workflow_variables=build_console_workflow_variables(
            database_client=database_client, variables=workflow_variables
        ),
        workflow_suggestions=build_workflow_suggestions(database_client),
        accounts=account_services,
        apps=apps,
        credential_queries=CredentialQueryRepository(session_factory=database_client),
        agent_apps=build_agent_app_services(database_client=database_client),
        advanced_prompt_templates=AdvancedPromptTemplateService(),
        app_definitions=app_definitions,
        app_mcp_servers=AppMCPServerService(
            servers=AppMCPServerRepository(session_factory=database_client),
        ),
        app_preview_details=AppPreviewDetailsRuntime(details=app_preview_repository),
        app_previews=AppPreviewQueryService(
            apps=app_preview_repository,
            is_previewable=recommended_app_queries.is_previewable,
        ),
        app_sites=AppSiteService(
            sites=AppSiteCommandRepository(session_factory=database_client),
        ),
        app_api_keys=build_app_api_key_service(database_client=database_client),
        dataset_api_keys=build_dataset_api_key_service(
            database_client=database_client,
            dataset_access=dataset_dependencies.access,
        ),
        resource_access_tokens=build_resource_access_token_service(database_client=database_client),
        app_statistics=AppStatisticQueryRepository(session_factory=database_client),
        app_tracing_configs=AppTracingConfigService(
            configs=SQLAlchemyAppTracingConfigRepository(session_factory=database_client),
            provider=OpsTraceManagerGateway(),
        ),
        billing_portal=BillingPortalService(
            accounts=accounts,
            get_subscription=BillingService.get_subscription,
            get_invoices=BillingService.get_invoices,
        ),
        compliance_downloads=ComplianceDownloadService(
            fetch_link=BillingService.get_compliance_download_link,
            rate_limiter=RateLimiter(
                prefix="compliance_download_rate_limiter",
                max_attempts=4,
                time_window=60,
                redis_client=redis,
            ),
        ),
        data_sources=data_sources,
        knowledge=knowledge,
        app_scoped_end_users=AppScopedEndUserServices(
            commands=AppScopedEndUserService(end_users=app_scoped_end_user_repository),
            queries=AppScopedEndUserQueryService(end_users=app_scoped_end_user_repository),
        ),
        webapp_access=webapp_access,
        web_authentication=WebAuthenticationService(
            accounts=accounts,
            passwords=passwords,
            tokens=web_authentication_tokens,
            security=AccountWebAuthenticationSecurityGateway(
                password_security=RedisForgotPasswordSecurityGateway(
                    redis=redis,
                    email_send_ip_limit_per_minute=dify_config.EMAIL_SEND_IP_LIMIT_PER_MINUTE,
                    verification_lockout_duration=dify_config.FORGOT_PASSWORD_LOCKOUT_DURATION,
                ),
                login_security=RedisConsoleAuthSecurityGateway(redis=redis),
            ),
            app_access=webapp_access,
            app_sessions=PassportWebAppSessionGateway(
                sessions=webapp_access_repository,
                app_access=webapp_access,
            ),
            audit=LoggingWebAuthenticationAuditGateway(logger=logging.getLogger("controllers.web.login")),
            private_app_access_enabled=deployment_edition == DeploymentEdition.ENTERPRISE,
        ),
        installed_apps=build_installed_app_services(
            database_client=database_client,
            webapp_access=webapp_access,
            get_workspace_role=workspace_repository.get_account_role,
            webapp_auth_enabled=webapp_auth_enabled,
        ),
        web_app_runtime=WebAppRuntimeQueryService(
            runtime=app_definition_repository,
            file_service=file_service,
            workspace_features=feature_gateway.get_workspace_features,
            files_url=dify_config.FILES_URL,
            deployment_edition=deployment_edition,
        ),
        explore_banner_queries=ExploreBannerQueryService(
            banners=ExploreBannerQueryRepository(session_factory=database_client),
            enabled=SystemFeatureService.is_explore_banner_enabled(),
        ),
        schema_definitions=SchemaDefinitionService(source_factory=SchemaManager),
        setup=SetupService(
            state=installation_state,
            accounts=AccountSetupProvisioner(
                accounts=account_services.lifecycle,
                workspaces=workspace_services.provisioning,
                installation=installation_state,
                telemetry=InstallationTelemetryGateway(session_factory=database_client),
            ),
            lock=RedisSetupLock(client=redis),
            setup_required=deployment_edition != DeploymentEdition.CLOUD,
        ),
        feature_queries=FeatureQueryService(
            features=feature_gateway,
            app_dsl_version=CURRENT_APP_DSL_VERSION,
        ),
        file_grants=_build_file_grant_service(database_client=database_client),
        files=file_service,
        human_input_file_uploads=HumanInputFileUploadService(
            uploads=SQLAlchemyHumanInputFileUploadRepository(session_factory=database_client),
            workflow_run_repository=DifyAPIRepositoryFactory.create_api_workflow_run_repository(
                session_maker=database_client,
            ),
            files=file_service,
            remote_files=remote_file_service,
        ),
        message_file_previews=MessageFilePreviewService(
            files=MessageFilePreviewQueryRepository(session_factory=database_client),
            storage=storage,
        ),
        message_suggested_questions=MessageSuggestedQuestionsRuntime(session_factory=database_client),
        plugin_file_uploads=PluginFileUploadService(
            owners=SQLAlchemyPluginFileUploadOwnerRepository(session_factory=database_client),
            files=ToolFilePluginUploadGateway(tool_files=ToolFileManager()),
        ),
        tool_file_downloads=ToolFileDownloadService(tool_files=ToolFileManager()),
        upload_file_delivery=UploadFileDeliveryService(
            files=UploadFileDeliveryQueryRepository(session_factory=database_client),
            storage=storage,
        ),
        oauth_server=oauth_server,
        oauth_device=_build_oauth_device_service(
            database_client=database_client,
            redis=redis,
            accounts=accounts,
            workspaces=workspace_repository,
        ),
        init_validation=InitValidationService(
            state=installation_state,
            validation_required=(deployment_edition != DeploymentEdition.CLOUD and bool(initialization_password)),
            expected_password=initialization_password,
        ),
        notifications=NotificationService(
            notifications=BillingNotificationGateway(),
        ),
        step_by_step_tour=StepByStepTourService(
            accounts=accounts,
            states=SQLAlchemyStepByStepTourStateRepository(session_factory=database_client),
            enabled=dify_config.ENABLE_STEP_BY_STEP_TOUR,
            rollout_started_at=dify_config.STEP_BY_STEP_TOUR_ROLLOUT_STARTED_AT,
        ),
        recommended_app_queries=recommended_app_queries,
        recommended_app_packages=recommended_app_packages,
        remote_files=remote_file_service,
        saved_messages=SavedMessageService(
            saved_messages=SQLAlchemySavedMessageRepository(session_factory=database_client),
        ),
        app_tasks=AppTaskControlService(redis_client=redis),
        app_audio=AppAudioRuntime(session_factory=database_client),
        trial_apps=build_trial_app_services(database_client=database_client, trial_apps=trial_apps),
        workflow_run_archives=WorkflowRunArchiveService(
            bundles=WorkflowRunArchiveBundleQueryRepository(session_factory=database_client),
            tasks=WorkflowRunArchiveDownloadTaskCache(redis=redis),
            dispatcher=dispatch_workflow_run_archive_download_task,
            sign_download_url=sign_workflow_run_archive_download_url,
        ),
        workflow_runs=WorkflowRunService(
            workflow_runs=workflow_run_repository,
            node_executions=workflow_node_execution_repository,
        ),
        workspaces=workspace_services,
        workflow_app_logs=WorkflowAppLogQueryService(
            logs=WorkflowAppLogQueryRepository(session_factory=database_client),
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
        api_based_extensions=APIBasedExtensionApplicationService(
            extensions=APIBasedExtensionRepository(session_factory=database_client),
            secrets=WorkspaceTokenCipher(),
            probe=APIBasedExtensionPingProbe(),
        ),
        tags=tags,
        workflow_statistics=WorkflowStatisticQueryService(
            workflow_runs=DifyAPIRepositoryFactory.create_api_workflow_run_repository(
                session_maker=database_client,
            ),
        ),
    )


def init_app(app: Flask) -> None:
    from extensions.ext_login import bind_account_loader

    services = build_application_services(
        database_client=get_session_maker(),
        deployment_edition=dify_config.DEPLOYMENT_EDITION,
        initialization_password=dify_config.INIT_PASSWORD,
        redis=redis_client,
    )
    app.extensions[_EXTENSION_KEY] = services
    bind_account_loader(app, services.accounts.identity.load_user)


def application_services() -> ApplicationServices:
    """Return the application services bound to the current Flask app."""
    return cast(ApplicationServices, current_app.extensions[_EXTENSION_KEY])
