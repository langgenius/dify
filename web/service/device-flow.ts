// Web-side calls into the Dify device-flow endpoints under /openapi/v1/oauth/device/*.
//
//   /openapi/v1/oauth/device/lookup            (public — GET)
//   /openapi/v1/oauth/device/approve           (cookie + CSRF — POST)
//   /openapi/v1/oauth/device/deny              (cookie + CSRF — POST)
//   /openapi/v1/oauth/device/approval-context  (cookie — GET)
//   /openapi/v1/oauth/device/approve-external  (cookie + per-flow CSRF — POST)
//
// The account branch (lookup / approve / deny) uses the generated openapi
// contract over the shared request layer, which adds the console CSRF header
// and refreshes an expired console session. When the session cannot be
// refreshed the shared layer leaves the /device page in place, so the page
// still renders its own view for the failure.
//
// The SSO branch (approval-context / approve-external) stays on plain fetch:
// approve-external authenticates with the per-flow token from
// approval-context in `X-CSRF-Token`, the same header the shared layer fills
// from the console CSRF cookie, and neither route has a console session to
// refresh. The generated contract does not describe these routes either.

import type { ContractRouterClient, InferContractRouterOutputs } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { device } from '@dify/contracts/api/openapi/orpc.gen'
import { createORPCClient, ORPCError } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
// oxlint-disable-next-line no-restricted-imports -- The device-flow HTTP adapter must reuse the console session's CSRF and refresh handling.
import { request } from './base'

const OPENAPI_PREFIX = '/openapi/v1'
const DEVICE_BASE = `${OPENAPI_PREFIX}/oauth/device`

const deviceFlowContract = { oauth: { device } }

// Same-origin like the SSO calls below: /openapi/v1 is served next to the page, not under API_PREFIX.
const deviceFlowClient: JsonifiedClient<ContractRouterClient<typeof deviceFlowContract>> =
  createORPCClient(
    new OpenAPILink(deviceFlowContract, {
      url: () => new URL(OPENAPI_PREFIX, window.location.origin),
      fetch: (input, init) =>
        // oxlint-disable-next-line typescript/no-deprecated -- Device-flow calls need the shared console CSRF and session refresh transport.
        request<Response>(input.url, init, {
          fetchCompat: true,
          request: input,
        }),
    }),
  )

// Typed error thrown by every wrapper here. The page/component layer
// switches on `code` to choose user-facing copy / view; never render
// `status` or raw body to the user.
export class DeviceFlowError extends Error {
  code: string
  status: number

  constructor(code: string, status: number) {
    super(code)
    this.name = 'DeviceFlowError'
    this.code = code
    this.status = status
  }
}

// Honours the server contract `{"error": "<code>"}` and falls back to a
// status-class code so callers can still dispatch (rate_limited / server_error / ...).
export function deviceFlowErrorFrom(status: number, body: unknown): DeviceFlowError {
  const serverCode =
    body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error
      : ''
  return new DeviceFlowError(serverCode || statusFallbackCode(status), status)
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

// HTTP failures from the shared layer arrive as ORPCError; network failures pass through unchanged.
async function withDeviceFlowError<T>(call: Promise<T>): Promise<T> {
  try {
    return await call
  } catch (error) {
    if (error instanceof ORPCError) throw deviceFlowErrorFrom(error.status, error.data)
    throw error
  }
}

// Translate a non-2xx fetch Response into a DeviceFlowError.
async function failFromResponse(res: Response): Promise<never> {
  let body: unknown
  try {
    body = await res.clone().json()
  } catch {
    /* non-JSON body — fall through to status mapping */
  }
  throw deviceFlowErrorFrom(res.status, body)
}

// ----- Account branch --------------------------------------------------------

export type DeviceLookupReply = InferContractRouterOutputs<
  typeof deviceFlowContract
>['oauth']['device']['lookup']['get']

export function deviceLookup(user_code: string): Promise<DeviceLookupReply> {
  return withDeviceFlowError(deviceFlowClient.oauth.device.lookup.get({ query: { user_code } }))
}

export function deviceApproveAccount(user_code: string) {
  return withDeviceFlowError(deviceFlowClient.oauth.device.approve.post({ body: { user_code } }))
}

export function deviceDenyAccount(user_code: string) {
  return withDeviceFlowError(deviceFlowClient.oauth.device.deny.post({ body: { user_code } }))
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
