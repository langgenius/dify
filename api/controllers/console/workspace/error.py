from http import HTTPStatus

from libs.exception import BaseHTTPException


class TriggerOAuthContextInvalidError(BaseHTTPException):
    error_code = "trigger_oauth_context_invalid"
    code = HTTPStatus.FORBIDDEN
    description = "The trigger OAuth context is missing, expired or invalid."


class TriggerOAuthProviderRequestError(BaseHTTPException):
    error_code = "trigger_oauth_provider_error"
    code = HTTPStatus.BAD_GATEWAY
    description = "The trigger provider could not complete OAuth authorization."


class TriggerOAuthClientConfigInvalidError(BaseHTTPException):
    error_code = "trigger_oauth_client_config_invalid"
    code = HTTPStatus.INTERNAL_SERVER_ERROR
    description = "The stored trigger OAuth client configuration is invalid."


class TriggerOAuthClientChangedError(BaseHTTPException):
    error_code = "trigger_oauth_client_changed"
    code = HTTPStatus.CONFLICT
    description = "The trigger OAuth client configuration changed. Reload it before saving again."


class TriggerSubscriptionNotFoundError(BaseHTTPException):
    error_code = "trigger_subscription_not_found"
    code = HTTPStatus.NOT_FOUND
    description = "The trigger subscription does not exist in this workspace and provider."


class TriggerSubscriptionNameConflictError(BaseHTTPException):
    error_code = "trigger_subscription_name_conflict"
    code = HTTPStatus.CONFLICT
    description = "A trigger subscription with this name already exists for the provider."


class TriggerSubscriptionChangedError(BaseHTTPException):
    error_code = "trigger_subscription_changed"
    code = HTTPStatus.CONFLICT
    description = "The trigger subscription changed. Reload it before trying again."


class TriggerSubscriptionLimitError(BaseHTTPException):
    error_code = "trigger_subscription_limit_reached"
    code = HTTPStatus.BAD_REQUEST
    description = "The maximum number of trigger subscriptions for this provider has been reached."


class TriggerSubscriptionProviderError(BaseHTTPException):
    error_code = "trigger_subscription_provider_error"
    code = HTTPStatus.BAD_GATEWAY
    description = "The trigger provider could not complete the subscription operation."


class TriggerSubscriptionInvalidError(BaseHTTPException):
    error_code = "trigger_subscription_invalid"
    code = HTTPStatus.BAD_REQUEST
    description = "The trigger subscription configuration or credentials are invalid."


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
