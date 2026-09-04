"""Composition root for application services used by transport adapters."""

import json
import time
from collections.abc import Mapping
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
from constants.languages import languages
from core.db.session_factory import get_session_maker
from core.helper.ssrf_proxy import ssrf_proxy
from core.schemas.schema_manager import SchemaManager
from core.tools.tool_file_manager import ToolFileManager
from enums import DeploymentEdition, WebAppAccessMode
from extensions.ext_redis import RedisClientWrapper, redis_client
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from libs.helper import RateLimiter
from libs.oauth import GitHubOAuth, GoogleOAuth
from libs.passport import PassportService
from repositories.account_activation_repository import SQLAlchemyAccountActivationRepository
from repositories.account_integration_repository import SQLAlchemyAccountIntegrationRepository
from repositories.account_oauth_repository import (
    AccountServiceOAuthAccountRegistrationGateway,
    AccountServiceOAuthSessionGateway,
    AccountServiceOAuthWorkspaceGateway,
    RegisterServiceOAuthInvitationGateway,
)
from repositories.account_repository import SQLAlchemyAccountRepository
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from repositories.app_site_command_repository import AppSiteCommandRepository
from repositories.data_source_api_key_auth_repository import SQLAlchemyDataSourceApiKeyAuthBindingRepository
from repositories.data_source_oauth_binding_repository import SQLAlchemyDataSourceOAuthBindingRepository
from repositories.explore_banner_query_repository import ExploreBannerQueryRepository
from repositories.factory import DifyAPIRepositoryFactory
from repositories.file_grant_repository import FileGrantRepository
from repositories.installation_state_repository import InstallationStateRepository
from repositories.oauth_server_repository import RedisOAuthServerTokenRepository, SQLAlchemyOAuthServerRepository
from repositories.recommended_app_catalog_repository import DatabaseRecommendedAppCatalogRepository
from repositories.step_by_step_tour_repository import SQLAlchemyStepByStepTourStateRepository
from repositories.tag_repository import TagRepository
from repositories.trial_app_query_repository import TrialAppQueryRepository
from repositories.trial_app_usage_repository import TrialAppUsageRepository
from repositories.web_passport_repository import WebPassportRepository
from repositories.webapp_access_query_repository import WebAppAccessQueryRepository
from repositories.workflow_run_archive_repository import WorkflowRunArchiveBundleQueryRepository
from repositories.workspace_member_query_repository import WorkspaceMemberQueryRepository
from repositories.workspace_query_repository import WorkspaceQueryRepository
from services.account_activation_service import AccountActivationService
from services.account_adapters import (
    BillingAccountActivationEligibility,
    BillingAccountDeletionFeedbackGateway,
    BillingAccountEducationGateway,
    BillingAccountEmailPolicyGateway,
    BillingWorkspaceMembershipCache,
    CeleryAccountDeletionScheduler,
    CeleryAccountDeletionVerificationNotifier,
    CeleryChangeEmailNotificationGateway,
    DeploymentWorkspaceInvitePolicy,
    EnterpriseAccountDeletionSyncGateway,
    RateLimiterChangeEmailSendLimiter,
    RBACWorkspaceMemberAccessSync,
    RedisChangeEmailSecurityGateway,
    RedisInvitationTokenStore,
    SecureChangeEmailCodeGenerator,
    TokenManagerAccountDeletionVerificationGateway,
    TokenManagerChangeEmailTokenGateway,
)
from services.account_avatar_file_gateway import SQLAlchemyAccountAvatarFileGateway
from services.account_avatar_service import AccountAvatarService
from services.account_change_email_service import AccountChangeEmailService
from services.account_deletion_feedback_service import AccountDeletionFeedbackService
from services.account_deletion_service import AccountDeletionService
from services.account_education_service import AccountEducationService
from services.account_email_registration_adapters import (
    AccountServiceRegistrationGateway,
    BillingAccountRegistrationPolicyGateway,
    CeleryEmailRegistrationNotificationGateway,
    RateLimiterEmailRegistrationSendLimiter,
    RedisEmailRegistrationSecurityGateway,
    SecureEmailRegistrationCodeGenerator,
    TokenManagerEmailRegistrationTokenGateway,
)
from services.account_email_registration_service import AccountEmailRegistrationService
from services.account_forgot_password_adapters import (
    CeleryForgotPasswordNotificationGateway,
    RateLimiterForgotPasswordSendLimiter,
    RedisForgotPasswordSecurityGateway,
    RedisForgotPasswordTokenGateway,
    SecureForgotPasswordCodeGenerator,
    SystemFeatureServiceForgotPasswordRegistrationPolicy,
)
from services.account_forgot_password_service import AccountForgotPasswordService
from services.account_initialization_service import AccountInitializationService
from services.account_integration_service import AccountIntegrationService
from services.account_login_adapters import (
    AccountActivationConsoleAuthInvitationGateway,
    DeploymentConsoleAuthPolicyGateway,
    LoggingConsoleAuthAuditGateway,
    RedisAccountSessionGateway,
    RedisConsoleAuthSecurityGateway,
    RedisEmailCodeGateway,
    RedisResetPasswordEmailGateway,
    SQLAlchemyAccountRefreshPreparationGateway,
    SQLAlchemyConsoleAuthProvisioningGateway,
    TurnstileHumanVerificationGateway,
)
from services.account_login_service import ConsoleAuthenticationService
from services.account_oauth_adapters import (
    DeploymentOAuthPolicyGateway,
    DifyOAuthProviderGateway,
    RedisOAuthAccountClaimLock,
)
from services.account_oauth_service import AccountOAuthService, OAuthProviderGateway
from services.account_password_hasher import DefaultAccountPasswordHasher
from services.account_password_service import AccountPasswordService
from services.account_profile_service import AccountProfileService
from services.app_definition_query_service import AppDefinitionQueryService
from services.app_site_service import AppSiteService
from services.auth.data_source_api_key_auth_gateways import (
    ProviderApiKeyAuthCredentialValidator,
    TenantApiKeyAuthCredentialEncryptor,
)
from services.auth.data_source_api_key_auth_service import DataSourceApiKeyAuthService
from services.billing_portal_service import BillingPortalService
from services.billing_service import BillingService
from services.compliance_download_service import ComplianceDownloadService
from services.data_source_oauth_service import DataSourceOAuthService, InvalidDataSourceOAuthProviderError
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.file_grant_entities import FileGrantLimits
from services.errors.enterprise import EnterpriseServiceError
from services.explore_banner_query_service import ExploreBannerQueryService
from services.feature_query_service import FeatureQueryService
from services.feature_service_gateway import FeatureServiceGateway
from services.file_grant_gateways import FileGrantFileGateway, FileGrantRemoteFileGateway, FileGrantTokenGateway
from services.file_grant_service import FileGrantService
from services.file_service import FileService
from services.init_validation_service import InitValidationService
from services.inner_mail_service import InnerMailService
from services.notification_gateway import BillingNotificationGateway
from services.notification_service import NotificationService
from services.notion_data_source_gateway import NotionDataSourceGateway
from services.oauth_server_service import OAUTH_ACCESS_TOKEN_EXPIRES_IN, OAuthServerService
from services.partner_tenant_binding_service import PartnerTenantBindingService
from services.recommended_app_catalog_gateway import (
    BuiltinRecommendedAppCatalogGateway,
    RecommendedAppCatalogRouter,
    RemoteRecommendedAppCatalogGateway,
)
from services.recommended_app_query_service import RecommendedAppQueryService
from services.remote_file_service import RemoteFileService
from services.retention.workflow_run.archive_download_adapters import (
    dispatch_workflow_run_archive_download_task,
    sign_workflow_run_archive_download_url,
)
from services.retention.workflow_run.archive_download_task_cache import WorkflowRunArchiveDownloadTaskCache
from services.retention.workflow_run.archive_log_service import WorkflowRunArchiveService
from services.schema_definition_service import SchemaDefinitionService
from services.setup_adapters import RedisSetupLock, RegisterServiceAccountProvisioner
from services.setup_service import SetupService
from services.step_by_step_tour_service import StepByStepTourService
from services.system_feature_service import SystemFeatureService
from services.tag_application_service import TagApplicationService
from services.trial_app_usage import TrialAppUsageRecorder
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
from services.workflow_statistic_query_service import WorkflowStatisticQueryService
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
    authentication: ConsoleAuthenticationService
    avatar: AccountAvatarService
    change_email: AccountChangeEmailService
    email_registration: AccountEmailRegistrationService
    deletion: AccountDeletionService
    deletion_feedback: AccountDeletionFeedbackService
    education: AccountEducationService
    forgot_password: AccountForgotPasswordService
    initialization: AccountInitializationService
    integrations: AccountIntegrationService
    oauth: AccountOAuthService
    password: AccountPasswordService
    profile: AccountProfileService


