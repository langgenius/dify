import type { HumanInputV2ErrorCategory } from './types'

const CATEGORY_BY_CODE: Record<string, HumanInputV2ErrorCategory> = {
  human_input_form_not_found: 'not-found',
  human_input_form_expired: 'form-expired',
  human_input_form_submitted: 'already-submitted',
  web_form_rate_limit_exceeded: 'form-rate-limit',
  human_input_access_rate_limit_exceeded: 'access-rate-limit',
  human_input_access_delivery_failed: 'access-delivery-failed',
  human_input_invalid_otp: 'invalid-otp',
  human_input_challenge_expired: 'challenge-expired',
  human_input_challenge_stale: 'challenge-stale',
  human_input_upload_failed: 'upload-failed',
  human_input_v2_unavailable: 'unavailable',
}

const SAFE_MESSAGE_BY_CATEGORY: Record<HumanInputV2ErrorCategory, string> = {
  'not-found': 'Human Input form not found',
  'form-expired': 'Human Input form expired',
  'already-submitted': 'Human Input form already submitted',
  'form-rate-limit': 'Human Input form rate limited',
  'access-rate-limit': 'Human Input access request rate limited',
  'access-delivery-failed': 'Human Input access delivery failed',
  'invalid-otp': 'Human Input verification code is invalid',
  'challenge-expired': 'Human Input challenge expired',
  'challenge-stale': 'Human Input challenge is stale',
  'upload-failed': 'Human Input file upload failed',
  network: 'Human Input request failed because the network is unavailable',
  unavailable: 'Human Input v2 service is unavailable',
  unknown: 'Human Input request failed',
}

export class HumanInputV2TransportError extends Error {
  category: HumanInputV2ErrorCategory
  code: string
  status?: number

  constructor(category: HumanInputV2ErrorCategory, code: string, status?: number) {
    super(SAFE_MESSAGE_BY_CATEGORY[category])
    this.name = 'HumanInputV2TransportError'
    this.category = category
    this.code = code
    this.status = status
  }
}

type ErrorLike = {
  code?: unknown
  status?: unknown
  name?: unknown
}

export const createHumanInputV2Error = (
  category: HumanInputV2ErrorCategory,
  code = `human_input_${category.replaceAll('-', '_')}`,
  status?: number,
) => new HumanInputV2TransportError(category, code, status)

export const normalizeHumanInputV2Error = (error: unknown): HumanInputV2TransportError => {
  if (error instanceof HumanInputV2TransportError) return error

  const candidate = error as ErrorLike | null
  const code = typeof candidate?.code === 'string' ? candidate.code : 'human_input_unknown'
  const status = typeof candidate?.status === 'number' ? candidate.status : undefined
  const category =
    CATEGORY_BY_CODE[code] ??
    (candidate?.name === 'AbortError' ? 'network' : undefined) ??
    (status === 404 ? 'not-found' : undefined) ??
    (status === 429 ? 'form-rate-limit' : undefined) ??
    'unknown'

  return new HumanInputV2TransportError(category, code, status)
}

export const isTerminalFormError = (category: HumanInputV2ErrorCategory) =>
  ['not-found', 'form-expired', 'already-submitted', 'form-rate-limit'].includes(category)
