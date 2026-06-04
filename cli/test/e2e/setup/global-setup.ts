/**
 * Vitest global setup — runs once before all E2E suites.
 *
 * ── CE path (DIFY_E2E_EDITION=ce or unset) ───────────────────────────────
 *  1. Register a new account with EMAIL/PASSWORD (POST /console/api/init or
 *     POST /console/api/register if the server is already initialised).
 *  2. Login with EMAIL/PASSWORD to obtain a session cookie.
 *  3. Mint the primary bearer token via the device flow.
 *  4. Validate the token (GET /openapi/v1/account/sessions).
 *  5. Discover the single workspace.
 *  6. Mint per-suite dedicated tokens (logout / devices suites).
 *  7. Import all DSL fixtures into the workspace, publish & set public.
 *
 * ── EE path (DIFY_E2E_EDITION=ee) ────────────────────────────────────────
 *  1. Use ENTERPRISE_API to create a member account.
 *  2. Login with EMAIL/PASSWORD to obtain a session cookie.
 *  3. Use the enterprise admin API to create two workspaces for the member.
 *  4. Mint the primary bearer token via the device flow.
 *  5. Validate the token.
 *  6. Mint per-suite dedicated tokens.
 *  7. Import DSL fixtures into BOTH workspaces (primary + secondary),
 *     publish & set access_mode → public via the enterprise API.
 *
 * All resolved values are written into E2ECapabilities and injected into every
 * test file via vitest's provide/inject mechanism.
 */

import type { TestProject } from 'vitest/node'
import type { E2ECapabilities } from './env.js'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadE2EEnv } from './env.js'

