// Web-side calls into the Dify device-flow endpoints. All routes now sit
// under /openapi/v1/oauth/device/* (Phase G of the openapi migration). The
// approve/deny endpoints still require the console session cookie + CSRF
// token; lookup is unauthenticated; the SSO branch uses cookie + per-flow
// CSRF baked into the approval-context response.
//
//   /openapi/v1/oauth/device/lookup            (public — GET)
//   /openapi/v1/oauth/device/approve           (cookie + CSRF — POST)
//   /openapi/v1/oauth/device/deny              (cookie + CSRF — POST)
//   /openapi/v1/oauth/device/approval-context  (cookie — GET)
//   /openapi/v1/oauth/device/approve-external  (cookie + per-flow CSRF — POST)
//
// /openapi/v1/* is its own URL prefix, so we bypass service/base's
// API_PREFIX (which targets /console/api) and call fetch directly.

import Cookies from 'js-cookie'
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'

const DEVICE_BASE = '/openapi/v1/oauth/device'

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

function consoleCsrfHeader(): Record<string, string> {
  return { [CSRF_HEADER_NAME]: Cookies.get(CSRF_COOKIE_NAME()) || '' }
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

export async function deviceApproveAccount(user_code: string): Promise<{ status: 'approved' }> {
  const res = await fetch(`${DEVICE_BASE}/approve`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...consoleCsrfHeader(),
    },
    body: JSON.stringify({ user_code }),
  })
  if (!res.ok) await failFromResponse(res)
  return res.json()
}

export async function deviceDenyAccount(user_code: string): Promise<{ status: 'denied' }> {
  const res = await fetch(`${DEVICE_BASE}/deny`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...consoleCsrfHeader(),
    },
    body: JSON.stringify({ user_code }),
  })
  if (!res.ok) await failFromResponse(res)
  return res.json()
}

// ----- SSO branch (cookie-authed via /openapi/v1/oauth/device/*) -----------

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
