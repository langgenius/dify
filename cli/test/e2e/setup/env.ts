/**
 * E2E environment configuration.
 *
 * ── Edition modes ─────────────────────────────────────────────────────────
 *
 * Community Edition (CE) — default, set DIFY_E2E_EDITION=ce or leave unset.
 *   Required: DIFY_E2E_HOST, DIFY_E2E_EMAIL, DIFY_E2E_PASSWORD
 *   global-setup registers the account (idempotent), mints tokens, imports
 *   all DSL fixtures into the single workspace, and publishes apps.
 *
 * Enterprise Edition (EE) — set DIFY_E2E_EDITION=ee.
 *   Required: DIFY_E2E_HOST, DIFY_E2E_EMAIL, DIFY_E2E_PASSWORD
 *   The operator must pre-create two workspaces for the test account:
 *     primary   → named "auto_test0"
 *     secondary → named "auto_test1"
 *   global-setup logs in, discovers the two workspaces by name, imports DSL
 *   fixtures into both, publishes apps, and sets access_mode → public.
 *
 * ── EE-only test cases ────────────────────────────────────────────────────
 *   Tests that require multiple workspaces or EE-specific features are tagged
 *   [EE] and wrapped with enterpriseOnlyIt() / enterpriseOnlyDescribe() from
 *   helpers/skip.ts. They are automatically skipped in CE mode.
 *
 * ── Optional env-var overrides (both editions) ────────────────────────────
 *   DIFY_E2E_TOKEN           Pre-minted bearer token — skips device-flow mint
 *   DIFY_E2E_SSO_TOKEN       External SSO bearer token (dfoe_ prefix)
 *   DIFY_E2E_CONSOLE_URL     Console URL when different from DIFY_E2E_HOST
 *   DIFY_E2E_WORKSPACE_ID    Override primary workspace ID
 *   DIFY_E2E_WORKSPACE_NAME  Override primary workspace name
 *   DIFY_E2E_WS2_ID          Override secondary workspace ID (EE)
 *   DIFY_E2E_WS2_APP_ID      Override secondary workspace app ID (EE)
 *   DIFY_E2E_CHAT_APP_ID     Override echo-chat app ID
 *   DIFY_E2E_WORKFLOW_APP_ID Override echo-workflow app ID
 *   DIFY_E2E_FILE_APP_ID     Override file-upload app ID
 *   DIFY_E2E_FILE_CHAT_APP_ID Override file-chat app ID
 *   DIFY_E2E_HITL_APP_ID     Override HITL main app ID
 *   DIFY_E2E_HITL_EXTERNAL_APP_ID
 *   DIFY_E2E_HITL_SINGLE_ACTION_APP_ID
 *   DIFY_E2E_HITL_MULTI_NODE_APP_ID
 */

/** Supported edition values. */
export type DifyEdition = 'ce' | 'ee'

export type E2EEnv = {
  /** Staging server base URL (API endpoint) */
  host: string
  /**
   * Edition: "ce" (Community Edition, default) or "ee" (Enterprise Edition).
   * Controls which global-setup path runs and which test cases are active.
   */
  edition: DifyEdition
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
  /** Workflow app with HITL node (display_in_ui=true) — empty when not configured */
  hitlAppId: string
  /** Workflow app with HITL node (display_in_ui=false) — empty when not configured */
  hitlExternalAppId: string
  /** Workflow app with HITL node (display_in_ui=true, exactly 1 action) */
  hitlSingleActionAppId: string
  /** Workflow app with 2 serial Human-Input nodes */
  hitlMultiNodeAppId: string
  /** Workflow app with file input (doc variable) */
  fileAppId: string
  /** Chat app (advanced-chat) with a file input variable */
  fileChatAppId: string
  /**
   * Secondary workspace ID — EE only ("auto_test1").
   * Empty in CE mode (CE has a single workspace).
   */
  ws2Id: string
  /** App ID inside the secondary workspace — EE only. Empty in CE mode. */
  ws2AppId: string
  /** Console account email */
  email: string
  /** Console account password (plain-text; Base64-encoded before sending) */
  password: string
  /**
   * Console URL — defaults to `host` when not set separately.
   * Useful when the API host and the console host differ.
   */
  consoleUrl: string
}

export type E2ECapabilities = {
  tokenValid: boolean
  tokenId?: string
  /**
   * Edition resolved by global-setup — "ce" or "ee".
   * Injected into every test file so helpers/skip.ts can gate EE-only cases.
   */
  edition: DifyEdition
  /** Primary bearer token minted by global-setup via the device flow. */
  token: string
  /**
   * Per-suite dedicated tokens — each destructive suite (logout, devices)
   * gets its own fresh dfoa_ token so revoking it never kills the main token.
   */
  logoutToken: string
  devicesToken: string
  /** Primary workspace info. */
  workspaceId: string
  workspaceName: string
  /** Secondary workspace ID (EE only). Empty string in CE mode. */
  ws2Id: string
  /** App IDs resolved by provisionApps. Empty = fall back to env var. */
  chatAppId: string
  workflowAppId: string
  fileAppId: string
  fileChatAppId: string
  hitlAppId: string
  hitlExternalAppId: string
  hitlSingleActionAppId: string
  hitlMultiNodeAppId: string
  ws2AppId: string
}

