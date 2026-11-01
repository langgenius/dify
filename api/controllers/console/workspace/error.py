from http import HTTPStatus

from libs.exception import BaseHTTPException


class CurrentWorkspaceArchivedError(BaseHTTPException):
    error_code = "current_workspace_archived"
    description = "The current workspace has been archived."
    code = 409


class RepeatPasswordNotMatchError(BaseHTTPException):
    error_code = "repeat_password_not_match"
    description = "New password and repeat password does not match."
    code = 400


class CurrentPasswordIncorrectError(BaseHTTPException):
    error_code = "current_password_incorrect"
    description = "Current password is incorrect."
    code = 400


class InvalidInvitationCodeError(BaseHTTPException):
    error_code = "invalid_invitation_code"
    description = "Invalid invitation code."
    code = 400


class MissingInvitationCodeRequestError(BaseHTTPException):
    error_code = "missing_invitation_code"
    description = "Invitation code is required."
    code = 400


class AccountAlreadyInitedError(BaseHTTPException):
    error_code = "account_already_inited"
    description = "The account has been initialized. Please refresh the page."
    code = 400


class AccountNotInitializedError(BaseHTTPException):
    error_code = "account_not_initialized"
    description = "The account has not been initialized yet. Please proceed with the initialization process first."
    code = 400


class InvalidAccountDeletionCodeError(BaseHTTPException):
    error_code = "invalid_account_deletion_code"
    description = "Invalid account deletion code."
    code = 400


class InvalidMemberRoleError(BaseHTTPException):
    error_code = "invalid_role"
    description = "Invalid role."
    code = 400


class IMBindingReadOnlyError(BaseHTTPException):
    error_code = "im_binding_read_only"
    description = "Centrally managed IM bindings cannot be edited from a workspace."
    code = HTTPStatus.FORBIDDEN


class WorkspaceIMOverrideNotAllowedError(BaseHTTPException):
    error_code = "workspace_im_override_not_allowed"
    description = "Workspace IM overrides require centrally managed bindings."
    code = HTTPStatus.FORBIDDEN


class PluginOperationError(BaseHTTPException):
    error_code = "plugin_error"
    description = "Plugin operation failed."
    code = 400


class SkillRequestError(BaseHTTPException):
    error_code = "invalid_request"
    description = "Invalid skill request."
    code = 400


class SkillFilenameMissingError(BaseHTTPException):
    error_code = "filename_missing"
    description = "filename is required"
    code = 400


class MemberCannotOperateSelfError(BaseHTTPException):
    error_code = "cannot_operate_self"
    description = "Cannot operate on yourself."
    code = 400


class MemberNotFoundError(BaseHTTPException):
    error_code = "member_not_found"
    description = "Member not found."
    code = 404


class MemberRoleAlreadyAssignedError(BaseHTTPException):
    error_code = "role_already_assigned"
    description = "Role already assigned."
    code = 400


class NetworkAccessInvalidInputError(BaseHTTPException):
    error_code = "network_access_invalid_input"
    description = "Invalid network access group request."
    code = 400


class NetworkAccessForbiddenError(BaseHTTPException):
    error_code = "network_access_forbidden"
    description = "Network access groups are not available for this workspace."
    code = 403


class NetworkAccessNotEntitledError(BaseHTTPException):
    error_code = "network_access_not_entitled"
    description = "Network access groups are not available for this workspace."
    code = 403


class NetworkAccessGroupNotFoundError(BaseHTTPException):
    error_code = "network_access_group_not_found"
    description = "Network access group was not found."
    code = 404


class NetworkAccessVersionConflictError(BaseHTTPException):
    error_code = "network_access_version_conflict"
    description = "The network access resource changed. Refresh it and try again."
    code = 409


class NetworkAccessGroupNameConflictError(BaseHTTPException):
    error_code = "network_access_group_name_conflict"
    description = "An IP policy with this name already exists."
    code = 409


class NetworkAccessGroupBoundError(BaseHTTPException):
    error_code = "network_access_group_bound"
    description = "This IP policy is still used by one or more apps."
    code = 409


class NetworkAccessRoleDeniedError(BaseHTTPException):
    error_code = "network_access_role_denied"
    description = "Your workspace role does not allow this network access operation."
    code = 403


class NetworkAccessUnsupportedAppModeError(BaseHTTPException):
    error_code = "network_access_unsupported_app_mode"
    description = "Network access control is not supported for this app mode."
    code = 400


class NetworkAccessUnsupportedAccessPointsError(BaseHTTPException):
    error_code = "network_access_unsupported_access_points"
    description = "Some access points are not supported for this app."
    code = 400
