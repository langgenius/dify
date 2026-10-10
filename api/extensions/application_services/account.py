"""Compose the account domain using shared account and workspace persistence."""

from dataclasses import dataclass
from functools import partial

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from constants.languages import languages
from enums import DeploymentEdition
from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import naive_utc_now, utc_now
from libs.helper import RateLimiter
from libs.oauth import GitHubOAuth, GoogleOAuth
from libs.oauth_bearer import invalidate_oauth_token_cache
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.account_activation_repository import SQLAlchemyAccountActivationRepository
from repositories.account_integration_repository import SQLAlchemyAccountIntegrationRepository
from repositories.oauth_access_token_repository import SQLAlchemyOAuthAccessTokenRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.account.adapters import (
    AccountIdentityGateway,
    BillingAccountActivationEligibility,
    BillingAccountDeletionFeedbackGateway,
    BillingAccountEducationGateway,
    BillingAccountEmailPolicyGateway,
    BillingWorkspaceMembershipCache,
    CeleryAccountDeletionScheduler,
    CeleryAccountDeletionVerificationNotifier,
    CeleryChangeEmailNotificationGateway,
    DeploymentAccountLifecyclePolicy,
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
from services.account.email_registration_adapters import (
    AccountLifecycleRegistrationGateway,
    BillingAccountRegistrationPolicyGateway,
    CeleryEmailRegistrationNotificationGateway,
    RateLimiterEmailRegistrationSendLimiter,
    RedisEmailRegistrationSecurityGateway,
    SecureEmailRegistrationCodeGenerator,
    TokenManagerEmailRegistrationTokenGateway,
)
from services.account.email_registration_service import AccountEmailRegistrationService
from services.account.forgot_password_adapters import (
    CeleryForgotPasswordNotificationGateway,
    RateLimiterForgotPasswordSendLimiter,
    RedisForgotPasswordSecurityGateway,
    RedisForgotPasswordTokenGateway,
    SecureForgotPasswordCodeGenerator,
    SystemFeatureServiceForgotPasswordRegistrationPolicy,
)
from services.account.forgot_password_service import AccountForgotPasswordService
from services.account.login_adapters import (
    AccountActivationConsoleAuthInvitationGateway,
    DeploymentConsoleAuthPolicyGateway,
    LoggingConsoleAuthAuditGateway,
    RedisAccountSessionGateway,
    RedisConsoleAuthSecurityGateway,
    RedisEmailCodeGateway,
    RedisResetPasswordEmailGateway,
    SQLAlchemyAccountRefreshPreparationGateway,
    TurnstileHumanVerificationGateway,
)
from services.account.login_service import ConsoleAuthenticationService
from services.account.oauth_adapters import (
    AccountActivationOAuthInvitationGateway,
    AccountLifecycleOAuthRegistrationGateway,
    AccountLifecycleOAuthSessionGateway,
    DeploymentOAuthPolicyGateway,
    DifyOAuthProviderGateway,
    RedisOAuthAccountClaimLock,
    WorkspaceProvisioningOAuthGateway,
)
from services.account.oauth_service import AccountOAuthService, OAuthProviderGateway
from services.account.service import AccountService
from services.account_access_service import AccountAccessService
from services.account_activation_service import (
    AccountActivationRepository,
    AccountActivationService,
    InvitationTokenStore,
)
from services.account_avatar_file_gateway import SQLAlchemyAccountAvatarFileGateway
from services.account_avatar_service import AccountAvatarService
from services.account_change_email_service import AccountChangeEmailService
from services.account_deletion_feedback_service import AccountDeletionFeedbackService
from services.account_deletion_service import AccountDeletionService
from services.account_education_service import AccountEducationService
from services.account_initialization_service import AccountInitializationService
from services.account_integration_service import AccountIntegrationService
from services.account_password_hasher import DefaultAccountPasswordHasher
from services.account_password_service import AccountPasswordService
from services.account_profile_service import AccountProfileService
from services.workspace.provisioning_service import WorkspaceProvisioningService


@dataclass(frozen=True, slots=True)
class AccountServices:
    access: AccountAccessService
    activation: AccountActivationService
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
    lifecycle: AccountService
    identity: AccountIdentityGateway


def _build_account_oauth_service(
    *,
    deployment_edition: DeploymentEdition,
    redis: RedisClientWrapper,
    accounts: SQLAlchemyAccountRepository,
    integrations: SQLAlchemyAccountIntegrationRepository,
    memberships: WorkspaceRepository,
    lifecycle: AccountService,
    workspace_provisioning: WorkspaceProvisioningService,
    invitation_tokens: InvitationTokenStore,
    activation_accounts: AccountActivationRepository,
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
        invitations=AccountActivationOAuthInvitationGateway(tokens=invitation_tokens, accounts=activation_accounts),
        account_claims=RedisOAuthAccountClaimLock(client=redis),
        registration=AccountLifecycleOAuthRegistrationGateway(accounts=lifecycle),
        workspaces=WorkspaceProvisioningOAuthGateway(workspaces=workspace_provisioning),
        sessions=AccountLifecycleOAuthSessionGateway(accounts=lifecycle),
        registration_policy=policy,
        workspace_policy=policy,
        supported_languages=languages,
        now=naive_utc_now,
    )


def build_account_services(
    *,
    database_client: sessionmaker[Session],
    deployment_edition: DeploymentEdition,
    redis: RedisClientWrapper,
    accounts: SQLAlchemyAccountRepository,
    integrations: SQLAlchemyAccountIntegrationRepository,
    workspace_repository: WorkspaceRepository,
    workspace_provisioning: WorkspaceProvisioningService,
    passwords: DefaultAccountPasswordHasher,
    invitation_tokens: RedisInvitationTokenStore,
    activation_accounts: SQLAlchemyAccountActivationRepository,
) -> AccountServices:
    lifecycle = AccountService(
        security=RedisConsoleAuthSecurityGateway(redis=redis),
        accounts=accounts,
        policies=DeploymentAccountLifecyclePolicy(),
        passwords=passwords,
        workspaces=workspace_provisioning,
        sessions=RedisAccountSessionGateway(redis=redis),
        now=naive_utc_now,
    )
    return AccountServices(
        lifecycle=lifecycle,
        activation=AccountActivationService(
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
        identity=AccountIdentityGateway(accounts=accounts, redis=redis),
        access=AccountAccessService(
            accounts=accounts,
            workspaces=workspace_repository,
            sessions=SQLAlchemyOAuthAccessTokenRepository(session_factory=database_client),
            invalidate_token_cache=partial(invalidate_oauth_token_cache, redis),
            now=utc_now,
        ),
        authentication=ConsoleAuthenticationService(
            accounts=accounts,
            workspaces=workspace_repository,
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
            refresh_preparation=SQLAlchemyAccountRefreshPreparationGateway(accounts=accounts),
            account_provisioning=workspace_provisioning,
            workspace_provisioning=workspace_provisioning,
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
                login_security=RedisConsoleAuthSecurityGateway(redis=redis),
                verification_failure_limit=5,
                verification_lockout_duration=dify_config.EMAIL_REGISTER_LOCKOUT_DURATION,
            ),
            account_policy=BillingAccountRegistrationPolicyGateway(
                enabled=deployment_edition == DeploymentEdition.CLOUD,
            ),
            registration=AccountLifecycleRegistrationGateway(accounts=lifecycle),
        ),
        deletion=AccountDeletionService(
            accounts=accounts,
            memberships=workspace_repository,
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
                expiry_seconds=dify_config.RESET_PASSWORD_TOKEN_EXPIRY_MINUTES * 60,
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
            deployment_edition=deployment_edition,
            redis=redis,
            accounts=accounts,
            integrations=integrations,
            memberships=workspace_repository,
            lifecycle=lifecycle,
            workspace_provisioning=workspace_provisioning,
            invitation_tokens=invitation_tokens,
            activation_accounts=activation_accounts,
        ),
        password=AccountPasswordService(
            accounts=accounts,
            passwords=passwords,
        ),
        profile=AccountProfileService(accounts=accounts),
    )
