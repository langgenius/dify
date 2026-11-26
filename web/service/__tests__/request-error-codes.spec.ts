import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as consoleErrorMaps from '@dify/contracts/api/console/errors.gen'
import * as webErrorMaps from '@dify/contracts/api/web/errors.gen'
import { describe, expect, it } from 'vite-plus/test'
import requestErrors from '@/i18n/locales/en-US/request-errors.json'
import {
  catalogedRequestErrorCodes,
  forbiddenMessages,
  passthroughRequestErrorCodes,
  planLimitMessages,
  requestErrorTemplates,
} from '../request-error-codes'

/**
 * Framework codes that only name the HTTP status, such as Werkzeug's `not_found` (`forbidden` is
 * cataloged instead). Their server message names what failed in English, so the caller's
 * translated fallback comes first and the server message replaces only generic text.
 */
const genericRequestErrorCodes = [
  'bad_request',
  'conflict',
  'internal_server_error',
  'method_not_allowed',
  'not_found',
  'request_entity_too_large',
  'too_many_requests',
  'unauthorized',
  'unknown',
  'unprocessable_entity',
] as const

// The backend sentence behind each template, as its source writes it.
const templateSources: Record<keyof typeof requestErrorTemplates, [file: string, text: string]> = {
  dataset_name_duplicate: [
    'api/services/knowledge/dataset_service.py',
    'f"Dataset with name {name} already exists."',
  ],
  email_change_rate_limit_exceeded: [
    'api/controllers/console/auth/error.py',
    '"Too many email change emails have been sent. Please try again in {minutes} minutes."',
  ],
  email_code_account_deletion_rate_limit_exceeded: [
    'api/controllers/console/auth/error.py',
    '"Too many account deletion emails have been sent. Please try again in {minutes} minutes."',
  ],
  email_code_login_rate_limit_exceeded: [
    'api/controllers/console/auth/error.py',
    '"Too many login emails have been sent. Please try again in {minutes} minutes."',
  ],
  email_register_rate_limit_exceeded: [
    'api/controllers/console/auth/error.py',
    '"Too many email register emails have been sent. Please try again in {minutes} minutes."',
  ],
  file_extension_blocked: [
    'api/services/file_service.py',
    'f"File extension \'.{extension}\' is not allowed for security reasons"',
  ],
  invalid_metadata: [
    'api/controllers/console/datasets/datasets_document.py',
    'f"Invalid metadata value: {metadata}"',
  ],
  network_access_unsupported_access_points: [
    'api/controllers/console/workspace/network_access_group.py',
    'f"Unsupported access points for this app: {\', \'.join(exc.access_points)}."',
  ],
  network_access_unsupported_app_mode: [
    'api/controllers/console/workspace/network_access_group.py',
    'f"Network access control is not supported for app mode \'{exc.app_mode}\'."',
  ],
  owner_transfer_rate_limit_exceeded: [
    'api/controllers/console/auth/error.py',
    '"Too many owner transfer emails have been sent. Please try again in {minutes} minutes."',
  ],
  password_reset_rate_limit_exceeded: [
    'api/controllers/console/auth/error.py',
    '"Too many password reset emails have been sent. Please try again in {minutes} minutes."',
  ],
}

const documentedCodes = [
  ...new Set(
    [consoleErrorMaps, webErrorMaps].flatMap((errorMaps) =>
      Object.values(errorMaps).flatMap((errorMap) => Object.keys(errorMap)),
    ),
  ),
].sort()

const catalogKeys = Object.keys(requestErrors)
  .filter((key) => key.startsWith('code.'))
  .map((key) => key.slice('code.'.length))
  .sort()

// Documented codes still waiting for a catalog entry.
const pendingCodes = new Set<string>([
  'access_denied',
  'account_already_inited',
  'account_not_link_tenant',
  'agent_build_sandbox_not_found',
  'agent_model_not_configured',
  'agent_name_conflict_error',
  'agent_not_bound',
  'agent_not_found_error',
  'agent_version_conflict_error',
  'agent_version_not_found_error',
  'already_activate',
  'already_submitted',
  'annual_discount_active',
  'app_owner_unavailable',
  'app_site_unavailable',
  'billing_operation_failed',
  'billing_request_in_progress',
  'cannot_transfer_owner_to_self',
  'compliance_document_not_found',
  'compliance_download_forbidden',
  'compliance_rate_limit',
  'conversation_cursor_not_found',
  'conversation_first_message_not_found',
  'conversation_name_required',
  'current_password_incorrect',
  'current_workspace_archived',
  'education_activate_failed',
  'education_activate_limit',
  'education_verify_failed',
  'education_verify_limit',
  'email_change_limit',
  'email_code_login_limit',
  'email_code_login_service_unavailable',
  'email_domain_suspended',
  'email_password_reset_limit',
  'email_register_limit',
  'expired',
  'filename_missing',
  'filename_not_exists_error',
  'human_input_access_delivery_failed',
  'human_input_access_rate_limit_exceeded',
  'human_input_challenge_expired',
  'human_input_challenge_stale',
  'human_input_invalid_otp',
  'human_input_v2_unavailable',
  'installed_app_not_found',
  'installed_app_unavailable',
  'invalid_account_deletion_code',
  'invalid_cursor',
  'invalid_input',
  'invalid_metadata',
  'invalid_role',
  'invalid_tracing_config',
  'invalid_upload_token',
  'invitation_account_mismatch',
  'knowledge_fs_space_not_found',
  'limit_exceeded',
  'malformed_upload_token',
  'message_cursor_not_found',
  'message_feedback_rating_required',
  'message_not_found',
  'missing_invitation_code',
  'need_add_ids',
  'network_access_forbidden',
  'network_access_group_bound',
  'network_access_group_name_conflict',
  'network_access_group_not_found',
  'network_access_invalid_input',
  'network_access_not_entitled',
  'network_access_role_denied',
  'network_access_unsupported_access_points',
  'network_access_unsupported_app_mode',
  'normalized_email_already_in_use',
  'not_allowed_create_workspace',
  'not_owner',
  'owner_transfer_limit',
  'pipeline_not_found',
  'provider_not_support_text_to_speech',
  'recommended_app_not_found',
  'remote_file_access_denied',
  'remote_file_invalid_response',
  'remote_file_invalid_url',
  'remote_file_not_found',
  'remote_file_url_blocked',
  'roster_agent_package_import_failed',
  'roster_agent_package_resource_unavailable',
  'trace_config_already_exists',
  'trace_config_not_found',
  'tracing_already_accepted',
  'tracing_config_conflict',
  'tracing_config_processing_failed',
  'tracing_config_verification_failed',
  'tracing_duplicate_acknowledgement_required',
  'tracing_node_not_found',
  'tracing_provider_unavailable',
  'tracing_retry_not_allowed',
  'tracing_run_not_found',
  'tracing_source_not_found',
  'trial_app_feature_disabled',
  'trial_app_limit_exceeded',
  'trial_app_not_allowed',
  'trigger_workflow_service_mode_unavailable',
  'turnstile_service_unavailable',
  'turnstile_verification_failed',
  'unsupported_tracing_provider',
  'upload_token_required',
  'web_form_rate_limit_exceeded',
  'workflow_not_active',
])