@dataclass(frozen=True, slots=True)
class ApplicationServices:
    accounts: AccountServices
    account_activation: AccountActivationService
    app_definitions: AppDefinitionQueryService
    app_sites: AppSiteService
    billing_portal: BillingPortalService
    compliance_downloads: ComplianceDownloadService
    data_source_api_key_auth: DataSourceApiKeyAuthService
    data_source_oauth: Mapping[str, DataSourceOAuthService]
    webapp_access: WebAppAccessQueryService
    web_app_runtime: WebAppRuntimeQueryService
    explore_banner_queries: ExploreBannerQueryService
    schema_definitions: SchemaDefinitionService
    setup: SetupService
    feature_queries: FeatureQueryService
    file_grants: FileGrantService
    files: FileService
    oauth_server: OAuthServerService
    init_validation: InitValidationService
    notifications: NotificationService
    step_by_step_tour: StepByStepTourService
    partner_tenant_bindings: PartnerTenantBindingService
    recommended_app_queries: RecommendedAppQueryService
    remote_files: RemoteFileService
    trial_app_usage: TrialAppUsageRecorder
    workflow_run_archives: WorkflowRunArchiveService
    workspace_queries: WorkspaceQueryService
    workspace_member_queries: WorkspaceMemberQueryService
    inner_mail: InnerMailService
    web_passport: WebPassportService
    tags: TagApplicationService
    workflow_statistics: WorkflowStatisticQueryService

    def resolve_data_source_oauth(self, provider: str) -> DataSourceOAuthService:
        service = self.data_source_oauth.get(provider)
        if service is None:
            raise InvalidDataSourceOAuthProviderError("Invalid provider")
        return service


