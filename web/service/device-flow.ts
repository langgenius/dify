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

import { del, post } from './base'

const DEVICE_BASE = '/v1/oauth/device'

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
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`lookup ${res.status}: ${body}`)
  }
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
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`approval-context ${res.status}: ${body}`)
  }
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
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`approve-external ${res.status}: ${body}`)
  }
}

// ----- Export for future PAT revoke; noop in v1.0 --------------------------

// Intentionally left out: personal_access_tokens endpoints are not in this
// milestone; see docs/specs/v1.0/README.md.
void del // keep import live for the TypeScript linter without surfacing usage
