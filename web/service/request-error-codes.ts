/**
 * Codes whose server message is specific to the call, so it is shown as is: at least one backend
 * site passes a dynamic or call-specific message (an upstream provider's or plugin's error, a
 * validation reason, a limit, a relayed service error), even if others use the fixed description.
 */
export const passthroughRequestErrorCodes = [
  'agent_backend_unreachable',
  'agent_home_snapshot_create_failed',
  'agent_home_snapshot_too_large',
  'agent_not_found',
  'agent_soul_locked_error',
  'app_not_found',
  'app_tenant_mismatch',
  'app_trigger_not_found',
  'archive_too_large',
  'audio_too_large',
  'binding_file_download_unavailable',
  'cannot_operate_self',
  'child_chunk_delete_index_error',
  'child_chunk_indexing_error',
  'completion_request_error',
  'config_file_not_found',
  'config_skill_file_not_found',
  'config_skill_not_found',
  'crawl_failed',
  'data_source_api_key_auth_credentials_rejected',
  'data_source_api_key_auth_provider_unavailable',
  'dataset_access_denied',
  'dataset_not_found',
  'dataset_tenant_mismatch',
  'document_indexing',
  'duplicate_file_path',
  'email_change_rate_limit_exceeded',
  'email_code_account_deletion_rate_limit_exceeded',
  'email_code_login_rate_limit_exceeded',
  'email_register_rate_limit_exceeded',
  'file_path_conflict',
  'file_scan_file_missing',
  'file_scan_malware_detected',
  'file_scan_pending',
  'file_scan_provider_auth_failed',
  'file_scan_provider_missing',
  'file_scan_provider_quota_exceeded',
  'file_scan_unavailable',
  'file_scan_unscannable',
  'file_too_large',
  'human_input_form_expired',
  'human_input_form_not_found',
  'human_input_form_submitted',
  'indexing_estimate_error',
  'inspector_unavailable',
  'invalid_account_password',
  'invalid_action',
  'invalid_composer_config_error',
  'invalid_config_version_kind',
  'invalid_data_source_api_key_auth_credentials',
  'invalid_env_file',
  'invalid_form_data',
  'invalid_param',
  'invalid_request',
  'invalid_roster_agent_package',
  'invalid_skill_description',
  'invalid_skill_file',
  'invalid_skill_md',
  'invalid_skill_name',
  'invalid_skill_package',
  'knowledge_fs_access_denied',
  'knowledge_fs_conflict',
  'knowledge_fs_invalid_request',
  'knowledge_fs_operation_unavailable',
  'knowledge_fs_rate_limit_exceeded',
  'knowledge_fs_request_rejected',
  'knowledge_fs_request_too_large',
  'knowledge_fs_resource_not_found',
  'knowledge_fs_timeout',
  'knowledge_fs_upgrade_models_unavailable',
  'knowledge_fs_upstream_unavailable',
  'knowledge_retrieve_failed',
  'max_keys_exceeded',
  'member_not_found',
  'message_template_test_invalid',
  'message_template_test_send_failed',
  'missing_skill_description',
  'missing_skill_md',
  'missing_skill_name',
  'moderation_rejected',
  'no_active_binding',
  'no_file',
  'node_not_in_workflow_run',
  'node_output_not_declared',
  'owner_transfer_rate_limit_exceeded',
  'password_reset_rate_limit_exceeded',
  'plaintext_secret_not_allowed_error',
  'plugin_error',
  'plugin_runtime_error',
  'provider_not_initialize',
  'rate_limit_error',
  'remote_file_unavailable',
  'role_already_assigned',
  'roster_agent_package_export_failed',
  'roster_agent_package_too_large',
  'skill_conflict',
  'skill_name_conflict',
  'skill_name_mismatch',
  'skill_not_found',
  'skill_too_large',
  'skill_version_not_found',
  'too_many_files',
  'trigger_oauth_client_changed',
  'trigger_oauth_client_config_invalid',
  'trigger_oauth_context_invalid',
  'trigger_oauth_provider_error',
  'trigger_subscription_changed',
  'trigger_subscription_invalid',
  'trigger_subscription_limit_reached',
  'trigger_subscription_name_conflict',
  'trigger_subscription_not_found',
  'trigger_subscription_provider_error',
  'unauthorized_and_force_logout',
  'unsupported_data_source_api_key_auth_provider',
  'web_app_access_denied',
  'webhook_trigger_not_found',
  'workflow_run_not_found',
] as const

/**
 * Codes the `requestErrors` namespace translates, as `code.<code>`. The catalog spec keeps this
 * list equal to the English catalog, so the resolver never asks `t` for a missing key.
 */
