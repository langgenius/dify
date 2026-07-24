#!/usr/bin/env bun
import { Buffer } from 'node:buffer'
/**
 * e2e-provision.ts
 *
 * Standalone pre-flight script for CI parallel e2e jobs.
 *
 * What it does (mirrors global-setup.ts, but without vitest):
 *   1. Console login → cookie + CSRF token
 *   2. Mint a primary bearer token (or validate a cached/pre-set one)
 *   3. Discover primary + secondary workspaces
 *   4. Provision all DSL fixture apps (idempotent — reuses existing ones)
 *   5. Write GITHUB_OUTPUT (token, workspace IDs, all app IDs)
 *      so downstream jobs can skip re-minting and re-provisioning.
 *
 * Usage (in CI):
 *   bun scripts/e2e-provision.ts
 *
 * Required env vars:
 *   DIFY_E2E_HOST, DIFY_E2E_EMAIL, DIFY_E2E_PASSWORD
 *
 * Optional:
 *   DIFY_E2E_EDITION      (ee | ce, default: ee)
 *   DIFY_E2E_TOKEN        pre-minted token — skips device-flow mint
 *
 * Output file:
 *   .provision-output.json   (also written to GITHUB_OUTPUT if set)
 */
import { appendFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Env ──────────────────────────────────────────────────────────────────────

const host = process.env.DIFY_E2E_HOST ?? ''
const email = process.env.DIFY_E2E_EMAIL ?? ''
const password = process.env.DIFY_E2E_PASSWORD ?? ''
const edition = (process.env.DIFY_E2E_EDITION ?? 'ee').toLowerCase() as 'ee' | 'ce'
const preToken = process.env.DIFY_E2E_TOKEN ?? ''

if (!host || !email || !password) {
  console.warn('[provision] Missing required env: DIFY_E2E_HOST, DIFY_E2E_EMAIL, DIFY_E2E_PASSWORD')
  process.exit(1)
}

const base = host.replace(/\/$/, '')

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function consoleLogin(): Promise<{ cookieString: string; csrfToken: string }> {
  const passwordB64 = Buffer.from(password, 'utf8').toString('base64')
  const res = await fetch(`${base}/console/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: passwordB64, remember_me: false }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`console/api/login failed: HTTP ${res.status}`)

  const setCookies = res.headers.getSetCookie?.() ?? []
  const cookieString = setCookies.map((c) => c.split(';')[0]).join('; ')
  // cookie names may have __Host- prefix on HTTPS deployments
  const csrfPair = setCookies.map((c) => c.split(';')[0]).find((p) => p.includes('csrf_token='))
  const csrfToken = csrfPair
    ? csrfPair.slice(csrfPair.indexOf('csrf_token=') + 'csrf_token='.length)
    : ''
  return { cookieString, csrfToken }
}

async function validateToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/openapi/v1/account/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok
  } catch {
    return false
  }
}

async function mintToken(cookieStr: string, csrf: string, label: string): Promise<string> {
  // Step 1: device code
  const codeRes = await fetch(`${base}/openapi/v1/oauth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'difyctl', device_label: label }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!codeRes.ok) throw new Error(`device/code failed: HTTP ${codeRes.status}`)
  const { device_code, user_code } = (await codeRes.json()) as {
    device_code: string
    user_code: string
  }

  // Step 2: approve (with retry)
  let approveRes: Response | undefined
  for (let i = 1; i <= 5; i++) {
    approveRes = await fetch(`${base}/openapi/v1/oauth/device/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieStr, 'X-CSRFToken': csrf },
      body: JSON.stringify({ user_code }),
      signal: AbortSignal.timeout(10_000),
    })
    if (approveRes.ok) break
    if (approveRes.status !== 429 && approveRes.status < 500) break
    console.warn(`[provision] device/approve HTTP ${approveRes.status}; retry ${i}/5 in ${i * 2}s`)
    await sleep(i * 2_000)
  }
  if (!approveRes?.ok) throw new Error(`device/approve failed: HTTP ${approveRes?.status}`)

  // Step 3: exchange token
  const tokenRes = await fetch(`${base}/openapi/v1/oauth/device/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_code, client_id: 'difyctl' }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!tokenRes.ok) throw new Error(`device/token failed: HTTP ${tokenRes.status}`)
  const body = (await tokenRes.json()) as { token?: string }
  if (!body.token) throw new Error(`device/token missing token: ${JSON.stringify(body)}`)
  return body.token
}

