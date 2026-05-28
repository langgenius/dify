import type { KyInstance } from 'ky'
import { BaseError } from '../errors/base.js'
import { ErrorCode } from '../errors/codes.js'

export const DEFAULT_CLIENT_ID = 'difyctl'

export type CodeRequest = {
  client_id?: string
  device_label: string
}

export type CodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
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
  account?: PollAccount
  workspaces?: readonly PollWorkspace[]
  default_workspace_id?: string
  token_id?: string
}

export type PollResult
  = | { status: 'pending' }
    | { status: 'slow_down' }
    | { status: 'expired' }
    | { status: 'denied' }
    | { status: 'retry_5xx' }
    | { status: 'approved', success: PollSuccess }

const POLL_ERROR_TO_STATUS: Record<string, PollResult['status']> = {
  authorization_pending: 'pending',
  slow_down: 'slow_down',
  expired_token: 'expired',
  access_denied: 'denied',
}

export class DeviceFlowApi {
  private readonly http: KyInstance

  constructor(http: KyInstance) {
    this.http = http
  }

  async requestCode(req: CodeRequest): Promise<CodeResponse> {
    if (req.device_label === '') {
      throw new BaseError({
        code: ErrorCode.UsageMissingArg,
        message: 'device_label is required',
      })
    }
    const body = { client_id: req.client_id ?? DEFAULT_CLIENT_ID, device_label: req.device_label }
    const res = await this.http.post('oauth/device/code', { json: body, throwHttpErrors: false, context: { skipClassify: true } })
    if (res.status === 404)
      throw versionSkew()
    if (!res.ok) {
      throw new BaseError({
        code: ErrorCode.Server4xxOther,
        message: `device/code: HTTP ${res.status}`,
        httpStatus: res.status,
      })
    }
    return await res.json() as CodeResponse
  }

  async pollOnce(req: PollRequest): Promise<PollResult> {
    if (req.device_code === '') {
      throw new BaseError({
        code: ErrorCode.UsageMissingArg,
        message: 'device_code is required',
      })
    }
    const body = { client_id: req.client_id ?? DEFAULT_CLIENT_ID, device_code: req.device_code }
    const res = await this.http.post('oauth/device/token', { json: body, throwHttpErrors: false, context: { skipClassify: true } })
    if (res.status === 404)
      throw versionSkew()
    if (res.status >= 500)
      return { status: 'retry_5xx' }
    let payload: { error?: string } & Partial<PollSuccess> = {}
    try {
      const text = await res.text()
      payload = text === '' ? {} : JSON.parse(text) as typeof payload
    }
    catch (err) {
      throw new BaseError({
        code: ErrorCode.Unknown,
        message: `decode poll response: ${(err as Error).message}`,
      })
    }
    if (typeof payload.error === 'string' && payload.error !== '') {
      const status = POLL_ERROR_TO_STATUS[payload.error]
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
}

function versionSkew(): BaseError {
  return new BaseError({
    code: ErrorCode.UnsupportedEndpoint,
    message: 'this Dify host does not implement the OAuth device flow',
    httpStatus: 404,
  })
}
