import type { TFunction } from 'i18next'
import type { CatalogedRequestErrorCode, TemplatedRequestErrorCode } from './request-error-codes'
import { ORPCError } from '@orpc/client'
import { getHttpErrorStatus, getRequestErrorMessage } from './http-error'
import {
  catalogedRequestErrorCodes,
  defaultForbiddenDescription,
  forbiddenMessages,
  passthroughRequestErrorCodes,
  planLimitMessages,
  requestErrorTemplates,
} from './request-error-codes'

export type RequestErrorTranslator = TFunction<['requestErrors']>

/** Where a resolved message came from, for owners that treat a generic message differently. */
type RequestErrorMessageSource = 'catalog' | 'server' | 'fallback' | 'generic'

export type ResolvedRequestErrorMessage = {
  message: string
  source: RequestErrorMessageSource
}

type DescribeRequestErrorOptions = {
  t: RequestErrorTranslator
  /** The caller's translated text for what failed, such as "Failed to delete the app". */
  fallback?: string
}

const cataloged = new Set<string>(catalogedRequestErrorCodes)
const passthrough = new Set<string>(passthroughRequestErrorCodes)

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

/** The backend envelope's `code`; an error without a body has none. */
function getRequestErrorCode(error: unknown): string | undefined {
  if (!(error instanceof ORPCError)) return undefined
  const code = asRecord(error.data)?.code
  return typeof code === 'string' && code ? code : undefined
}

/** Interpolation values from the envelope: `details` entries and the `params` field name. */
function getInterpolationValues(error: ORPCError<string, unknown>) {
  const data = asRecord(error.data)
  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(asRecord(data?.details) ?? {}))
    if (typeof value === 'string' || typeof value === 'number') values[key] = String(value)
  if (typeof data?.params === 'string') values.params = data.params
  return values
}

/** A plan-limit check's limit, recognized by its fixed text under the generic `forbidden` code. */
function getPlanLimit(code: string | undefined, message: string | undefined) {
  if (code !== 'forbidden' || !message) return undefined
  return Object.hasOwn(planLimitMessages, message)
    ? planLimitMessages[message as keyof typeof planLimitMessages]
    : undefined
}

type TemplateValues = Record<string, string>

// One call per template so each key and its placeholders stay visible to the typed `t` and to
// the build's unused-translation check.
const templateMessages: Record<
  TemplatedRequestErrorCode,
  (t: RequestErrorTranslator, values: TemplateValues) => string
> = {
  dataset_name_duplicate: (t, { name = '' }) =>
    t(($) => $['template.dataset_name_duplicate'], { name }),
  email_change_rate_limit_exceeded: (t, { minutes = '' }) =>
    t(($) => $['template.email_change_rate_limit_exceeded'], { minutes }),
  email_code_account_deletion_rate_limit_exceeded: (t, { minutes = '' }) =>
    t(($) => $['template.email_code_account_deletion_rate_limit_exceeded'], { minutes }),
  email_code_login_rate_limit_exceeded: (t, { minutes = '' }) =>
    t(($) => $['template.email_code_login_rate_limit_exceeded'], { minutes }),
  email_register_rate_limit_exceeded: (t, { minutes = '' }) =>
    t(($) => $['template.email_register_rate_limit_exceeded'], { minutes }),
  file_extension_blocked: (t, { extension = '' }) =>
    t(($) => $['template.file_extension_blocked'], { extension }),
  invalid_metadata: (t, { value = '' }) => t(($) => $['template.invalid_metadata'], { value }),
  network_access_unsupported_access_points: (t, { accessPoints = '' }) =>
    t(($) => $['template.network_access_unsupported_access_points'], { accessPoints }),
  network_access_unsupported_app_mode: (t, { mode = '' }) =>
    t(($) => $['template.network_access_unsupported_app_mode'], { mode }),
  owner_transfer_rate_limit_exceeded: (t, { minutes = '' }) =>
    t(($) => $['template.owner_transfer_rate_limit_exceeded'], { minutes }),
  password_reset_rate_limit_exceeded: (t, { minutes = '' }) =>
    t(($) => $['template.password_reset_rate_limit_exceeded'], { minutes }),
}

/** The values a code's fixed sentence carries, when the server's text is that sentence. */
function getTemplateValues(code: string | undefined, message: string | undefined) {
  if (!code || !message || !Object.hasOwn(requestErrorTemplates, code)) return undefined
  const groups = requestErrorTemplates[code as TemplatedRequestErrorCode].exec(message)?.groups
  const values: TemplateValues = { ...groups }
  return groups ? { code: code as TemplatedRequestErrorCode, values } : undefined
}

