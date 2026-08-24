"""Framework-neutral errors shared by account application services."""


class AccountApplicationError(Exception):
    """Base class for failures owned by account application services."""


class AccountNotFoundError(AccountApplicationError):
    """The admitted account no longer exists."""


class CurrentAccountPasswordIncorrectError(AccountApplicationError):
    """The supplied current password does not match the account credential."""


class InvalidAccountPasswordError(AccountApplicationError):
    """The requested password does not satisfy the account password policy."""


class AvatarFileNotFoundError(AccountApplicationError):
    """The requested avatar file does not exist or is not owned by the account."""


class AccountAlreadyInitializedError(AccountApplicationError):
    """The account is already active and cannot be initialized again."""


class MissingInvitationCodeError(AccountApplicationError):
    """Cloud account initialization requires an invitation code."""


class InvalidInvitationCodeError(AccountApplicationError):
    """The invitation code is missing, used, or otherwise invalid."""


class InvalidAccountDeletionVerificationError(AccountApplicationError):
    """The account deletion token or verification code is invalid."""


class AccountDeletionRateLimitError(AccountApplicationError):
    """Too many account deletion verification emails were requested."""

    def __init__(self, retry_after_minutes: int) -> None:
        super().__init__(retry_after_minutes)
        self.retry_after_minutes = retry_after_minutes


class ChangeEmailSendIPLimitedError(AccountApplicationError):
    """The caller IP exceeded the email-send policy."""


class ChangeEmailSendRateLimitError(AccountApplicationError):
    """Too many change-email messages were requested for the address."""

    def __init__(self, retry_after_minutes: int) -> None:
        super().__init__(retry_after_minutes)
        self.retry_after_minutes = retry_after_minutes


class InvalidChangeEmailTokenError(AccountApplicationError):
    """The token is absent, malformed, in the wrong phase, or bound elsewhere."""


class InvalidChangeEmailAddressError(AccountApplicationError):
    """The request address does not match the account or token state."""


class ChangeEmailVerificationLimitError(AccountApplicationError):
    """Too many invalid verification-code attempts were made."""


class InvalidChangeEmailCodeError(AccountApplicationError):
    """The verification code does not match the current token."""


class AccountEmailFrozenError(AccountApplicationError):
    """The target email is temporarily frozen by account policy."""


class AccountEmailDomainSuspendedError(AccountEmailFrozenError):
    """The target email belongs to a suspended domain."""


class AccountEmailAlreadyInUseError(AccountApplicationError):
    """The target email already belongs to an account."""


class EducationDiscountPausedError(AccountApplicationError):
    """Education discount activation is temporarily paused."""


class InvalidOAuthProviderError(AccountApplicationError):
    """The requested Console OAuth provider is unavailable."""


class OAuthProviderRequestError(AccountApplicationError):
    """The remote OAuth provider could not complete the request."""


class OAuthProviderAuthorizationError(AccountApplicationError):
    """The remote OAuth provider rejected the authorization exchange."""

    def __init__(self, description: str) -> None:
        super().__init__(description)
        self.description = description


class OAuthIdentityLockUnavailableError(AccountApplicationError):
    """The OAuth account claim could not be acquired or its lease was lost."""


class InvalidOAuthInvitationError(AccountApplicationError):
    """The OAuth callback references an invitation that can no longer be resolved."""


class OAuthInvitationAccountMismatchError(AccountApplicationError):
    """The OAuth identity does not own the account referenced by the invitation."""

    def __init__(self, invite_token: str) -> None:
        super().__init__(invite_token)
        self.invite_token = invite_token


class OAuthAccountBannedError(AccountApplicationError):
    """The OAuth identity resolves to a banned Console account."""


class OAuthAccountNotFoundError(AccountApplicationError):
    """An account disappeared while the OAuth use case was running."""


class OAuthWorkspaceCreationNotAllowedError(AccountApplicationError):
    """Workspace policy prevents provisioning a workspace for the OAuth account."""


class OAuthSeatsLimitExceededError(AccountApplicationError):
    """Account registration would exceed the licensed seat limit."""


class OAuthRegistrationError(AccountApplicationError):
    """The OAuth account could not be registered."""

    def __init__(self, description: str) -> None:
        super().__init__(description)
        self.description = description
