// Web-side calls into the OpenAPI authorization-code consent endpoints under
// /openapi/v1/oauth/authorize/*. The lookup is public; approve and deny need
// the console session cookie + CSRF token, like the device flow.

import type {
  OAuthAuthorizeClientResponse,
  OAuthAuthorizeRedirectResponse,
  OAuthAuthorizeRequest,
} from '@dify/contracts/api/openapi/types.gen'
import { queryOptions } from '@tanstack/react-query'
import { consoleCsrfHeader } from './device-flow'

const AUTHORIZE_BASE = '/openapi/v1/oauth/authorize'

export class OAuthAuthorizeError extends Error {
  code: string
  status: number

  constructor(code: string, status: number) {
    super(code)
    this.name = 'OAuthAuthorizeError'
    this.code = code
    this.status = status
  }
}

async function failFromResponse(res: Response): Promise<never> {
  let code = `http_${res.status}`
  try {
    const body = await res.clone().json()
    if (body && typeof body.error === 'string') code = body.error
  } catch {
    /* non-JSON body: keep the status-based code */
  }
  throw new OAuthAuthorizeError(code, res.status)
}

function sendAuthorize(path: string, init: RequestInit): Promise<Response> {
  // oxlint-disable-next-line no-restricted-globals -- /openapi/v1 has no generated console contract; same special transport as device-flow.ts.
  return fetch(`${AUTHORIZE_BASE}${path}`, init)
}

export async function fetchAuthorizeClient(
  clientId: string,
  redirectUri: string,
): Promise<OAuthAuthorizeClientResponse> {
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri })
  const res = await sendAuthorize(`/client?${query.toString()}`, { method: 'GET' })
  if (!res.ok) await failFromResponse(res)
  return res.json()
}

async function postDecision(
  decision: 'approve' | 'deny',
  body: OAuthAuthorizeRequest,
): Promise<OAuthAuthorizeRedirectResponse> {
  const res = await sendAuthorize(`/${decision}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...consoleCsrfHeader(),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) await failFromResponse(res)
  return res.json()
}

export function approveAuthorize(
  body: OAuthAuthorizeRequest,
): Promise<OAuthAuthorizeRedirectResponse> {
  return postDecision('approve', body)
}

export function denyAuthorize(
  body: OAuthAuthorizeRequest,
): Promise<OAuthAuthorizeRedirectResponse> {
  return postDecision('deny', body)
}

export function authorizeClientQueryOptions(
  clientId: string,
  redirectUri: string,
  enabled: boolean,
) {
  return queryOptions({
    queryKey: ['oauth-authorize-client', clientId, redirectUri],
    queryFn: () => fetchAuthorizeClient(clientId, redirectUri),
    enabled,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}