/**
 * `forbidden` carries its reason in the text: a known plan limit or fixed reason is translated,
 * a bare or default denial gets the generic permission text, and any other text is shown as is.
 */
function resolveForbidden(
  serverMessage: string | undefined,
  t: RequestErrorTranslator,
): ResolvedRequestErrorMessage {
  const planLimit = getPlanLimit('forbidden', serverMessage)
  if (planLimit) return { message: t(($) => $[`planLimit.${planLimit}`]), source: 'catalog' }
  if (serverMessage && Object.hasOwn(forbiddenMessages, serverMessage)) {
    const reason = forbiddenMessages[serverMessage as keyof typeof forbiddenMessages]
    return { message: t(($) => $[`forbidden.${reason}`]), source: 'catalog' }
  }
  if (serverMessage && serverMessage !== defaultForbiddenDescription)
    return { message: serverMessage, source: 'server' }
  return { message: t(($) => $['code.forbidden']), source: 'catalog' }
}

// Cataloged codes whose text needs values from the error's `details`, one call per key like the
// templates so the typed `t` sees each placeholder.
const detailedMessages = {
  evaluation_max_concurrent_runs: (t: RequestErrorTranslator, { limit = '' }: TemplateValues) =>
    t(($) => $['code.evaluation_max_concurrent_runs'], { limit }),
} satisfies Partial<
  Record<CatalogedRequestErrorCode, (t: RequestErrorTranslator, values: TemplateValues) => string>
>
type DetailedRequestErrorCode = keyof typeof detailedMessages

const isDetailedCode = (code: string): code is DetailedRequestErrorCode =>
  Object.hasOwn(detailedMessages, code)

const isCatalogedCode = (
  code: string | undefined,
): code is
  | Exclude<CatalogedRequestErrorCode, DetailedRequestErrorCode>
  | DetailedRequestErrorCode => code !== undefined && cataloged.has(code)

function genericMessage(error: unknown, t: RequestErrorTranslator) {
  if (error instanceof DOMException && error.name === 'TimeoutError')
    return t(($) => $['generic.timeout'])
  if (error instanceof Error && error.name === 'TimeoutError') return t(($) => $['generic.timeout'])
  if (error instanceof TypeError) return t(($) => $['generic.network'])
  const status = getHttpErrorStatus(error)
  if (status === 429) return t(($) => $['generic.rateLimited'])
  if (status !== undefined && status >= 500) return t(($) => $['generic.server'])
  return t(($) => $['generic.unknown'])
}

/**
 * Resolves the text shown for a failed request, in order: the translated catalog entry for the
 * error's fixed sentence with its values, for a known reason under `forbidden` (see
 * `resolveForbidden`), or for its `code`; the server's message when the code carries upstream detail; the caller's
 * translated fallback; the server's message for a code the catalog does not know (such as a
 * framework `not_found`); a generic translated message for the kind of failure.
 */
export function resolveRequestErrorMessage(
  error: unknown,
  { t, fallback }: DescribeRequestErrorOptions,
): ResolvedRequestErrorMessage {
  const code = getRequestErrorCode(error)
  const template = getTemplateValues(code, getRequestErrorMessage(error))
  if (template) {
    return {
      message: templateMessages[template.code](t, template.values),
      source: 'catalog',
    }
  }
  const serverMessage = getRequestErrorMessage(error)
  if (code === 'forbidden') return resolveForbidden(serverMessage, t)
  if (isCatalogedCode(code) && error instanceof ORPCError) {
    const values = getInterpolationValues(error)
    if (isDetailedCode(code))
      return { message: detailedMessages[code](t, values), source: 'catalog' }
    return {
      message: t(($) => $[`code.${code}`], { ...values }),
      source: 'catalog',
    }
  }
  if (serverMessage && code !== undefined && passthrough.has(code))
    return { message: serverMessage, source: 'server' }
  if (fallback) return { message: fallback, source: 'fallback' }
  if (serverMessage) return { message: serverMessage, source: 'server' }
  return { message: genericMessage(error, t), source: 'generic' }
}

/**
 * Whether the error itself says what failed: a cataloged code, a known plan-limit text or a server
 * message. Without one, only the caller's fallback or generic text describes it.
 */
export function isExplainedRequestError(error: unknown) {
  const code = getRequestErrorCode(error)
  const serverMessage = getRequestErrorMessage(error)
  return (
    isCatalogedCode(code) ||
    getTemplateValues(code, serverMessage) !== undefined ||
    getPlanLimit(code, serverMessage) !== undefined ||
    !!serverMessage
  )
}

/** The text shown for a failed request; see `resolveRequestErrorMessage` for the order. */
export function describeRequestError(error: unknown, options: DescribeRequestErrorOptions) {
  return resolveRequestErrorMessage(error, options).message
}
