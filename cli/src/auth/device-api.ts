import type { Dispatcher } from 'undici'
import { BaseError, HttpClientError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { buildFetchInit } from '@/net/fetch-init'
import { proxyDispatcher } from '@/net/proxy'

export const DEFAULT_CLIENT_ID = 'difyctl'

export type CodeRequest = {
  client_id?: string
  device_label: string
}

export type CodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval: number
}

export type PollRequest = {
  client_id?: string
  device_code: string
}

export type PollAccount = {
  id: string
  email: string
  name: string
}

export type PollWorkspace = {
  id: string
  name: string
  role: string
}

export type PollSuccess = {
  token: string
  expires_at?: string
  subject_type?: string
  subject_email?: string
  subject_issuer?: string
  account?: PollAccount | null
  workspaces?: readonly PollWorkspace[]
  default_workspace_id?: string
  token_id?: string
}

export type PollResult =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'retry_5xx' }
  | { status: 'approved'; success: PollSuccess }

export type DeviceApi = {
  readonly requestCode: (req: CodeRequest) => Promise<CodeResponse>
  readonly pollOnce: (req: PollRequest) => Promise<PollResult>
}

export type DeviceApiOptions = Readonly<{ insecure: boolean }>

const DEVICE_CODE_PATH = '/openapi/v1/oauth/device/code'
const DEVICE_TOKEN_PATH = '/openapi/v1/oauth/device/token'
const TOKEN_PATH = '/openapi/v1/oauth/token'
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
const UNSUPPORTED_CLIENT_MESSAGE = 'this Dify host does not accept the difyctl client'
const MS_PER_SECOND = 1000
const DEVICE_FLOW_UNSUPPORTED_MESSAGE = 'this Dify host does not implement the OAuth device flow'

const HttpStatus = { NotFound: 404, ServerErrorFloor: 500 } as const

// RFC 8628 error codes, mapped to the states awaitAuthorization polls on.
const POLL_ERROR_STATUS: Readonly<Record<string, PollResult['status']>> = {
  authorization_pending: 'pending',
  slow_down: 'slow_down',
  expired_token: 'expired',
  access_denied: 'denied',
}

// Errors that mean the host refuses this client; they all surface as one error.
const UNSUPPORTED_CLIENT_ERRORS: ReadonlySet<string> = new Set([
  'invalid_client',
  'unsupported_client',
])

type PollPayload = { error?: string } & Partial<PollSuccess>
type StandardPollPayload = Omit<PollPayload, 'token' | 'expires_at'> & {
  access_token?: string
  token_type?: string
  expires_in?: number
}

type PollRoute = 'standard' | 'legacy'

type PollRouteSpec = {
  readonly path: string
  readonly encode: (req: PollRequest) => { contentType: string; body: string }
  readonly normalize: (payload: PollPayload) => PollPayload
  // The route to retry on when this one answers 404; absent means the host has no device flow.
  readonly fallback?: PollRoute
}

function standardPollBody(req: PollRequest): { contentType: string; body: string } {
  return {
    contentType: 'application/x-www-form-urlencoded',
    body: new URLSearchParams({
      grant_type: DEVICE_GRANT_TYPE,
      device_code: req.device_code,
      client_id: req.client_id ?? DEFAULT_CLIENT_ID,
    }).toString(),
  }
}

function legacyPollBody(req: PollRequest): { contentType: string; body: string } {
  return {
    contentType: 'application/json',
    body: JSON.stringify({
      client_id: req.client_id ?? DEFAULT_CLIENT_ID,
      device_code: req.device_code,
    }),
  }
}

function normalizeStandardPoll(raw: PollPayload): PollPayload {
  const { access_token, expires_in, token_type: _tokenType, ...rest } = raw as StandardPollPayload
  if (typeof access_token !== 'string' || access_token === '') return { error: rest.error }
  const success: PollPayload = { ...rest, token: access_token }
  if (typeof expires_in === 'number')
    success.expires_at = new Date(Date.now() + expires_in * MS_PER_SECOND).toISOString()
  return success
}

const POLL_ROUTES: Readonly<Record<PollRoute, PollRouteSpec>> = {
  standard: {
    path: TOKEN_PATH,
    encode: standardPollBody,
    normalize: normalizeStandardPoll,
    fallback: 'legacy',
  },
  legacy: {
    path: DEVICE_TOKEN_PATH,
    encode: legacyPollBody,
    normalize: (payload) => payload,
  },
}

const CODE_RESPONSE_REQUIRED_FIELDS = ['device_code', 'user_code', 'verification_uri'] as const

