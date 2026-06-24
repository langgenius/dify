/**
 * Vitest global setup — runs once before all E2E suites.
 *
 * ── CE path (DIFY_E2E_EDITION=ce or unset) ───────────────────────────────
 *  1. Register a new account with EMAIL/PASSWORD (idempotent).
 *  2. Login to obtain a session cookie.
 *  3. Mint the primary bearer token via the device flow.
 *  4. Validate the token.
 *  5. Discover the single workspace (falls back to first available).
 *  6. Mint per-suite dedicated tokens (logout / devices suites).
 *  7. Import all DSL fixtures into the workspace, publish & set public.
 *
 * ── EE path (DIFY_E2E_EDITION=ee) ────────────────────────────────────────
 *  Workspaces are pre-created by the operator and must be named:
 *    primary   → "auto_test0"
 *    secondary → "auto_test1"
 *
 *  1. Login with EMAIL/PASSWORD to obtain a session cookie.
 *  2. Mint the primary bearer token via the device flow.
 *  3. Validate the token.
 *  4. Discover "auto_test0" (primary) and "auto_test1" (secondary) workspaces.
 *  5. Mint per-suite dedicated tokens.
 *  6. Import DSL fixtures into primary workspace; import ws2-workflow.yml
 *     into the secondary workspace. Publish & set access_mode → public.
 */

import type { TestProject } from 'vitest/node'
import type { E2ECapabilities } from './env.js'
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { injectAuth, run } from '../helpers/cli.js'
import { loadE2EEnv } from './env.js'

const TOKEN_MINT_APPROVE_ATTEMPTS = 5
const TOKEN_MINT_RETRY_BASE_MS = 2_000

