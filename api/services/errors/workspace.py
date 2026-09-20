"""Framework-neutral failures owned by workspace application services."""


class WorkspaceApplicationError(Exception):
    """Base class for workspace use-case failures, mapped by transport adapters."""


class AccountAlreadyInTenantError(WorkspaceApplicationError):
    pass


class InvalidActionError(WorkspaceApplicationError):
    pass


class CannotOperateSelfError(WorkspaceApplicationError):
    pass


class MemberNotInTenantError(WorkspaceApplicationError):
    pass


class RoleAlreadyAssignedError(WorkspaceApplicationError):
    pass


class WorkSpaceNotAllowedCreateError(WorkspaceApplicationError):
    pass


class WorkspacesLimitExceededError(WorkspaceApplicationError):
    pass


class WorkspaceNotFoundError(WorkspaceApplicationError):
    pass


class WorkspaceArchivedError(WorkspaceApplicationError):
    pass


class WorkspaceNotLinkedError(WorkspaceApplicationError):
    pass


class WorkspaceOwnerNotFoundError(WorkspaceApplicationError):
    pass


class InvalidWorkspaceMemberRoleError(WorkspaceApplicationError):
    pass


class OwnerTransferSendIPLimitedError(WorkspaceApplicationError):
    """The caller IP exceeded the ownership-transfer email-send policy."""


class OwnerTransferSendRateLimitError(WorkspaceApplicationError):
    """Too many ownership-transfer confirmation messages were requested."""

    def __init__(self, retry_after_minutes: int) -> None:
        super().__init__("Too many ownership-transfer confirmation messages")
        self.retry_after_minutes = retry_after_minutes


class OwnerTransferVerificationLimitError(WorkspaceApplicationError):
    """Too many invalid ownership-transfer verification codes were submitted."""


class InvalidOwnerTransferTokenError(WorkspaceApplicationError):
    """The ownership-transfer token is missing or invalid."""


class InvalidOwnerTransferEmailError(WorkspaceApplicationError):
    """The ownership-transfer token belongs to another email address."""


class InvalidOwnerTransferCodeError(WorkspaceApplicationError):
    """The verification code does not match the ownership-transfer token."""


class WorkspaceInvitationQuotaError(WorkspaceApplicationError):
    def __init__(self, *, seats: bool = False) -> None:
        super().__init__("Workspace invitation quota exceeded")
        self.seats = seats