def _build_data_source_oauth_services(
    *,
    database_client: sessionmaker[Session],
) -> Mapping[str, DataSourceOAuthService]:
    notion_data_source = NotionDataSourceGateway(
        client_id=dify_config.NOTION_CLIENT_ID or "",
        client_secret=dify_config.NOTION_CLIENT_SECRET or "",
        redirect_uri=dify_config.CONSOLE_API_URL + "/console/api/oauth/data-source/callback/notion",
        http_client=ssrf_proxy,
    )
    bindings = SQLAlchemyDataSourceOAuthBindingRepository(session_factory=database_client)
    return {
        "notion": DataSourceOAuthService(
            provider_name="notion",
            provider_gateway=notion_data_source,
            bindings=bindings,
            is_internal_provider=dify_config.NOTION_INTEGRATION_TYPE == "internal",
            internal_access_token=dify_config.NOTION_INTERNAL_SECRET,
        )
    }


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


def _build_account_oauth_service(
    *,
    database_client: sessionmaker[Session],
    deployment_edition: DeploymentEdition,
    redis: RedisClientWrapper,
    accounts: SQLAlchemyAccountRepository,
    integrations: SQLAlchemyAccountIntegrationRepository,
    memberships: WorkspaceQueryRepository,
) -> AccountOAuthService:
    providers: dict[str, OAuthProviderGateway] = {}
    if dify_config.GITHUB_CLIENT_ID and dify_config.GITHUB_CLIENT_SECRET:
        providers["github"] = DifyOAuthProviderGateway(
            provider_name="github",
            client=GitHubOAuth(
                client_id=dify_config.GITHUB_CLIENT_ID,
                client_secret=dify_config.GITHUB_CLIENT_SECRET,
                redirect_uri=dify_config.CONSOLE_API_URL + "/console/api/oauth/authorize/github",
            ),
        )
    if dify_config.GOOGLE_CLIENT_ID and dify_config.GOOGLE_CLIENT_SECRET:
        providers["google"] = DifyOAuthProviderGateway(
            provider_name="google",
            client=GoogleOAuth(
                client_id=dify_config.GOOGLE_CLIENT_ID,
                client_secret=dify_config.GOOGLE_CLIENT_SECRET,
                redirect_uri=dify_config.CONSOLE_API_URL + "/console/api/oauth/authorize/google",
            ),
        )

    policy = DeploymentOAuthPolicyGateway(
        billing_enabled=deployment_edition == DeploymentEdition.CLOUD,
    )
    return AccountOAuthService(
        providers=providers,
        accounts=accounts,
        integrations=integrations,
        memberships=memberships,
        invitations=RegisterServiceOAuthInvitationGateway(session_factory=database_client),
        account_claims=RedisOAuthAccountClaimLock(client=redis),
        registration=AccountServiceOAuthAccountRegistrationGateway(session_factory=database_client),
        workspaces=AccountServiceOAuthWorkspaceGateway(session_factory=database_client),
        sessions=AccountServiceOAuthSessionGateway(session_factory=database_client),
        registration_policy=policy,
        workspace_policy=policy,
        supported_languages=languages,
        now=naive_utc_now,
    )


