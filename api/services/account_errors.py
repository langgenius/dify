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
