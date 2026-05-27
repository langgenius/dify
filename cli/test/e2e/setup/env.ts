/**
 * E2E environment configuration.
 *
 * All DIFY_E2E_* variables must be set before running E2E tests.
 * In CI they are injected from GitHub Actions secrets.
 * Locally, export them in your shell or use a .env.e2e file.
 *
 * Required:
 *   DIFY_E2E_HOST            Staging server base URL (e.g. https://api.staging.dify.ai)
 *   DIFY_E2E_TOKEN           Internal user bearer token (dfoa_ prefix)
 *   DIFY_E2E_WORKSPACE_ID    Workspace ID for the test account
 *   DIFY_E2E_CHAT_APP_ID     Echo-chat app  — outputs "echo: {query}"
 *   DIFY_E2E_WORKFLOW_APP_ID Echo-workflow app — input x (required), outputs "echo: {x}"
 *
 * Optional (skip related tests when absent):
 *   DIFY_E2E_SSO_TOKEN        External SSO bearer token (dfoe_ prefix)
 *   DIFY_E2E_HITL_APP_ID      Workflow app with a Human-Input node
 *   DIFY_E2E_FILE_APP_ID      Workflow app with a file input variable (doc)
 */

export type E2EEnv = {
  /** Staging server base URL */
  host: string
  /** Internal user bearer token (dfoa_…) */
  token: string
  /** External SSO bearer token (dfoe_…) — may be empty */
  ssoToken: string
  /** Primary workspace ID */
  workspaceId: string
  /** Workspace name (informational) */
  workspaceName: string
  /** Chat app that echoes the query */
  chatAppId: string
  /** Workflow app that echoes input x */
  workflowAppId: string
  /** Workflow app with HITL node — empty when not configured */
  hitlAppId: string
  /** Workflow app with file input (doc variable) — empty when not configured */
  fileAppId: string
  /**
   * Console account email — used by global-setup to mint a disposable token
   * for logout tests via the device flow API.  Optional: if absent, logout
   * tests that need a real revoke are skipped.
   */
  email: string
  /** Console account password (plain-text; Base64-encoded before sending) */
  password: string
}

export type E2ECapabilities = {
  tokenValid: boolean
  tokenId?: string
  /**
   * Per-suite dedicated tokens minted by global-setup via the device flow.
   * Each destructive suite (logout, devices) gets its own fresh dfoa_ token so
   * that revoking it never invalidates DIFY_E2E_TOKEN used by other suites.
   * Empty string when DIFY_E2E_EMAIL/PASSWORD are not configured.
   */
  logoutToken: string
  devicesToken: string
}

let _cached: E2EEnv | undefined

/** Load and validate E2E environment variables. Throws if required vars are missing. */
export function loadE2EEnv(): E2EEnv {
  if (_cached !== undefined)
    return _cached

  const required: Array<[keyof NodeJS.ProcessEnv, string]> = [
    ['DIFY_E2E_HOST', 'Staging server URL'],
    ['DIFY_E2E_TOKEN', 'Internal user bearer token'],
    ['DIFY_E2E_WORKSPACE_ID', 'Workspace ID'],
    ['DIFY_E2E_CHAT_APP_ID', 'Echo-chat app ID'],
    ['DIFY_E2E_WORKFLOW_APP_ID', 'Echo-workflow app ID'],
  ]

  const missing = required.filter(([k]) => !process.env[k])
  if (missing.length > 0) {
    const list = missing.map(([k, desc]) => `  ${k}  (${desc})`).join('\n')
    throw new Error(
      `E2E tests require the following environment variables to be set:\n${list}\n\n`
      + 'See test/e2e/setup/env.ts for documentation.',
    )
  }

  _cached = {
    host: process.env.DIFY_E2E_HOST!,
    token: process.env.DIFY_E2E_TOKEN!,
    ssoToken: process.env.DIFY_E2E_SSO_TOKEN ?? '',
    workspaceId: process.env.DIFY_E2E_WORKSPACE_ID!,
    workspaceName: process.env.DIFY_E2E_WORKSPACE_NAME ?? 'E2E Workspace',
    chatAppId: process.env.DIFY_E2E_CHAT_APP_ID!,
    workflowAppId: process.env.DIFY_E2E_WORKFLOW_APP_ID!,
    hitlAppId: process.env.DIFY_E2E_HITL_APP_ID ?? '',
    fileAppId: process.env.DIFY_E2E_FILE_APP_ID ?? '',
    email: process.env.DIFY_E2E_EMAIL ?? '',
    password: process.env.DIFY_E2E_PASSWORD ?? '',
  }
  return _cached
}

/**
 * Skip a test when an optional app fixture is not configured.
 * Usage:  skipUnless(E.hitlAppId, 'DIFY_E2E_HITL_APP_ID')
 */
export function isE2ELocalMode(): boolean {
  return process.env.DIFY_E2E_MODE === 'local'
}
