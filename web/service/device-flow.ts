// Web-side calls into the Dify device-flow endpoints:
//
//   /v1/oauth/device/lookup            (public — GET, no auth, IP-rate-limited)
//   /v1/oauth/device/approval-context  (cookie-authed — GET)
//   /v1/oauth/device/approve-external  (cookie-authed + CSRF — POST)
//   /console/api/oauth/device/approve  (session-authed — POST)
//   /console/api/oauth/device/deny     (session-authed — POST)
//
// Approve/deny use the standard service/base helpers so they get console-
// session cookies automatically. Lookup + SSO-branch endpoints sit under
// /v1 so they ride the existing service-API gateway route.

import { post } from './base'

const DEVICE_BASE = '/v1/oauth/device'

// Typed error thrown by every wrapper here. The page/component layer
// switches on `code` to choose user-facing copy / view; never render
// `status` or raw body to the user.
export class DeviceFlowError extends Error {
  constructor(public code: string, public status: number) {
    super(code)
    this.name = 'DeviceFlowError'
  }
}

// Translate a non-2xx fetch Response into a DeviceFlowError. Honours the
// server contract `{"error": "<code>"}` and falls back to a status-class
// code so callers can still dispatch (rate_limited / server_error / ...).
async function failFromResponse(res: Response): Promise<never> {
  let serverCode = ''
  try {
    const body = await res.clone().json()
    if (body && typeof body.error === 'string') serverCode = body.error
  }
  catch { /* non-JSON body — fall through to status mapping */ }

  const code = serverCode || statusFallbackCode(res.status)
  throw new DeviceFlowError(code, res.status)
}

function statusFallbackCode(status: number): string {
  if (status === 429) return 'rate_limited'
  if (status === 401) return 'no_session'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status >= 500) return 'server_error'
  return 'unknown'
}

// ----- Account branch --------------------------------------------------------

export type DeviceLookupReply = {
  valid: boolean
  expires_in_remaining: number
  client_id: string
}

export async function deviceLookup(user_code: string): Promise<DeviceLookupReply> {
  const res = await fetch(`${DEVICE_BASE}/lookup?user_code=${encodeURIComponent(user_code)}`, {
    method: 'GET',
  })
  if (!res.ok) await failFromResponse(res)
  return res.json()
}

export const deviceApproveAccount = (user_code: string) =>
  post<{ status: 'approved' }>('/oauth/device/approve', { body: { user_code } })

export const deviceDenyAccount = (user_code: string) =>
  post<{ status: 'denied' }>('/oauth/device/deny', { body: { user_code } })

// ----- SSO branch (cookie-authed via /v1/oauth/device/*) --------------------

export type ApprovalContext = {
  subject_email: string
  subject_issuer: string
  user_code: string
  csrf_token: string
  expires_at: string
}

export async function fetchApprovalContext(): Promise<ApprovalContext> {
  const res = await fetch(`${DEVICE_BASE}/approval-context`, {
    method: 'GET',
    credentials: 'include',
  })
  if (!res.ok) await failFromResponse(res)
  return res.json()
}

export async function approveExternal(ctx: ApprovalContext, user_code: string): Promise<void> {
  const res = await fetch(`${DEVICE_BASE}/approve-external`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': ctx.csrf_token,
    },
    body: JSON.stringify({ user_code }),
  })
  if (!res.ok) await failFromResponse(res)
}