function parseCodeResponse(text: string): CodeResponse {
  let payload: Record<string, unknown>
  try {
    payload = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>)
  } catch (cause) {
    throw new BaseError({
      code: ErrorCode.ServerError,
      message: 'device/code response is not valid JSON',
      cause,
    })
  }
  if (
    typeof payload.verification_uri_complete !== 'string' ||
    payload.verification_uri_complete === ''
  )
    delete payload.verification_uri_complete
  const missing = CODE_RESPONSE_REQUIRED_FIELDS.filter(
    (field) => typeof payload[field] !== 'string' || payload[field] === '',
  )
  if (missing.length > 0) {
    throw new BaseError({
      code: ErrorCode.ServerError,
      message: `device/code response missing ${missing.join(', ')}`,
    })
  }
  return payload as unknown as CodeResponse
}

function unsupportedDeviceFlow(method: string, url: URL): HttpClientError {
  return new HttpClientError({
    code: ErrorCode.ServerError,
    message: DEVICE_FLOW_UNSUPPORTED_MESSAGE,
    httpStatus: HttpStatus.NotFound,
    method,
    url: url.toString(),
  })
}

async function nonOkError(method: string, url: URL, res: Response): Promise<HttpClientError> {
  const rawResponse = await res.text()
  return new HttpClientError({
    code: ErrorCode.ServerError,
    message: `${method} ${url.pathname} failed: HTTP ${res.status}`,
    httpStatus: res.status,
    method,
    url: url.toString(),
    rawResponse,
  })
}

function parsePollPayload(text: string): PollPayload {
  if (text === '') return {}
  try {
    return JSON.parse(text) as PollPayload
  } catch (cause) {
    throw new BaseError({
      code: ErrorCode.Unknown,
      message: `decode poll response: ${(cause as Error).message}`,
      cause,
    })
  }
}

export function deviceApi(server: string, opts: DeviceApiOptions): DeviceApi {
  const dispatcher: Dispatcher | undefined = opts.insecure
    ? proxyDispatcher({ insecure: true })
    : proxyDispatcher()

  let pollRoute: PollRoute = 'standard'

  async function post(
    path: string,
    payload: { contentType: string; body: string },
  ): Promise<{ url: URL; res: Response }> {
    const url = new URL(path, server)
    const init = buildFetchInit(
      {
        method: 'POST',
        headers: { 'Content-Type': payload.contentType, Accept: 'application/json' },
        body: payload.body,
      },
      { insecure: opts.insecure, dispatcher },
    )
    try {
      return { url, res: await fetch(url, init) }
    } catch (cause) {
      throw new BaseError({
        code: ErrorCode.NetworkConnection,
        message: `network error calling POST ${url}`,
        cause,
      })
    }
  }

  return {
    requestCode: async (req) => {
      const { url, res } = await post(DEVICE_CODE_PATH, {
        contentType: 'application/json',
        body: JSON.stringify({
          client_id: req.client_id ?? DEFAULT_CLIENT_ID,
          device_label: req.device_label,
        }),
      })
      if (res.status === HttpStatus.NotFound) throw unsupportedDeviceFlow('POST', url)
      if (!res.ok) throw await nonOkError('POST', url, res)
      return parseCodeResponse(await res.text())
    },
    pollOnce: async (req) => {
      for (;;) {
        const spec = POLL_ROUTES[pollRoute]
        const { url, res } = await post(spec.path, spec.encode(req))
        if (res.status === HttpStatus.NotFound) {
          if (spec.fallback === undefined) throw unsupportedDeviceFlow('POST', url)
          pollRoute = spec.fallback
          continue
        }
        if (res.status >= HttpStatus.ServerErrorFloor) return { status: 'retry_5xx' }

        const payload = spec.normalize(parsePollPayload(await res.text()))
        if (typeof payload.error === 'string' && payload.error !== '') {
          if (UNSUPPORTED_CLIENT_ERRORS.has(payload.error))
            throw new BaseError({ code: ErrorCode.Unknown, message: UNSUPPORTED_CLIENT_MESSAGE })
          const status = POLL_ERROR_STATUS[payload.error]
          if (status === undefined) {
            throw new BaseError({
              code: ErrorCode.Unknown,
              message: `unknown poll error "${payload.error}"`,
            })
          }
          return { status } as PollResult
        }
        if (typeof payload.token !== 'string' || payload.token === '') {
          throw new BaseError({
            code: ErrorCode.Unknown,
            message: `poll: ${res.status} with no OAuth envelope`,
          })
        }
        return { status: 'approved', success: payload as PollSuccess }
      }
    },
  }
}