def build_application_services(
    *,
    database_client: sessionmaker[Session],
    deployment_edition: DeploymentEdition,
    initialization_password: str,
    redis: RedisClientWrapper,
) -> ApplicationServices:
    installation_state = InstallationStateRepository(session_factory=database_client)
    data_source_api_key_auth_bindings = SQLAlchemyDataSourceApiKeyAuthBindingRepository(session_factory=database_client)
    app_definition_repository = AppDefinitionQueryRepository(session_factory=database_client)
    feature_gateway = FeatureServiceGateway()
    accounts = SQLAlchemyAccountRepository(session_factory=database_client)
    integrations = SQLAlchemyAccountIntegrationRepository(session_factory=database_client)
    trial_app_enabled = SystemFeatureService.is_trial_app_enabled()
    database_catalog = DatabaseRecommendedAppCatalogRepository(session_factory=database_client, redis=redis)
    builtin_catalog = BuiltinRecommendedAppCatalogGateway()
    remote_catalog = RemoteRecommendedAppCatalogGateway()
    recommended_app_catalog = RecommendedAppCatalogRouter(
        remote=remote_catalog,
        database=database_catalog,
        builtin=builtin_catalog,
    )
    workspace_query_repository = WorkspaceQueryRepository(session_factory=database_client)
    file_service = FileService(session_factory=database_client)
    passwords = DefaultAccountPasswordHasher()
    invitation_tokens = RedisInvitationTokenStore(redis=redis)
    activation_accounts = SQLAlchemyAccountActivationRepository(session_factory=database_client)
    account_provisioning = SQLAlchemyConsoleAuthProvisioningGateway(session_factory=database_client)
    return ApplicationServices(
        accounts=AccountServices(
            authentication=ConsoleAuthenticationService(
                accounts=accounts,
                workspaces=workspace_query_repository,
                invitations=AccountActivationConsoleAuthInvitationGateway(
                    tokens=invitation_tokens,
                    accounts=activation_accounts,
                ),
                policies=DeploymentConsoleAuthPolicyGateway(
                    billing_enabled=deployment_edition == DeploymentEdition.CLOUD,
                ),
                security=RedisConsoleAuthSecurityGateway(redis=redis),
                passwords=passwords,
                human_verification=TurnstileHumanVerificationGateway(),
                sessions=RedisAccountSessionGateway(redis=redis),
                refresh_preparation=SQLAlchemyAccountRefreshPreparationGateway(session_factory=database_client),
                account_provisioning=account_provisioning,
                workspace_provisioning=account_provisioning,
                email_codes=RedisEmailCodeGateway(redis=redis),
                reset_password_emails=RedisResetPasswordEmailGateway(redis=redis),
                audit=LoggingConsoleAuthAuditGateway(),
                now=naive_utc_now,
                turnstile_enabled=deployment_edition == DeploymentEdition.CLOUD,
                turnstile_verify_required=(
                    deployment_edition == DeploymentEdition.CLOUD and dify_config.TURNSTILE_EMAIL_CODE_VERIFY_REQUIRED
                ),
            ),
            avatar=AccountAvatarService(
                files=SQLAlchemyAccountAvatarFileGateway(session_factory=database_client),
            ),
            change_email=AccountChangeEmailService(
                accounts=accounts,
                tokens=TokenManagerChangeEmailTokenGateway(),
                codes=SecureChangeEmailCodeGenerator(),
                notifications=CeleryChangeEmailNotificationGateway(),
                send_limits=RateLimiterChangeEmailSendLimiter(redis=redis),
                security=RedisChangeEmailSecurityGateway(
                    redis=redis,
                    email_send_ip_limit_per_minute=dify_config.EMAIL_SEND_IP_LIMIT_PER_MINUTE,
                    verification_failure_limit=5,
                    verification_lockout_duration=dify_config.CHANGE_EMAIL_LOCKOUT_DURATION,
                ),
                email_policy=BillingAccountEmailPolicyGateway(
                    billing_enabled=deployment_edition == DeploymentEdition.CLOUD,
                ),
            ),
            email_registration=AccountEmailRegistrationService(
                accounts=accounts,
                tokens=TokenManagerEmailRegistrationTokenGateway(),
                codes=SecureEmailRegistrationCodeGenerator(),
                notifications=CeleryEmailRegistrationNotificationGateway(),
                send_limits=RateLimiterEmailRegistrationSendLimiter(
                    rate_limiter=RateLimiter(
                        prefix="email_register_rate_limit",
                        max_attempts=1,
                        time_window=60,
                        redis_client=redis,
                    )
                ),
                security=RedisEmailRegistrationSecurityGateway(
                    redis=redis,
                    verification_failure_limit=5,
                    verification_lockout_duration=dify_config.EMAIL_REGISTER_LOCKOUT_DURATION,
                ),
                account_policy=BillingAccountRegistrationPolicyGateway(
                    enabled=deployment_edition == DeploymentEdition.CLOUD,
                ),
                registration=AccountServiceRegistrationGateway(session_factory=database_client),
            ),
            deletion=AccountDeletionService(
                accounts=accounts,
                memberships=workspace_query_repository,
                verification=TokenManagerAccountDeletionVerificationGateway(),
                notifications=CeleryAccountDeletionVerificationNotifier(redis=redis),
                synchronization=EnterpriseAccountDeletionSyncGateway(),
                scheduler=CeleryAccountDeletionScheduler(),
            ),
            deletion_feedback=AccountDeletionFeedbackService(
                feedback=BillingAccountDeletionFeedbackGateway(),
            ),
            education=AccountEducationService(
                accounts=accounts,
                education=BillingAccountEducationGateway(),
                verification_rate_limiter=RateLimiter(
                    prefix="edu_verification_rate_limit",
                    max_attempts=10,
                    time_window=60,
                    redis_client=redis,
                ),
                activation_rate_limiter=RateLimiter(
                    prefix="edu_activation_rate_limit",
                    max_attempts=10,
                    time_window=60,
                    redis_client=redis,
                ),
            ),
            forgot_password=AccountForgotPasswordService(
                accounts=accounts,
                passwords=passwords,
                tokens=RedisForgotPasswordTokenGateway(
                    redis=redis,
                    expiry_seconds=int(dify_config.RESET_PASSWORD_TOKEN_EXPIRY_MINUTES * 60),
                ),
                codes=SecureForgotPasswordCodeGenerator(),
                notifications=CeleryForgotPasswordNotificationGateway(),
                send_limits=RateLimiterForgotPasswordSendLimiter(redis=redis),
                security=RedisForgotPasswordSecurityGateway(
                    redis=redis,
                    email_send_ip_limit_per_minute=dify_config.EMAIL_SEND_IP_LIMIT_PER_MINUTE,
                    verification_lockout_duration=dify_config.FORGOT_PASSWORD_LOCKOUT_DURATION,
                ),
                registration=SystemFeatureServiceForgotPasswordRegistrationPolicy(),
            ),
            initialization=AccountInitializationService(
                accounts=accounts,
                invitation_required=deployment_edition == DeploymentEdition.CLOUD,
                now=naive_utc_now,
            ),
            integrations=AccountIntegrationService(integrations=integrations),
            oauth=_build_account_oauth_service(
                database_client=database_client,
                deployment_edition=deployment_edition,
                redis=redis,
                accounts=accounts,
                integrations=integrations,
                memberships=workspace_query_repository,
            ),
            password=AccountPasswordService(
                accounts=accounts,
                passwords=passwords,
            ),
            profile=AccountProfileService(accounts=accounts),
        ),
        account_activation=AccountActivationService(
            tokens=invitation_tokens,
            accounts=activation_accounts,
            workspace_policy=DeploymentWorkspaceInvitePolicy(),
            eligibility=BillingAccountActivationEligibility(
                enabled=deployment_edition == DeploymentEdition.CLOUD,
            ),
            membership_cache=BillingWorkspaceMembershipCache(
                enabled=deployment_edition == DeploymentEdition.CLOUD,
            ),
            member_access_sync=RBACWorkspaceMemberAccessSync(
                enabled=dify_config.RBAC_ENABLED,
            ),
        ),
        app_definitions=AppDefinitionQueryService(
            definitions=app_definition_repository,
            builtin_icon_url_prefix=(
                dify_config.CONSOLE_API_URL + "/console/api/workspaces/current/tool-provider/builtin/"
            ),
        ),
        app_sites=AppSiteService(
            sites=AppSiteCommandRepository(session_factory=database_client),
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
        data_source_api_key_auth=DataSourceApiKeyAuthService(
            bindings=data_source_api_key_auth_bindings,
            validator=ProviderApiKeyAuthCredentialValidator(),
            encryptor=TenantApiKeyAuthCredentialEncryptor(),
        ),
        data_source_oauth=_build_data_source_oauth_services(database_client=database_client),
        webapp_access=WebAppAccessQueryService(
            access=WebAppAccessQueryRepository(session_factory=database_client),
            webapp_auth_enabled=SystemFeatureService.is_webapp_auth_enabled(deployment_edition=deployment_edition),
            access_mode_for_app=_get_enterprise_webapp_access_mode,
            is_user_allowed_for_app=_is_user_allowed_to_access_webapp,
        ),
        web_app_runtime=WebAppRuntimeQueryService(
            runtime=app_definition_repository,
            file_service=file_service,
            workspace_features=feature_gateway.get_workspace_features,
            files_url=dify_config.FILES_URL,
        ),
        explore_banner_queries=ExploreBannerQueryService(
            banners=ExploreBannerQueryRepository(session_factory=database_client),
            enabled=SystemFeatureService.is_explore_banner_enabled(),
        ),
        schema_definitions=SchemaDefinitionService(source_factory=SchemaManager),
        setup=SetupService(
            state=installation_state,
            accounts=RegisterServiceAccountProvisioner(session_factory=database_client),
            lock=RedisSetupLock(client=redis),
            setup_required=deployment_edition != DeploymentEdition.CLOUD,
        ),
        feature_queries=FeatureQueryService(
            features=feature_gateway,
            app_dsl_version=CURRENT_APP_DSL_VERSION,
        ),
        file_grants=_build_file_grant_service(database_client=database_client),
        files=file_service,
        oauth_server=_build_oauth_server_service(database_client=database_client, redis=redis),
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
        partner_tenant_bindings=PartnerTenantBindingService(
            sync_bindings=BillingService.sync_partner_tenants_bindings,
        ),
        recommended_app_queries=RecommendedAppQueryService(
            catalog=recommended_app_catalog,
            trial_apps=TrialAppQueryRepository(session_factory=database_client),
            trial_enabled=trial_app_enabled,
        ),
        remote_files=RemoteFileService(
            files=FileService(session_factory=database_client),
        ),
        trial_app_usage=TrialAppUsageRepository(session_factory=database_client),
        workflow_run_archives=WorkflowRunArchiveService(
            bundles=WorkflowRunArchiveBundleQueryRepository(session_factory=database_client),
            tasks=WorkflowRunArchiveDownloadTaskCache(redis=redis),
            dispatcher=dispatch_workflow_run_archive_download_task,
            sign_download_url=sign_workflow_run_archive_download_url,
        ),
        workspace_queries=WorkspaceQueryService(
            workspaces=workspace_query_repository,
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
        tags=TagApplicationService(
            tags=TagRepository(session_factory=database_client),
        ),
        workflow_statistics=WorkflowStatisticQueryService(
            workflow_runs=DifyAPIRepositoryFactory.create_api_workflow_run_repository(
                session_maker=database_client,
            ),
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