async function discoverWorkspaces(cookieStr: string, csrf: string) {
  const res = await fetch(`${base}/console/api/workspaces`, {
    headers: { Cookie: cookieStr, 'X-CSRF-Token': csrf },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`list workspaces failed: HTTP ${res.status}`)
  const data = (await res.json()) as { workspaces?: Array<{ id: string; name: string }> }
  const all = data.workspaces ?? []

  if (edition === 'ee') {
    const ws0 = all.find((w) => w.name === 'auto_test0')
    const ws1 = all.find((w) => w.name === 'auto_test1')
    if (!ws0) throw new Error('[provision] EE: workspace "auto_test0" not found')
    console.warn(`[provision] EE primary:   ${ws0.name} (${ws0.id})`)
    console.warn(
      `[provision] EE secondary: ${ws1?.name ?? 'reuses primary'} (${ws1?.id ?? ws0.id})`,
    )
    return { primaryWsId: ws0.id, primaryWsName: ws0.name, secondaryWsId: ws1?.id ?? ws0.id }
  }

  const auto = all
    .filter((w) => w.name.toLowerCase().includes('auto'))
    .sort((a, b) => a.name.localeCompare(b.name))
  const primary = auto[0] ?? all[0]
  if (!primary) throw new Error('[provision] No workspaces found')
  return {
    primaryWsId: primary.id,
    primaryWsName: primary.name,
    secondaryWsId: auto[1]?.id ?? primary.id,
  }
}

async function provisionApps(
  cookieStr: string,
  csrf: string,
  primaryWsId: string,
  secondaryWsId: string,
): Promise<Record<string, string>> {
  const mkH = (extra: Record<string, string> = {}) => ({
    Cookie: cookieStr,
    'X-CSRF-Token': csrf,
    ...extra,
  })

  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const fixturesDir = join(scriptDir, '..', 'test', 'e2e', 'fixtures', 'apps')

  const NEEDS_PUBLISH = new Set(['workflow', 'advanced-chat', 'agent-chat'])
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

  let currentWs = ''
  const results: Record<string, string> = {}

  for (const [dslFile, envVar, wsId] of APP_SPECS) {
    try {
      // Switch workspace if needed
      if (wsId !== currentWs) {
        await fetch(`${base}/console/api/workspaces/switch`, {
          method: 'POST',
          headers: { ...mkH(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant_id: wsId }),
          signal: AbortSignal.timeout(10_000),
        })
        currentWs = wsId
      }

      const dsl = await readFile(join(fixturesDir, dslFile), 'utf8')
      const appName =
        (dsl.match(/^[ \t]+name:[ \t]*(\S[^\n]*)$/m) ?? [])[1]
          ?.trim()
          .replace(/^['"]|['"]$/g, '') ?? dslFile
      const appMode = (dsl.match(/^[ \t]+mode:[ \t]*(\S+)/m) ?? [])[1] ?? ''

      // Find existing or import
      const searchRes = await fetch(
        `${base}/console/api/apps?name=${encodeURIComponent(appName)}&limit=50&page=1`,
        { headers: mkH(), signal: AbortSignal.timeout(10_000) },
      )
      const searchData = (await searchRes.json()) as { data?: Array<{ id: string; name: string }> }
      let appId = searchData.data?.find((a) => a.name === appName)?.id

      if (appId) {
        console.warn(`[provision] ${dslFile}: exists id=${appId}`)
      } else {
        const importRes = await fetch(`${base}/console/api/apps/imports`, {
          method: 'POST',
          headers: { ...mkH(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'yaml-content', yaml_content: dsl }),
          signal: AbortSignal.timeout(30_000),
        })
        const importData = (await importRes.json()) as { app_id?: string; import_id?: string }
        if (importRes.status === 202 && importData.import_id) {
          const confirmRes = await fetch(
            `${base}/console/api/apps/imports/${importData.import_id}/confirm`,
            {
              method: 'POST',
              headers: mkH(),
              signal: AbortSignal.timeout(15_000),
            },
          )
          const confirmData = (await confirmRes.json()) as { app_id?: string }
          appId = confirmData.app_id
        } else {
          appId = importData.app_id
        }
        if (!appId) throw new Error(`import failed: ${JSON.stringify(importData)}`)
        console.warn(`[provision] ${dslFile}: imported id=${appId}`)
      }

      // Enable API
      await fetch(`${base}/console/api/apps/${appId}/api-enable`, {
        method: 'POST',
        headers: { ...mkH(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable_api: true }),
        signal: AbortSignal.timeout(10_000),
      })

      // Set public
      await fetch(`${base}/console/api/enterprise/webapp/app/access-mode`, {
        method: 'POST',
        headers: { ...mkH(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, accessMode: 'public' }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {})

      // Publish workflow
      if (NEEDS_PUBLISH.has(appMode)) {
        await fetch(`${base}/console/api/apps/${appId}/workflows/publish`, {
          method: 'POST',
          headers: { ...mkH(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ marked_name: 'e2e-provision', marked_comment: '' }),
          signal: AbortSignal.timeout(20_000),
        }).catch(() => {})
      }

      results[envVar] = appId
    } catch (err) {
      console.warn(`[provision] ${dslFile} skipped: ${err}`)
    }
  }

  return results
}

async function writeOutputs(outputs: Record<string, string>) {
  const ghOutput = process.env.GITHUB_OUTPUT
  const lines = `${Object.entries(outputs)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')}\n`

  // Always write local JSON for debugging
  const { writeFile } = await import('node:fs/promises')
  await writeFile('.provision-output.json', `${JSON.stringify(outputs, null, 2)}\n`, 'utf8')
  console.warn('[provision] Written .provision-output.json')

  if (ghOutput) {
    await appendFile(ghOutput, lines, 'utf8')
    console.warn(`[provision] Written ${Object.keys(outputs).length} outputs to GITHUB_OUTPUT`)
  }

  // Also print to stdout for visibility
  console.warn('\n[provision] Outputs:')
  for (const [k, v] of Object.entries(outputs))
    console.warn(`  ${k}=${v.slice(0, 30)}${v.length > 30 ? '…' : ''}`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.warn(`[provision] Host=${base} Email=${email} Edition=${edition}`)

  // 1. Login
  const { cookieString, csrfToken } = await consoleLogin()
  console.warn('[provision] Login OK')

  // 2. Token
  let primaryToken = preToken
  if (primaryToken && (await validateToken(primaryToken))) {
    console.warn(`[provision] Using pre-set token: ${primaryToken.slice(0, 20)}…`)
  } else {
    if (primaryToken) console.warn('[provision] Pre-set token invalid, minting fresh…')
    primaryToken = await mintToken(cookieString, csrfToken, 'e2e-provision')
    console.warn(`[provision] Minted token: ${primaryToken.slice(0, 20)}…`)
  }

  // 3. Discover workspaces
  const { primaryWsId, primaryWsName, secondaryWsId } = await discoverWorkspaces(
    cookieString,
    csrfToken,
  )

  // 4. Provision apps
  const appIds = await provisionApps(cookieString, csrfToken, primaryWsId, secondaryWsId)
  console.warn(`[provision] Provisioned ${Object.keys(appIds).length} apps`)

  // 4b. Switch back to primaryWsId so the session ends in the correct workspace.
  //     provisionApps processes ws2-workflow.yml last (EE mode), leaving the server
  //     session in secondaryWsId. Suite jobs that share this token would then have
  //     their describe calls rejected with "workspace_id does not match app's workspace".
  await fetch(`${base}/console/api/workspaces/switch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieString,
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ tenant_id: primaryWsId }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err: unknown) =>
    console.warn(`[provision] switch-back to primary failed (non-fatal): ${err}`),
  )
  console.warn(`[provision] Session workspace reset to primary: ${primaryWsId}`)

  // 5. Write outputs
  await writeOutputs({
    DIFY_E2E_TOKEN: primaryToken,
    DIFY_E2E_WORKSPACE_ID: primaryWsId,
    DIFY_E2E_WORKSPACE_NAME: primaryWsName,
    DIFY_E2E_WS2_ID: secondaryWsId,
    ...appIds,
  })
}

main().catch((err) => {
  console.warn('[provision] Fatal:', err)
  process.exit(1)
})