export async function setup(project: TestProject): Promise<void> {
  if (process.env.DIFY_E2E_MODE === 'local')
    return

  const E = loadE2EEnv()
  const base = E.host.replace(/\/$/, '')
  const consoleBase = E.consoleUrl.replace(/\/$/, '')

  console.warn(`[E2E global-setup] Edition: ${E.edition.toUpperCase()}`)

  // ── Edition-specific account & workspace bootstrapping ───────────────────
  let cookieString: string
  let csrfToken: string
  let primaryWsId: string
  let primaryWsName: string
  let secondaryWsId: string

  if (E.edition === 'ee') {
    // ── EE: create member via enterprise API, then create two workspaces ──

    // Step EE-1: create member account via enterprise admin API
    await eeCreateMember(E.enterpriseApiUrl, E.enterpriseApiSecretKey, E.email, E.password)

    // Step EE-2: login with the new account
    ;({ cookieString, csrfToken } = await consoleLogin(consoleBase, E.email, E.password))

    // Step EE-3: create two workspaces via enterprise admin API
    ;({ primaryWsId, primaryWsName, secondaryWsId } = await eeCreateWorkspaces(
      E.enterpriseApiUrl,
      E.enterpriseApiSecretKey,
      E.email,
      consoleBase,
      cookieString,
      csrfToken,
    ))
  }
  else {
    // ── CE: register account (idempotent), then login ──────────────────────

    // Step CE-1: register / ensure the account exists
    await ceRegisterAccount(consoleBase, E.email, E.password)

    // Step CE-2: login
    ;({ cookieString, csrfToken } = await consoleLogin(consoleBase, E.email, E.password))

    // Step CE-3: discover the single workspace (CE has only one)
    ;({ primaryWsId, primaryWsName, secondaryWsId } = await discoverWorkspaces(
      consoleBase,
      cookieString,
      csrfToken,
    ))
  }

  // ── Mint primary token via device flow ───────────────────────────────────
  let primaryToken = E.token
  if (!primaryToken) {
    try {
      primaryToken = await mintTokenWithSession(consoleBase, cookieString, csrfToken, 'e2e-primary')
      console.warn(`[E2E] primaryToken minted: ${primaryToken.slice(0, 20)}…`)
    }
    catch (err) {
      throw new Error(
        `[E2E global-setup] Failed to mint primary token: ${err}\n`
        + 'Ensure DIFY_E2E_EMAIL and DIFY_E2E_PASSWORD are correct.',
      )
    }
  }
  else {
    console.warn(`[E2E] primaryToken from env: ${primaryToken.slice(0, 20)}…`)
  }

  // ── Validate primary token ───────────────────────────────────────────────
  const sessionsUrl = `${base}/openapi/v1/account/sessions?page=1&limit=100`
  let res: Response
  try {
    res = await fetch(sessionsUrl, {
      headers: { Authorization: `Bearer ${primaryToken}` },
      signal: AbortSignal.timeout(10_000),
    })
  }
  catch (err) {
    throw new Error(
      `[E2E global-setup] Cannot reach staging server at ${sessionsUrl}.\n`
      + `Check DIFY_E2E_HOST and network connectivity.\n${String(err)}`,
    )
  }

  if (!res.ok) {
    throw new Error(
      `[E2E global-setup] Primary token is invalid or expired (HTTP ${res.status}).\n`
      + `URL: ${sessionsUrl}`,
    )
  }

  console.warn(`[E2E] Staging server is healthy and primary token is valid at ${E.host}`)

  // ── Resolve token_id ─────────────────────────────────────────────────────
  const body = await res.json() as { data: Array<{ id: string, prefix: string }> }
  const match = body.data.find(s => s.prefix !== '' && primaryToken.startsWith(s.prefix))
  if (!match) {
    console.warn('[E2E global-setup] Could not resolve token_id — devicesToken selfHit detection may not work')
  }
  else {
    console.warn(`[E2E] Resolved token_id: ${match.id}`)
  }

  // ── Mint per-suite dedicated tokens ──────────────────────────────────────
  let logoutToken = ''
  let devicesToken = ''

  const mint = (label: string) => mintTokenWithSession(consoleBase, cookieString, csrfToken, label)
  const [lt, dt] = await Promise.allSettled([
    mint('e2e-logout-suite'),
    mint('e2e-devices-suite'),
  ])

  if (lt.status === 'fulfilled') {
    logoutToken = lt.value
    console.warn(`[E2E] logoutToken  minted: ${logoutToken.slice(0, 20)}…`)
  }
  else {
    console.warn(`[E2E global-setup] Failed to mint logoutToken: ${lt.reason}`)
  }

  if (dt.status === 'fulfilled') {
    devicesToken = dt.value
    console.warn(`[E2E] devicesToken minted: ${devicesToken.slice(0, 20)}…`)
  }
  else {
    console.warn(`[E2E global-setup] Failed to mint devicesToken: ${dt.reason}`)
  }

  // ── Provision fixture apps ───────────────────────────────────────────────
  let provisionedIds: Record<string, string> = {}
  try {
    const fixturesDir = join(fileURLToPath(import.meta.url), '..', '..', 'fixtures', 'apps')
    provisionedIds = await provisionApps(
      consoleBase,
      cookieString,
      csrfToken,
      primaryWsId,
      secondaryWsId,
      fixturesDir,
      E.edition,
      E.edition === 'ee' ? E.enterpriseApiUrl : '',
      E.edition === 'ee' ? E.enterpriseApiSecretKey : '',
    )
    console.warn(`[E2E global-setup] Provisioned ${Object.keys(provisionedIds).length} fixture apps`)
  }
  catch (err) {
    console.warn(`[E2E global-setup] provisionApps failed (non-fatal): ${err}`)
  }

  // ── Build and provide capabilities ───────────────────────────────────────
  const capabilities: E2ECapabilities = {
    tokenValid: true,
    tokenId: match?.id,
    edition: E.edition,
    token: primaryToken,
    logoutToken,
    devicesToken,
    workspaceId: primaryWsId,
    workspaceName: primaryWsName,
    ws2Id: secondaryWsId,
    chatAppId: provisionedIds.DIFY_E2E_CHAT_APP_ID ?? '',
    workflowAppId: provisionedIds.DIFY_E2E_WORKFLOW_APP_ID ?? '',
    fileAppId: provisionedIds.DIFY_E2E_FILE_APP_ID ?? '',
    fileChatAppId: provisionedIds.DIFY_E2E_FILE_CHAT_APP_ID ?? '',
    hitlAppId: provisionedIds.DIFY_E2E_HITL_APP_ID ?? '',
    hitlExternalAppId: provisionedIds.DIFY_E2E_HITL_EXTERNAL_APP_ID ?? '',
    hitlSingleActionAppId: provisionedIds.DIFY_E2E_HITL_SINGLE_ACTION_APP_ID ?? '',
    hitlMultiNodeAppId: provisionedIds.DIFY_E2E_HITL_MULTI_NODE_APP_ID ?? '',
    ws2AppId: provisionedIds.DIFY_E2E_WS2_APP_ID ?? '',
  }

  // @ts-expect-error — ProvidedContext augmentation cannot be expressed without
  // triggering TS2300 or TS2664 under tsgo; safe at runtime.
  project.provide('e2eCapabilities', capabilities)
}

