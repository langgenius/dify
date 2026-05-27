import type { TestProject } from 'vitest/node'
/**
 * Vitest global setup — runs once before all E2E suites.
 *
 * Responsibilities:
 *  1. Validate required environment variables are present.
 *  2. Confirm the staging server is reachable AND the token is valid —
 *     GET /openapi/v1/account/sessions (HTTP 200 = valid, else abort).
 *  3. Resolve the current session's token_id via the prefix field.
 *  4. Mint a disposable dfoa_ token via the device flow API so that
 *     logout tests can revoke a real session without invalidating the
 *     shared DIFY_E2E_TOKEN used by all other suites.
 *
 * If the health-check fails the entire test run is aborted early.
 */

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
      + `Check DIFY_E2E_HOST and network connectivity.\n${
        String(err)}`,
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

  // ── 3. Mint disposable token for logout tests ──────────────────────────
  let disposableToken = ''
  if (E.email && E.password) {
    try {
      disposableToken = await mintDisposableToken(base, E.email, E.password)

      console.log(`[E2E] Disposable logout-test token minted: ${disposableToken.slice(0, 20)}…`)
    }
    catch (err) {
      // Non-fatal: logout tests will skip if token is empty

      console.warn(`[E2E global-setup] Failed to mint disposable token (logout tests may skip): ${String(err)}`)
    }
  }
  else {
    console.warn('[E2E global-setup] DIFY_E2E_EMAIL/PASSWORD not set — logout revoke tests will be skipped')
  }

  const capabilities: E2ECapabilities = {
    tokenValid: true,
    tokenId: match?.id,
    disposableToken,
  }

  project.provide('e2eCapabilities', capabilities)
}

export { teardown } from './global-teardown.js'

// ── Device flow helper ─────────────────────────────────────────────────────

/**
 * Mint a fresh dfoa_ OAuth token via the 3-step device flow API:
 *  1. POST /openapi/v1/oauth/device/code   → device_code + user_code
 *  2. POST /console/api/login              → console session cookie
 *     POST /openapi/v1/oauth/device/approve (with cookie) → approved
 *  3. POST /openapi/v1/oauth/device/token  → dfoa_ token
 *
 * Password is Base64-encoded before sending (Dify's obfuscation convention).
 */
async function mintDisposableToken(base: string, email: string, password: string): Promise<string> {
  const timeout = AbortSignal.timeout(15_000)

  // Step 1 — request device code
  const codeRes = await fetch(`${base}/openapi/v1/oauth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'difyctl', device_label: 'e2e-disposable-logout' }),
    signal: timeout,
  })
  if (!codeRes.ok)
    throw new Error(`device/code failed: HTTP ${codeRes.status}`)
  const { device_code, user_code } = await codeRes.json() as { device_code: string, user_code: string }

  // Step 2a — console login to get session cookie
  const passwordB64 = Buffer.from(password, 'utf8').toString('base64')
  const loginRes = await fetch(`${base}/console/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: passwordB64, remember_me: false }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!loginRes.ok)
    throw new Error(`console/api/login failed: HTTP ${loginRes.status}`)

  // Extract cookies from Set-Cookie headers
  const setCookieHeaders = loginRes.headers.getSetCookie?.() ?? []
  const cookieString = setCookieHeaders
    .map(c => c.split(';')[0])
    .join('; ')

  // Extract CSRF token value from cookie string
  const csrfMatch = cookieString.match(/csrf_token=([^;]+)/)
  const csrfToken = csrfMatch ? csrfMatch[1] : ''

  // Step 2b — approve the device code using the console session
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

  // Step 3 — poll for the minted token
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
    throw new Error(`device/token response missing token field: ${JSON.stringify(tokenBody)}`)

  return tokenBody.token
}