describe('request error codes', () => {
  it('lists exactly the codes the English catalog translates', () => {
    expect([...catalogedRequestErrorCodes].sort()).toEqual(catalogKeys)
  })

  it('gives every code one treatment', () => {
    const codes = [
      ...catalogedRequestErrorCodes,
      ...passthroughRequestErrorCodes,
      ...genericRequestErrorCodes,
    ]
    expect(codes.filter((code, index) => codes.indexOf(code) !== index)).toEqual([])
  })

  it('gives every code the console and web app contracts document a treatment', () => {
    const handled = new Set<string>([
      ...catalogedRequestErrorCodes,
      ...passthroughRequestErrorCodes,
      ...genericRequestErrorCodes,
      ...pendingCodes,
    ])
    expect(documentedCodes.filter((code) => !handled.has(code))).toEqual([])
  })

  it('lists no pending code the catalog already covers', () => {
    const covered = new Set<string>([
      ...catalogedRequestErrorCodes,
      ...passthroughRequestErrorCodes,
      ...genericRequestErrorCodes,
    ])
    expect(
      [...pendingCodes].filter((code) => covered.has(code) || !documentedCodes.includes(code)),
    ).toEqual([])
  })

  it('translates every plan-limit text the console checks answer with', () => {
    const wraps = readFileSync(
      path.resolve(process.cwd(), '../api/controllers/console/wraps.py'),
      'utf8',
    )
    const backendMessages = [...wraps.matchAll(/abort\(\s*403,\s*"([^"]+)"/g)].map(
      (match) => match[1],
    )

    expect(Object.keys(planLimitMessages).sort()).toEqual([...new Set(backendMessages)].sort())
    expect(Object.values(planLimitMessages).sort()).toEqual(
      Object.keys(requestErrors)
        .filter((key) => key.startsWith('planLimit.'))
        .map((key) => key.slice('planLimit.'.length))
        .sort(),
    )
  })

  it('matches every templated sentence the backend writes and translates it', () => {
    for (const [code, [file, text]] of Object.entries(templateSources)) {
      const source = readFileSync(path.resolve(process.cwd(), '..', file), 'utf8')
      expect(source, `${file} no longer writes ${text}`).toContain(text)
      const sample = text
        .replace(/^f?"|"$/g, '')
        .replace(/\{minutes\}/g, '5')
        .replace(/\{[^}]+\}/g, 'sample')
      expect(requestErrorTemplates[code as keyof typeof requestErrorTemplates].test(sample)).toBe(
        true,
      )
    }
    expect(
      Object.keys(requestErrors)
        .filter((key) => key.startsWith('template.'))
        .map((key) => key.slice('template.'.length))
        .sort(),
    ).toEqual(Object.keys(requestErrorTemplates).sort())
  })

  it('translates every fixed forbidden reason the console and web app backends raise', () => {
    const roots = [
      'api/controllers/console',
      'api/controllers/web',
      'api/controllers/files',
      'api/libs',
      'api/services',
      'api/core',
    ]
    const sources = roots.flatMap((root) => {
      const dir = path.resolve(process.cwd(), '..', root)
      return (readdirSync(dir, { recursive: true }) as string[])
        .filter((file) => file.endsWith('.py') && !file.includes('tests'))
        .map((file) => readFileSync(path.join(dir, file), 'utf8'))
    })
    sources.push(readFileSync(path.resolve(process.cwd(), '../api/app_factory.py'), 'utf8'))
    const raised = new Set<string>()
    const forbidden =
      /(?:\bForbidden\(\s*(?:description=)?|\babort\(\s*403,\s*)(?:"([^"]+)"|'([^']+)')/g
    for (const source of sources)
      for (const match of source.matchAll(forbidden)) raised.add((match[1] ?? match[2])!)

    const known = new Set<string>([
      ...Object.keys(planLimitMessages),
      ...Object.keys(forbiddenMessages),
    ])
    expect([...raised].filter((message) => !known.has(message)).sort()).toEqual([])
    expect(Object.values(forbiddenMessages).sort()).toEqual(
      Object.keys(requestErrors)
        .filter((key) => key.startsWith('forbidden.'))
        .map((key) => key.slice('forbidden.'.length))
        .sort(),
    )
  })
})