export async function setup(project: TestProject): Promise<void> {
  if (process.env.DIFY_E2E_MODE === 'local')
    return

  const E = loadE2EEnv()
  const consoleBase = E.consoleUrl.replace(/\/$/, '')
  const apiBase = E.host.replace(/\/$/, '')

  console.warn(`[E2E global-setup] Edition: ${E.edition.toUpperCase()}`)

  // ── Account bootstrap ────────────────────────────────────────────────────
  if (E.edition === 'ce') {
    await ceRegisterAccount(consoleBase, E.email, E.password)
  }
  // EE: account & workspaces are pre-provisioned by the operator — just login.

  // ── Login ────────────────────────────────────────────────────────────────
  const { cookieString, csrfToken } = await consoleLogin(consoleBase, E.email, E.password)

  // ── Mint primary token (with local cache to avoid rate-limit) ──────────
  // Priority: DIFY_E2E_TOKEN env → .token-cache.json → fresh mint
  // The cache file lives next to .env.e2e and is git-ignored.
  // logoutToken/devicesToken are intentionally NOT cached — those suites
  // revoke their token, so they always need a fresh one.
  const TOKEN_CACHE = join(process.cwd(), '.token-cache.json')

  async function loadCachedToken(): Promise<string> {
    try {
      const raw = await readFile(TOKEN_CACHE, 'utf8')
      const { token, host } = JSON.parse(raw) as { token?: string, host?: string }
      // Invalidate if host changed (different staging env)
      if (!token || host !== E.host)
        return ''
      return token
    }
    catch { return '' }
  }

  async function saveCachedToken(token: string): Promise<void> {
    try {
      await writeFile(TOKEN_CACHE, JSON.stringify({ token, host: E.host }, null, 2), 'utf8')
    }
    catch (err) {
      console.warn(`[E2E] Could not save token cache: ${err}`)
    }
  }

  async function validateToken(token: string): Promise<boolean> {
    try {
      const r = await fetch(`${apiBase}/openapi/v1/account/sessions?page=1&limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8_000),
      })
      return r.ok
    }
    catch { return false }
  }

  let primaryToken = E.token
  if (primaryToken) {
    console.warn(`[E2E] primaryToken from env: ${primaryToken.slice(0, 20)}…`)
  }
  else {
    // Try cache first
    const cached = await loadCachedToken()
    if (cached && await validateToken(cached)) {
      primaryToken = cached
      console.warn(`[E2E] primaryToken from cache: ${primaryToken.slice(0, 20)}…`)
    }
    else {
      if (cached)
        console.warn('[E2E] Cached token invalid or expired — re-minting…')
      try {
        primaryToken = await mintTokenWithSession(consoleBase, cookieString, csrfToken, 'e2e-primary')
        await saveCachedToken(primaryToken)
        console.warn(`[E2E] primaryToken minted and cached: ${primaryToken.slice(0, 20)}…`)
      }
      catch (err) {
        throw new Error(
          `[E2E global-setup] Failed to mint primary token: ${err}\n`
          + 'Ensure DIFY_E2E_EMAIL and DIFY_E2E_PASSWORD are correct.',
        )
      }
    }
  }

  // ── Validate primary token ───────────────────────────────────────────────
  const sessionsUrl = `${apiBase}/openapi/v1/account/sessions?page=1&limit=100`
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

  console.warn(`[E2E] Server healthy, primary token valid at ${E.host}`)

  // ── Resolve token_id ─────────────────────────────────────────────────────
  const body = await res.json() as { data: Array<{ id: string, prefix: string }> }
  const match = body.data.find(s => s.prefix !== '' && primaryToken.startsWith(s.prefix))
  if (!match) {
    console.warn('[E2E global-setup] Could not resolve token_id — devicesToken selfHit detection may not work')
  }
  else {
    console.warn(`[E2E] Resolved token_id: ${match.id}`)
  }

  // ── Discover workspaces ──────────────────────────────────────────────────
  const workspaces = await discoverWorkspaces(
    consoleBase,
    cookieString,
    csrfToken,
    E.edition,
  )
  if (!workspaces) {
    // @ts-expect-error — ProvidedContext augmentation cannot be expressed without
    // triggering TS2300 or TS2664 under tsgo; safe at runtime.
    project.provide('e2eCapabilities', {
      tokenValid: true,
      tokenId: match?.id,
      edition: E.edition,
      token: primaryToken,
      logoutToken: '',
      devicesToken: '',
      workspaceId: '',
      workspaceName: '',
      ws2Id: '',
      chatAppId: '',
      workflowAppId: '',
      fileAppId: '',
      fileChatAppId: '',
      hitlAppId: '',
      hitlExternalAppId: '',
      hitlSingleActionAppId: '',
      hitlMultiNodeAppId: '',
      ws2AppId: '',
    } satisfies E2ECapabilities)
    return
  }
  const { primaryWsId, primaryWsName, secondaryWsId } = workspaces

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
  // Skip provisionApps when app IDs are already injected via DIFY_E2E_*_APP_ID
  // environment variables (e.g. from the CI provision job). Running provisionApps
  // in every parallel suite job causes race conditions: multiple jobs query
  // findAppByName simultaneously, all get "not found", then each imports the DSL
  // independently — creating duplicate apps per workspace.
  let provisionedIds: Record<string, string> = {}
  const preProvisioned = [
    'DIFY_E2E_CHAT_APP_ID',
    'DIFY_E2E_WORKFLOW_APP_ID',
    'DIFY_E2E_FILE_APP_ID',
    'DIFY_E2E_FILE_CHAT_APP_ID',
    'DIFY_E2E_HITL_APP_ID',
    'DIFY_E2E_HITL_EXTERNAL_APP_ID',
    'DIFY_E2E_HITL_SINGLE_ACTION_APP_ID',
    'DIFY_E2E_HITL_MULTI_NODE_APP_ID',
    'DIFY_E2E_WS2_APP_ID',
  ]
  const envAppIds: Record<string, string> = {}
  for (const key of preProvisioned) {
    const val = process.env[key]
    if (val && val !== '')
      envAppIds[key] = val
  }
  const allPreset = preProvisioned.every(k => envAppIds[k] !== undefined)

  if (allPreset) {
    // All app IDs already available via env — skip provisioning to avoid
    // race conditions in parallel CI jobs.
    provisionedIds = envAppIds
    console.warn(`[E2E global-setup] App IDs pre-set via env — skipping provisionApps (${Object.keys(provisionedIds).length} apps)`)
  }
  else {
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
        primaryToken,
        apiBase,
        E.email,
        primaryWsName,
      )
      console.warn(`[E2E global-setup] Provisioned ${Object.keys(provisionedIds).length} fixture apps`)
    }
    catch (err) {
      console.warn(`[E2E global-setup] provisionApps failed (non-fatal): ${err}`)
    }
  }

  // ── Provide capabilities ─────────────────────────────────────────────────
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
    chatAppId: provisionedIds.DIFY_E2E_CHAT_APP_ID || E.chatAppId,
    workflowAppId: provisionedIds.DIFY_E2E_WORKFLOW_APP_ID || E.workflowAppId,
    fileAppId: provisionedIds.DIFY_E2E_FILE_APP_ID || E.fileAppId,
    fileChatAppId: provisionedIds.DIFY_E2E_FILE_CHAT_APP_ID || E.fileChatAppId,
    hitlAppId: provisionedIds.DIFY_E2E_HITL_APP_ID || E.hitlAppId,
    hitlExternalAppId: provisionedIds.DIFY_E2E_HITL_EXTERNAL_APP_ID || E.hitlExternalAppId,
    hitlSingleActionAppId: provisionedIds.DIFY_E2E_HITL_SINGLE_ACTION_APP_ID || E.hitlSingleActionAppId,
    hitlMultiNodeAppId: provisionedIds.DIFY_E2E_HITL_MULTI_NODE_APP_ID || E.hitlMultiNodeAppId,
    ws2AppId: provisionedIds.DIFY_E2E_WS2_APP_ID || E.ws2AppId,
  }

  // @ts-expect-error — ProvidedContext augmentation cannot be expressed without
  // triggering TS2300 or TS2664 under tsgo; safe at runtime.
  project.provide('e2eCapabilities', capabilities)
}

export { teardown } from './global-teardown.js'

// ══════════════════════════════════════════════════════════════════════════════
// CE — account registration
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Register a CE account idempotently.
 * Tries /init (fresh server) first, then falls back to /register.
 * A 409 "already exists" response is treated as success.
 */
async function ceRegisterAccount(consoleBase: string, email: string, password: string): Promise<void> {
  const passwordB64 = Buffer.from(password, 'utf8').toString('base64')
  const name = email.split('@')[0] ?? 'e2e-user'

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
// Shared helpers
// ══════════════════════════════════════════════════════════════════════════════

// ── Console login ─────────────────────────────────────────────────────────

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

// ── Workspace discovery ───────────────────────────────────────────────────

/**
 * Discover primary and secondary workspaces.
 *
 * CE: looks for any workspace with "auto" in its name; falls back to the
 *     first available workspace. secondaryWsId === primaryWsId when only
 *     one workspace exists.
 *
 * EE: looks for workspaces named exactly "auto_test0" (primary) and
 *     "auto_test1" (secondary). These must be pre-created by the operator.
 *     Throws if "auto_test0" is not found.
 */
async function discoverWorkspaces(
  consoleBase: string,
  cookieString: string,
  csrfToken: string,
  edition: 'ce' | 'ee',
): Promise<{ primaryWsId: string, primaryWsName: string, secondaryWsId: string } | null> {
  const wsRes = await fetch(`${consoleBase}/console/api/workspaces`, {
    headers: { 'Cookie': cookieString, 'X-CSRF-Token': csrfToken },
    signal: AbortSignal.timeout(10_000),
  })
  if (!wsRes.ok)
    throw new Error(`list workspaces failed: HTTP ${wsRes.status}`)

  const wsBody = await wsRes.json() as {
    workspaces?: Array<{ id: string, name: string }>
  }
  const all = wsBody.workspaces ?? []

  if (edition === 'ee') {
    // EE: must find the two pre-created workspaces by exact name
    const ws0 = all.find(w => w.name === 'auto_test0')
    const ws1 = all.find(w => w.name === 'auto_test1')

    if (!ws0 || !ws1) {
      const existing = all.map(w => w.name).join(', ') || '(none)'
      console.warn(
        `[E2E EE] Required workspaces not found; expected auto_test0 and auto_test1, got: ${existing}. `
        + 'Skip fixture app provisioning.',
      )
      return null
    }

    const primaryWsId = ws0.id
    const primaryWsName = ws0.name
    const secondaryWsId = ws1.id

    console.warn(`[E2E EE] primary   workspace: ${primaryWsName} (${primaryWsId})`)
    console.warn(`[E2E EE] secondary workspace: ${ws1.name} (${secondaryWsId})`)

    return { primaryWsId, primaryWsName, secondaryWsId }
  }

  // CE: look for workspaces with "auto" in the name, sorted alphabetically
  const autoWorkspaces = all
    .filter(w => w.name.toLowerCase().includes('auto'))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (autoWorkspaces.length > 0) {
    const primaryWsId = autoWorkspaces[0]!.id
    const primaryWsName = autoWorkspaces[0]!.name
    const secondaryWsId = autoWorkspaces[1]?.id ?? primaryWsId
    console.warn(`[E2E CE] primary workspace: ${primaryWsName} (${primaryWsId})`)
    if (autoWorkspaces[1])
      console.warn(`[E2E CE] secondary workspace: ${autoWorkspaces[1].name} (${secondaryWsId})`)
    else
      console.warn('[E2E CE] only one "auto" workspace found — ws2 reuses primary')
    return { primaryWsId, primaryWsName, secondaryWsId }
  }

  // CE fallback: use the first available workspace
  if (all.length === 0)
    throw new Error('[E2E CE] No workspaces found for this account')

  const primaryWsId = all[0]!.id
  const primaryWsName = all[0]!.name
  console.warn(`[E2E CE] primary workspace (fallback): ${primaryWsName} (${primaryWsId})`)
  return { primaryWsId, primaryWsName, secondaryWsId: primaryWsId }
}

// ── App provisioning ──────────────────────────────────────────────────────

/**
 * Idempotently provision all E2E fixture apps.
 *
 * CE: imports all primary-workspace fixtures; skips ws2-workflow.yml
 *     (no real secondary workspace).
 *
 * EE: imports primary-workspace fixtures into auto_test0, and
 *     ws2-workflow.yml into auto_test1.
 *
 * Per app:
 *   1. Switch to the target workspace
 *   2. Search by app name — reuse existing app when found
 *   3. If not found → import from DSL file
 *   4. Enable Service API
 *   5. Publish (workflow / advanced-chat / agent-chat only)
 *   6. Set access_mode → public
 */
async function provisionApps(
  consoleBase: string,
  cookieString: string,
  csrfToken: string,
  primaryWsId: string,
  secondaryWsId: string,
  fixturesDir: string,
  edition: 'ce' | 'ee',
  token: string,
  host: string,
  email: string,
  primaryWsName: string,
): Promise<Record<string, string>> {
  const NEEDS_PUBLISH = new Set(['workflow', 'advanced-chat', 'agent-chat'])

  const mkHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
    'Cookie': cookieString,
    'X-CSRF-Token': csrfToken,
    ...extra,
  })

  // ws2-workflow.yml is only provisioned in EE mode (real secondary workspace)
  const APP_SPECS: Array<[string, string, string]> = [
    ['echo-chat.yml', 'DIFY_E2E_CHAT_APP_ID', primaryWsId],
    ['echo-workflow.yml', 'DIFY_E2E_WORKFLOW_APP_ID', primaryWsId],
    ['file-upload.yml', 'DIFY_E2E_FILE_APP_ID', primaryWsId],
    ['hitl-main.yml', 'DIFY_E2E_HITL_APP_ID', primaryWsId],
    ['hitl-external.yml', 'DIFY_E2E_HITL_EXTERNAL_APP_ID', primaryWsId],
    ['hitl-single-action.yml', 'DIFY_E2E_HITL_SINGLE_ACTION_APP_ID', primaryWsId],
    ['hitl-multi-node.yml', 'DIFY_E2E_HITL_MULTI_NODE_APP_ID', primaryWsId],
    ['file-chat.yml', 'DIFY_E2E_FILE_CHAT_APP_ID', primaryWsId],
    ...(edition === 'ee'
      ? [['ws2-workflow.yml', 'DIFY_E2E_WS2_APP_ID', secondaryWsId] as [string, string, string]]
      : []),
  ]

  const configDir = await mkdtemp(join(tmpdir(), 'difyctl-e2e-provision-'))
  await injectAuth(configDir, {
    host,
    bearer: token,
    email,
    workspaceId: primaryWsId,
    workspaceName: primaryWsName,
  })

  async function importAppCli(filePath: string, wsId: string): Promise<string> {
    const result = await run(
      ['import', 'studio-app', '--from-file', filePath, '--workspace', wsId],
      { configDir, timeout: 60_000 },
    )
    if (result.exitCode !== 0)
      throw new Error(`import studio-app failed (exit ${result.exitCode}): ${result.stderr}`)
    const match = result.stderr.match(/app ([0-9a-f-]{36})/)
    if (!match?.[1])
      throw new Error(`import studio-app: could not parse app_id: ${result.stderr}`)
    return match[1]
  }

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
      throw new Error(`list apps by name "${name}" failed: HTTP ${r.status}`)
    const d = await r.json() as { data?: Array<{ id: string, name: string }> }
    return d.data?.find(a => a.name === name)?.id ?? null
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

  async function setAppPublic(appId: string): Promise<void> {
    try {
      const r = await fetch(`${consoleBase}/console/api/enterprise/webapp/app/access-mode`, {
        method: 'POST',
        headers: mkHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ appId, accessMode: 'public' }),
        signal: AbortSignal.timeout(10_000),
      })
      if (r.ok) {
        console.warn(`[E2E provision] setAppPublic(${appId}): access_mode → public`)
      }
      else {
        // CE servers return 404 here — non-fatal
        const text = await r.text().catch(() => '')
        console.warn(`[E2E provision] setAppPublic(${appId}) skipped: HTTP ${r.status} ${text.slice(0, 100)}`)
      }
    }
    catch (err) {
      console.warn(`[E2E provision] setAppPublic(${appId}) error (non-fatal): ${err}`)
    }
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
      const appName = (dsl.match(/^[ \t]+name:[ \t]*(\S[^\n]*)$/m) ?? [])[1]
        ?.trim()
        .replace(/^['"]|['"]$/g, '') ?? dslFile
      const appMode = (dsl.match(/^\s+mode:\s*(\S+)/m) ?? [])[1] ?? ''

      let appId = await findAppByName(appName)
      if (appId) {
        console.warn(`[E2E provision] ${dslFile}: exists in workspace id=${appId}; skip import`)
      }
      else {
        appId = await importAppCli(join(fixturesDir, dslFile), wsId)
        console.warn(`[E2E provision] ${dslFile}: imported id=${appId}`)
      }

      await enableApi(appId)
      await setAppPublic(appId)
      if (NEEDS_PUBLISH.has(appMode))
        await publishWorkflow(appId)

      results[envVar] = appId
    }
    catch (err) {
      console.warn(`[E2E provision] ${dslFile} skipped: ${err}`)
    }
  }

  await rm(configDir, { recursive: true, force: true }).catch((err: unknown) =>
    console.warn(`[E2E provision] failed to clean up configDir: ${err}`),
  )
  return results
}

// ── Token minting via device flow ─────────────────────────────────────────

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

  // Step 2 — approve
  const approveRes = await approveDeviceCodeWithRetry({
    consoleBase,
    cookieString,
    csrfToken,
    userCode: user_code,
  })
  if (!approveRes.ok)
    throw new Error(`device/approve failed: HTTP ${approveRes.status}`)

  // Step 3 — exchange for bearer token
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

async function approveDeviceCodeWithRetry(opts: {
  readonly consoleBase: string
  readonly cookieString: string
  readonly csrfToken: string
  readonly userCode: string
}): Promise<Response> {
  let lastResponse: Response | undefined
  for (let attempt = 1; attempt <= TOKEN_MINT_APPROVE_ATTEMPTS; attempt++) {
    const response = await fetch(`${opts.consoleBase}/openapi/v1/oauth/device/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': opts.cookieString,
        'X-CSRFToken': opts.csrfToken,
      },
      body: JSON.stringify({ user_code: opts.userCode }),
      signal: AbortSignal.timeout(10_000),
    })
    if (response.ok || !isRetryableApproveStatus(response.status))
      return response

    lastResponse = response
    const delayMs = TOKEN_MINT_RETRY_BASE_MS * attempt
    console.warn(`[E2E] device approve HTTP ${response.status}; retrying in ${delayMs}ms (${attempt}/${TOKEN_MINT_APPROVE_ATTEMPTS})`)
    await sleep(delayMs)
  }
  return lastResponse ?? new Response(null, { status: 429 })
}

function isRetryableApproveStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