export const catalogedRequestErrorCodes = [
  'account_banned',
  'account_in_freeze',
  'account_not_found',
  'agent_not_published',
  'already_setup',
  'app_more_like_this_disabled',
  'app_suggested_questions_after_answer_disabled',
  'app_unavailable',
  'archived_document_immutable',
  'authentication_failed',
  'billing_unavailable',
  'conversation_not_found',
  'dataset_name_duplicate',
  'document_already_finished',
  'draft_workflow_not_exist',
  'draft_workflow_not_sync',
  'email_already_in_use',
  'email_code_error',
  'email_send_ip_limit',
  'file_extension_blocked',
  'forbidden',
  'init_validate_failed',
  'invalid_email',
  'invalid_invitation_code',
  'invalid_or_expired_token',
  'member_not_in_tenant',
  'model_currently_not_support',
  'network_access_version_conflict',
  'no_audio_uploaded',
  'no_file_uploaded',
  'not_chat_app',
  'not_completion_app',
  'not_init_validated',
  'not_setup',
  'not_workflow_app',
  'paid_plan_required',
  'password_mismatch',
  'pending_invitation_not_found',
  'provider_not_support_speech_to_text',
  'provider_quota_exceeded',
  'speech_to_text_disabled',
  'trigger_node_limit_exceeded',
  'unsupported_audio_type',
  'unsupported_file_type',
  'web_app_access_unavailable',
  'workspace_member_limit_reached',
] as const

export type CatalogedRequestErrorCode = (typeof catalogedRequestErrorCodes)[number]

/**
 * Console plan-limit checks answer with Werkzeug's generic `forbidden` and a fixed English text
 * that names the limit (`api/controllers/console/wraps.py`). Until they get their own codes, the
 * catalog translates them by that text as `planLimit.<name>`; the codes spec keeps this table equal
 * to the backend's messages.
 */
export const planLimitMessages = {
  'The capacity of the knowledge storage space has reached the limit of your subscription.':
    'vectorSpace',
  'The number of members has reached the limit of your subscription.': 'members',
  'The number of apps has reached the limit of your subscription.': 'apps',
  'The number of documents has reached the limit of your subscription.': 'documents',
  'The workspace custom feature has reached the limit of your subscription.': 'workspaceCustom',
  'The annotation quota has reached the limit of your subscription.': 'annotation',
  'To unlock this feature and elevate your Dify experience, please upgrade to a paid plan.':
    'paidPlan',
  'Sorry, you have reached the knowledge base request rate limit of your subscription.':
    'knowledgeRateLimit',
} as const

const rateLimitMinutes = (action: string) =>
  new RegExp(
    `^Too many ${action} emails have been sent\\. Please try again in (?<minutes>\\d+) minutes\\.$`,
  )

/**
 * Codes whose call-specific text is one fixed sentence around a few values. The catalog translates
 * the sentence as `template.<code>` with the values the pattern captures. A text that no pattern
 * matches falls back to the code's catalog entry, or to the server's message for a passthrough
 * code. The codes spec keeps each pattern equal to the backend's sentence.
 */
export const requestErrorTemplates = {
  dataset_name_duplicate: /^Dataset with name (?<name>.+) already exists\.$/,
  email_change_rate_limit_exceeded: rateLimitMinutes('email change'),
  email_code_account_deletion_rate_limit_exceeded: rateLimitMinutes('account deletion'),
  email_code_login_rate_limit_exceeded: rateLimitMinutes('login'),
  email_register_rate_limit_exceeded: rateLimitMinutes('email register'),
  file_extension_blocked:
    /^File extension '\.(?<extension>[^'{}]+)' is not allowed for security reasons$/,
  invalid_metadata: /^Invalid metadata value: (?<value>.+)$/,
  network_access_unsupported_access_points:
    /^Unsupported access points for this app: (?<accessPoints>.+)\.$/,
  network_access_unsupported_app_mode:
    /^Network access control is not supported for app mode '(?<mode>[^']+)'\.$/,
  owner_transfer_rate_limit_exceeded: rateLimitMinutes('owner transfer'),
  password_reset_rate_limit_exceeded: rateLimitMinutes('password reset'),
} as const satisfies Record<string, RegExp>

export type TemplatedRequestErrorCode = keyof typeof requestErrorTemplates

/**
 * Other fixed reasons the console answers with under `forbidden`, translated as `forbidden.<name>`
 * like the plan-limit texts. A bare denial or Werkzeug's default description gets the generic
 * permission entry, and any other text is call-specific, so it is shown as is. The codes spec
 * fails when the backend raises a fixed `forbidden` text this table does not know.
 */
export const forbiddenMessages = {
  "You do not have permission to view this tool's internal execution details.": 'executionDetails',
  'Invalid context_id': 'invalidOAuthContext',
  'Invalid request.': 'invalidSignedRequest',
  license_required: 'licenseRequired',
  'Workspace policy prohibits member invitations': 'memberInvitationPolicy',
  'no oauth available client config found for this tool provider': 'oauthClientMissing',
  'context_id not found': 'oauthContextMissing',
  'Your current plan does not allow workspace ownership transfer': 'ownerTransferPlan',
  'Workspace policy prohibits ownership transfer': 'ownerTransferPolicy',
  'Personal access token has expired.': 'personalAccessTokenExpired',
} as const

/** The description Werkzeug's `Forbidden` carries when it is raised without one. */
export const defaultForbiddenDescription =
  "You don't have the permission to access the requested resource. It is either read-protected or not readable by the server."
