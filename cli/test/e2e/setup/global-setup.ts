/**
 * Vitest global setup — runs once before all E2E suites.
 *
 * Responsibilities:
 *  1. Validate required environment variables are present.
 *  2. Confirm the staging server is reachable AND the shared token is valid —
 *     GET /openapi/v1/account/sessions (HTTP 200 = valid, else abort).
 *  3. Resolve the current session's token_id via the prefix field.
 *  4. Mint per-suite dedicated tokens for suites that revoke sessions:
 *       - logoutToken  → auth/logout.e2e.ts
 *       - devicesToken → auth/devices.e2e.ts
 *     Each suite consumes only its own token, so DIFY_E2E_TOKEN remains
 *     valid for all non-destructive suites throughout the run.
 *
 * If the health-check fails the entire test run is aborted early.
 */

import type { TestProject } from 'vitest/node'
import type { E2ECapabilities } from './env.js'
import { Buffer } from 'node:buffer'
import { loadE2EEnv } from './env.js'

export async function setup(project: TestProject): Promise<void> {
  if (process.env.DIFY_E2E_MODE === 'local')
    return

  const E = loadE2EEnv()
  const base = E.host.replace(/\/$/, '')

  // ── 1. Validate main token ─────────────────────────────────────────────
  const sessionsUrl = `${base}/openapi/v1/account/sessions?page=1&limit=100`
  let res: Response
  try {
    res = await fetch(sessionsUrl, {
      headers: { Authorization: `Bearer ${E.token}` },
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
      `[E2E global-setup] Token is invalid or expired (HTTP ${res.status}).\n`
      + `Update DIFY_E2E_TOKEN and retry.\nURL: ${sessionsUrl}`,
    )
  }

  console.log(`[E2E] Staging server is healthy and token is valid at ${E.host}`)

  // ── 2. Resolve token_id ────────────────────────────────────────────────
  const body = await res.json() as { data: Array<{ id: string, prefix: string }> }
  const match = body.data.find(s => s.prefix !== '' && E.token.startsWith(s.prefix))

  // ── 3. Mint per-suite dedicated tokens ────────────────────────────────
  let logoutToken = ''
  let devicesToken = ''

  if (E.email && E.password) {
    const mint = (label: string) => mintToken(base, E.email, E.password, label)

    const [lt, dt] = await Promise.allSettled([
      mint('e2e-logout-suite'),
      mint('e2e-devices-suite'),
    ])

    if (lt.status === 'fulfilled') {
      logoutToken = lt.value
      console.log(`[E2E] logoutToken  minted: ${logoutToken.slice(0, 20)}…`)
    }
    else {
      console.warn(`[E2E global-setup] Failed to mint logoutToken: ${lt.reason}`)
    }

    if (dt.status === 'fulfilled') {
      devicesToken = dt.value
      console.log(`[E2E] devicesToken minted: ${devicesToken.slice(0, 20)}…`)
    }
    else {
      console.warn(`[E2E global-setup] Failed to mint devicesToken: ${dt.reason}`)
    }
  }
  else {
    console.warn('[E2E global-setup] DIFY_E2E_EMAIL/PASSWORD not set — per-suite tokens not minted; destructive tests may skip')
  }

  const capabilities: E2ECapabilities = {
    tokenValid: true,
    tokenId: match?.id,
    logoutToken,
    devicesToken,
  }

  // ts-ignore: ProvidedContext augmentation is not available in newer vite-plus-test;
  // cast the key to satisfy the type checker without module augmentation.
  // eslint-disable-next-line ts/no-explicit-any
  project.provide('e2eCapabilities' as any, capabilities)
}

export { teardown } from './global-teardown.js'

// ── Device flow token minting ──────────────────────────────────────────────

/**
 * Mint a fresh dfoa_ OAuth token via the 3-step device flow:
 *  1. POST /openapi/v1/oauth/device/code   → device_code + user_code
 *  2. POST /console/api/login              → session cookie + CSRF
 *     POST /openapi/v1/oauth/device/approve (with cookie)
 *  3. POST /openapi/v1/oauth/device/token  → dfoa_ bearer token
 */
async function mintToken(base: string, email: string, password: string, label: string): Promise<string> {
  // Step 1 — request device code
  const codeRes = await fetch(`${base}/openapi/v1/oauth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'difyctl', device_label: label }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!codeRes.ok)
    throw new Error(`device/code failed: HTTP ${codeRes.status}`)
  const { device_code, user_code } = await codeRes.json() as { device_code: string, user_code: string }

  // Step 2a — console login → session cookie + CSRF token
  const passwordB64 = Buffer.from(password, 'utf8').toString('base64')
  const loginRes = await fetch(`${base}/console/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: passwordB64, remember_me: false }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!loginRes.ok)
    throw new Error(`console/api/login failed: HTTP ${loginRes.status}`)

  const setCookieHeaders = loginRes.headers.getSetCookie?.() ?? []
  const cookieString = setCookieHeaders.map(c => c.split(';')[0]).join('; ')
  const csrfMatch = cookieString.match(/csrf_token=([^;]+)/)
  const csrfToken = csrfMatch ? csrfMatch[1] : ''

  // Step 2b — approve the device code
  const approveRes = await fetch(`${base}/openapi/v1/oauth/device/approve`, {
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
  const tokenRes = await fetch(`${base}/openapi/v1/oauth/device/token`, {
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