export { teardown } from './global-teardown.js'

// ══════════════════════════════════════════════════════════════════════════════
// CE helpers
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Register a new CE account idempotently.
 *
 * On a fresh server:  POST /console/api/init  (first-time setup)
 * On an existing server: POST /console/api/register (subsequent accounts)
 *
 * Both paths accept { email, name, password } and return 2xx on success or
 * when the account already exists (409 is treated as non-fatal).
 */
async function ceRegisterAccount(
  consoleBase: string,
  email: string,
  password: string,
): Promise<void> {
  const passwordB64 = Buffer.from(password, 'utf8').toString('base64')
  const name = email.split('@')[0] ?? 'e2e-user'

  // Try /init first (works on a brand-new server)
  const initRes = await fetch(`${consoleBase}/console/api/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name, password: passwordB64 }),
    signal: AbortSignal.timeout(15_000),
  })

  if (initRes.ok || initRes.status === 409) {
    console.warn(`[E2E CE] Account ready via /init (status ${initRes.status})`)
    return
  }

  // Fall back to /register (server already has an owner account)
  const registerRes = await fetch(`${consoleBase}/console/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name, password: passwordB64 }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!registerRes.ok && registerRes.status !== 409) {
    console.warn(
      `[E2E CE] /register returned HTTP ${registerRes.status} — account may already exist; continuing`,
    )
  }
  else {
    console.warn(`[E2E CE] Account ready via /register (status ${registerRes.status})`)
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// EE helpers
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create a member account via the enterprise admin API.
 * Idempotent — a 409 "already exists" response is treated as success.
 */
async function eeCreateMember(
  enterpriseApiUrl: string,
  secretKey: string,
  email: string,
  password: string,
): Promise<void> {
  const passwordB64 = Buffer.from(password, 'utf8').toString('base64')
  const name = email.split('@')[0] ?? 'e2e-member'

  const res = await fetch(`${enterpriseApiUrl}/members`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${secretKey}`,
    },
    body: JSON.stringify({ email, name, password: passwordB64, role: 'normal' }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok && res.status !== 409) {
    const body = await res.text().catch(() => '')
    throw new Error(`[E2E EE] Failed to create member: HTTP ${res.status} ${body.slice(0, 200)}`)
  }

  console.warn(`[E2E EE] Member account ready (status ${res.status})`)
}

/**
 * Create two named workspaces for the member via the enterprise admin API,
 * then resolve their IDs by listing workspaces through the console API.
 *
 * Returns primary and secondary workspace info.
 */
async function eeCreateWorkspaces(
  enterpriseApiUrl: string,
  secretKey: string,
  email: string,
  consoleBase: string,
  cookieString: string,
  csrfToken: string,
): Promise<{ primaryWsId: string, primaryWsName: string, secondaryWsId: string }> {
  const WS_NAMES = ['e2e-primary-auto', 'e2e-secondary-auto']

  for (const wsName of WS_NAMES) {
    const res = await fetch(`${enterpriseApiUrl}/workspaces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`,
      },
      body: JSON.stringify({ name: wsName, owner_email: email }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok && res.status !== 409) {
      const body = await res.text().catch(() => '')
      console.warn(`[E2E EE] Failed to create workspace "${wsName}": HTTP ${res.status} ${body.slice(0, 200)}`)
    }
    else {
      console.warn(`[E2E EE] Workspace "${wsName}" ready (status ${res.status})`)
    }
  }

  // Discover the two workspaces via the console API (same as CE path)
  return discoverWorkspaces(consoleBase, cookieString, csrfToken)
}

// ══════════════════════════════════════════════════════════════════════════════
// Shared helpers
// ══════════════════════════════════════════════════════════════════════════════

// ── Console login ──────────────────────────────────────────────────────────

async function consoleLogin(
  consoleBase: string,
  email: string,
  password: string,
): Promise<{ cookieString: string, csrfToken: string }> {
  const passwordB64 = Buffer.from(password, 'utf8').toString('base64')
  const loginRes = await fetch(`${consoleBase}/console/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: passwordB64, remember_me: false }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!loginRes.ok)
    throw new Error(`console/api/login failed: HTTP ${loginRes.status}`)

  const setCookies = loginRes.headers.getSetCookie?.() ?? []
  const cookieString = setCookies.map(c => c.split(';')[0]).join('; ')
  const csrfToken = (cookieString.match(/csrf_token=([^;]+)/) ?? [])[1] ?? ''
  return { cookieString, csrfToken }
}