let _cached: E2EEnv | undefined

/** Return true when running in Enterprise Edition mode. */
export function isEnterpriseEdition(): boolean {
  return (process.env.DIFY_E2E_EDITION ?? 'ce').toLowerCase() === 'ee'
}

/** Load and validate E2E environment variables. Throws if required vars are missing. */
export function loadE2EEnv(): E2EEnv {
  if (_cached !== undefined)
    return _cached

  const edition: DifyEdition = isEnterpriseEdition() ? 'ee' : 'ce'

  // Same 3 required vars for both CE and EE.
  const required: Array<[keyof NodeJS.ProcessEnv, string]> = [
    ['DIFY_E2E_HOST', 'Staging server URL'],
    ['DIFY_E2E_EMAIL', 'Console account email'],
    ['DIFY_E2E_PASSWORD', 'Console account password'],
  ]

  const missing = required.filter(([k]) => !process.env[k])
  if (missing.length > 0) {
    const list = missing.map(([k, desc]) => `  ${k}  (${desc})`).join('\n')
    throw new Error(
      `E2E tests require the following environment variables to be set:\n${list}\n\n`
      + `Edition: ${edition.toUpperCase()}\n`
      + 'See test/e2e/setup/env.ts for documentation.',
    )
  }

  _cached = {
    host: process.env.DIFY_E2E_HOST!,
    edition,
    token: process.env.DIFY_E2E_TOKEN ?? '',
    ssoToken: process.env.DIFY_E2E_SSO_TOKEN ?? '',
    workspaceId: process.env.DIFY_E2E_WORKSPACE_ID ?? '',
    workspaceName: process.env.DIFY_E2E_WORKSPACE_NAME ?? '',
    chatAppId: process.env.DIFY_E2E_CHAT_APP_ID ?? '',
    workflowAppId: process.env.DIFY_E2E_WORKFLOW_APP_ID ?? '',
    hitlAppId: process.env.DIFY_E2E_HITL_APP_ID ?? '',
    hitlExternalAppId: process.env.DIFY_E2E_HITL_EXTERNAL_APP_ID ?? '',
    hitlSingleActionAppId: process.env.DIFY_E2E_HITL_SINGLE_ACTION_APP_ID ?? '',
    hitlMultiNodeAppId: process.env.DIFY_E2E_HITL_MULTI_NODE_APP_ID ?? '',
    fileAppId: process.env.DIFY_E2E_FILE_APP_ID ?? '',
    fileChatAppId: process.env.DIFY_E2E_FILE_CHAT_APP_ID ?? '',
    ws2Id: process.env.DIFY_E2E_WS2_ID ?? '',
    ws2AppId: process.env.DIFY_E2E_WS2_APP_ID ?? '',
    email: process.env.DIFY_E2E_EMAIL!,
    password: process.env.DIFY_E2E_PASSWORD!,
    consoleUrl: process.env.DIFY_E2E_CONSOLE_URL ?? process.env.DIFY_E2E_HOST!,
  }
  return _cached
}

export function isE2ELocalMode(): boolean {
  return process.env.DIFY_E2E_MODE === 'local'
}

/**
 * Resolve the E2E environment, merging capabilities (from global-setup) on top
 * of the optional env-var overrides. Capabilities always take priority.
 *
 * `caps` may be undefined in local mode (DIFY_E2E_MODE=local), where
 * global-setup returns early without calling project.provide().
 */
export function resolveEnv(caps: E2ECapabilities | undefined): E2EEnv {
  if (!caps)
    return loadE2EEnv()
  const env = loadE2EEnv()
  return {
    ...env,
    edition: caps.edition || env.edition,
    token: caps.token || env.token,
    workspaceId: caps.workspaceId || env.workspaceId,
    workspaceName: caps.workspaceName || env.workspaceName,
    ws2Id: caps.ws2Id || env.ws2Id,
    chatAppId: caps.chatAppId || env.chatAppId,
    workflowAppId: caps.workflowAppId || env.workflowAppId,
    fileAppId: caps.fileAppId || env.fileAppId,
    fileChatAppId: caps.fileChatAppId || env.fileChatAppId,
    hitlAppId: caps.hitlAppId || env.hitlAppId,
    hitlExternalAppId: caps.hitlExternalAppId || env.hitlExternalAppId,
    hitlSingleActionAppId: caps.hitlSingleActionAppId || env.hitlSingleActionAppId,
    hitlMultiNodeAppId: caps.hitlMultiNodeAppId || env.hitlMultiNodeAppId,
    ws2AppId: caps.ws2AppId || env.ws2AppId,
  }
}