// ── Workspace discovery ────────────────────────────────────────────────────

async function discoverWorkspaces(
  consoleBase: string,
  cookieString: string,
  csrfToken: string,
): Promise<{ primaryWsId: string, primaryWsName: string, secondaryWsId: string }> {
  const mkHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
    'Cookie': cookieString,
    'X-CSRF-Token': csrfToken,
    ...extra,
  })

  const wsRes = await fetch(`${consoleBase}/console/api/workspaces`, {
    headers: mkHeaders(),
    signal: AbortSignal.timeout(10_000),
  })
  if (!wsRes.ok)
    throw new Error(`list workspaces failed: HTTP ${wsRes.status}`)

  const wsBody = await wsRes.json() as {
    workspaces?: Array<{ id: string, name: string }>
  }

  const autoWorkspaces = (wsBody.workspaces ?? [])
    .filter(w => w.name.toLowerCase().includes('auto'))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (autoWorkspaces.length === 0) {
    // CE: fall back to the first available workspace when no "auto" workspace exists
    const allWorkspaces = wsBody.workspaces ?? []
    if (allWorkspaces.length === 0)
      throw new Error('No workspaces found for this account')

    const primaryWsId = allWorkspaces[0]!.id
    const primaryWsName = allWorkspaces[0]!.name
    console.warn(`[E2E provision] primary workspace (fallback): ${primaryWsName} (${primaryWsId})`)
    return { primaryWsId, primaryWsName, secondaryWsId: primaryWsId }
  }

  const primaryWsId = autoWorkspaces[0]!.id
  const primaryWsName = autoWorkspaces[0]!.name
  const secondaryWsId = autoWorkspaces[1]?.id ?? primaryWsId

  console.warn(`[E2E provision] primary workspace: ${primaryWsName} (${primaryWsId})`)
  if (autoWorkspaces[1]) {
    console.warn(`[E2E provision] secondary workspace: ${autoWorkspaces[1].name} (${secondaryWsId})`)
  }
  else {
    console.warn('[E2E provision] only one "auto" workspace found — ws2 reuses primary')
  }

  return { primaryWsId, primaryWsName, secondaryWsId }
}

// ── App provisioning ──────────────────────────────────────────────────────

/**
 * Idempotently provision all E2E fixture apps.
 *
 * CE: imports all fixtures into the single workspace (ws2-workflow.yml is
 *     skipped because there is no secondary workspace).
 *
 * EE: imports primary-workspace fixtures into primaryWsId and
 *     ws2-workflow.yml into secondaryWsId.
 *
 * Per app:
 *   1. Switch to the app's workspace
 *   2. Search by app name — reuse existing app when found
 *   3. If not found → import from local DSL fixture file
 *   4. Enable Service API
 *   5. Publish (workflow / advanced-chat / agent-chat only)
 *   6. Set access_mode → public
 *
 * Returns envVar → resolvedAppId map.
 */
async function provisionApps(
  consoleBase: string,
  cookieString: string,
  csrfToken: string,
  primaryWsId: string,
  secondaryWsId: string,
  fixturesDir: string,
  edition: 'ce' | 'ee',
  enterpriseApiUrl: string,
  enterpriseApiSecretKey: string,
): Promise<Record<string, string>> {
  const NEEDS_PUBLISH = new Set(['workflow', 'advanced-chat', 'agent-chat'])

  const mkHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
    'Cookie': cookieString,
    'X-CSRF-Token': csrfToken,
    ...extra,
  })

  // ws2-workflow.yml is only provisioned in EE mode (secondary workspace)
  const APP_SPECS: Array<[string, string, string]> = [
    ['echo-chat.yml', 'DIFY_E2E_CHAT_APP_ID', primaryWsId],
    ['echo-workflow.yml', 'DIFY_E2E_WORKFLOW_APP_ID', primaryWsId],
    ['file-upload.yml', 'DIFY_E2E_FILE_APP_ID', primaryWsId],
    ['hitl-main.yml', 'DIFY_E2E_HITL_APP_ID', primaryWsId],
    ['hitl-external.yml', 'DIFY_E2E_HITL_EXTERNAL_APP_ID', primaryWsId],
    ['hitl-single-action.yml', 'DIFY_E2E_HITL_SINGLE_ACTION_APP_ID', primaryWsId],
    ['hitl-multi-node.yml', 'DIFY_E2E_HITL_MULTI_NODE_APP_ID', primaryWsId],
    ['file-chat.yml', 'DIFY_E2E_FILE_CHAT_APP_ID', primaryWsId],
    // ws2-workflow is only meaningful when there is a real secondary workspace
    ...(edition === 'ee'
      ? [['ws2-workflow.yml', 'DIFY_E2E_WS2_APP_ID', secondaryWsId] as [string, string, string]]
      : []),
  ]

  async function switchWorkspace(wsId: string): Promise<void> {
    const r = await fetch(`${consoleBase}/console/api/workspaces/switch`, {
      method: 'POST',
      headers: mkHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ tenant_id: wsId }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok)
      throw new Error(`workspace switch to ${wsId} failed: HTTP ${r.status}`)
  }

  async function findAppByName(name: string): Promise<string | null> {
    const url = `${consoleBase}/console/api/apps?name=${encodeURIComponent(name)}&limit=50&page=1`
    const r = await fetch(url, { headers: mkHeaders(), signal: AbortSignal.timeout(10_000) })
    if (!r.ok)
      return null
    const d = await r.json() as { data?: Array<{ id: string, name: string }> }
    return d.data?.find(a => a.name === name)?.id ?? null
  }

  async function importFromDsl(yamlContent: string): Promise<string> {
    const r = await fetch(`${consoleBase}/console/api/apps/imports`, {
      method: 'POST',
      headers: mkHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ mode: 'yaml-content', yaml_content: yamlContent }),
      signal: AbortSignal.timeout(30_000),
    })
    const d = await r.json() as { app_id?: string, import_id?: string, status?: string }
    if (r.status === 202 && d.import_id) {
      const cr = await fetch(`${consoleBase}/console/api/apps/imports/${d.import_id}/confirm`, {
        method: 'POST',
        headers: mkHeaders(),
        signal: AbortSignal.timeout(15_000),
      })
      const c = await cr.json() as { app_id?: string }
      if (!c.app_id)
        throw new Error(`import confirm failed: HTTP ${cr.status}`)
      return c.app_id
    }
    if (!d.app_id)
      throw new Error(`import failed: HTTP ${r.status} ${JSON.stringify(d)}`)
    return d.app_id
  }

  async function enableApi(appId: string): Promise<void> {
    await fetch(`${consoleBase}/console/api/apps/${appId}/api-enable`, {
      method: 'POST',
      headers: mkHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ enable_api: true }),
      signal: AbortSignal.timeout(10_000),
    })
  }

  async function publishWorkflow(appId: string): Promise<void> {
    await fetch(`${consoleBase}/console/api/apps/${appId}/workflows/publish`, {
      method: 'POST',
      headers: mkHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ marked_name: 'e2e-provision', marked_comment: '' }),
      signal: AbortSignal.timeout(20_000),
    })
  }

  const results: Record<string, string> = {}
  let currentWs = ''

  for (const [dslFile, envVar, wsId] of APP_SPECS) {
    try {
      if (wsId !== currentWs) {
        await switchWorkspace(wsId)
        currentWs = wsId
      }

      const dsl = await readFile(join(fixturesDir, dslFile), 'utf8')
      const appName = (dsl.match(/^[ \t]+name:[ \t]*(\S[^\n]*)$/m) ?? [])[1]?.trim().replace(/^['"]|['"]$/g, '') ?? dslFile
      const appMode = (dsl.match(/^[ \t]+mode:[ \t]*(\S+)/m) ?? [])[1] ?? ''

      let appId = await findAppByName(appName)
      if (appId) {
        console.warn(`[E2E provision] ${dslFile}: exists id=${appId}`)
      }
      else {
        appId = await importFromDsl(dsl)
        console.warn(`[E2E provision] ${dslFile}: imported id=${appId}`)
      }

      await enableApi(appId)
      await setAppPublic(
        consoleBase,
        cookieString,
        csrfToken,
        appId,
        edition,
        enterpriseApiUrl,
        enterpriseApiSecretKey,
      )
      if (NEEDS_PUBLISH.has(appMode))
        await publishWorkflow(appId)

      results[envVar] = appId
    }
    catch (err) {
      console.warn(`[E2E provision] ${dslFile} skipped: ${err}`)
    }
  }

  return results
}

// ── Token minting via device flow ──────────────────────────────────────────

async function mintTokenWithSession(
  consoleBase: string,
  cookieString: string,
  csrfToken: string,
  label: string,
): Promise<string> {
  // Step 1 — request device code
  const codeRes = await fetch(`${consoleBase}/openapi/v1/oauth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'difyctl', device_label: label }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!codeRes.ok)
    throw new Error(`device/code failed: HTTP ${codeRes.status}`)
  const { device_code, user_code } = await codeRes.json() as { device_code: string, user_code: string }

  // Step 2 — approve the device code
  const approveRes = await fetch(`${consoleBase}/openapi/v1/oauth/device/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieString,
      'X-CSRFToken': csrfToken,
    },
    body: JSON.stringify({ user_code }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!approveRes.ok)
    throw new Error(`device/approve failed: HTTP ${approveRes.status}`)

  // Step 3 — exchange device code for bearer token
  const tokenRes = await fetch(`${consoleBase}/openapi/v1/oauth/device/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_code, client_id: 'difyctl' }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!tokenRes.ok)
    throw new Error(`device/token failed: HTTP ${tokenRes.status}`)

  const tokenBody = await tokenRes.json() as { token?: string, error?: string }
  if (!tokenBody.token)
    throw new Error(`device/token response missing token: ${JSON.stringify(tokenBody)}`)

  return tokenBody.token
}

// ── App access-mode helper ─────────────────────────────────────────────────

/**
 * Set an app's WebApp access_mode to "public".
 *
 * CE:  calls POST /console/api/enterprise/webapp/app/access-mode via the
 *      console session cookie. This endpoint returns 404 on CE servers —
 *      the warning is non-fatal and tests still pass because access_mode
 *      is not enforced on CE.
 *
 * EE:  calls the same endpoint first (console cookie path), then falls
 *      back to the enterprise admin API if needed.
 */
async function setAppPublic(
  consoleBase: string,
  cookieString: string,
  csrfToken: string,
  appId: string,
  edition: 'ce' | 'ee',
  enterpriseApiUrl: string,
  enterpriseApiSecretKey: string,
): Promise<void> {
  try {
    const res = await fetch(`${consoleBase}/console/api/enterprise/webapp/app/access-mode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieString,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ appId, accessMode: 'public' }),
      signal: AbortSignal.timeout(10_000),
    })

    if (res.ok) {
      console.warn(`[E2E provision] setAppPublic(${appId}): access_mode → public (console)`)
      return
    }

    // CE: 404 is expected — access_mode is not enforced
    if (edition === 'ce') {
      const body = await res.text().catch(() => '')
      console.warn(`[E2E provision] setAppPublic(${appId}) skipped on CE: HTTP ${res.status} ${body.slice(0, 100)}`)
      return
    }

    // EE: fall back to enterprise admin API
    console.warn(`[E2E provision] setAppPublic console path returned ${res.status}; trying enterprise API`)
  }
  catch (err) {
    if (edition === 'ce') {
      console.warn(`[E2E provision] setAppPublic(${appId}) non-fatal on CE: ${err}`)
      return
    }
    console.warn(`[E2E provision] setAppPublic console path error: ${err}; trying enterprise API`)
  }

  // EE fallback: enterprise admin API
  if (!enterpriseApiUrl)
    return

  try {
    const res = await fetch(`${enterpriseApiUrl}/apps/${appId}/access-mode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${enterpriseApiSecretKey}`,
      },
      body: JSON.stringify({ access_mode: 'public' }),
      signal: AbortSignal.timeout(10_000),
    })

    if (res.ok) {
      console.warn(`[E2E provision] setAppPublic(${appId}): access_mode → public (enterprise API)`)
    }
    else {
      const body = await res.text().catch(() => '')
      console.warn(`[E2E provision] setAppPublic enterprise API(${appId}): HTTP ${res.status} ${body.slice(0, 100)}`)
    }
  }
  catch (err) {
    console.warn(`[E2E provision] setAppPublic enterprise API(${appId}) error (non-fatal): ${err}`)
  }
}
