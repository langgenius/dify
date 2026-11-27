import type { RequestErrorTranslator } from '../request-error-message'
import { createInstance } from 'i18next'
import { describe, expect, it } from 'vite-plus/test'
import requestErrors from '@/i18n/locales/en-US/request-errors.json'
import { createHttpError } from '../http-error'
import { describeRequestError, resolveRequestErrorMessage } from '../request-error-message'

const i18n = createInstance()
void i18n.init({
  lng: 'en-US',
  resources: { 'en-US': { requestErrors } },
  keySeparator: false,
  interpolation: { escapeValue: false },
})
const t = i18n.getFixedT('en-US', 'requestErrors') as RequestErrorTranslator

const httpError = (status: number, body?: unknown) =>
  createHttpError({ status, statusText: '', headers: new Headers() }, body)

describe('describeRequestError', () => {
  it('translates a cataloged code instead of showing the server message', () => {
    const error = httpError(409, {
      code: 'email_already_in_use',
      message: 'A user with this email already exists.',
      status: 409,
    })

    expect(resolveRequestErrorMessage(error, { t, fallback: 'Could not save' })).toEqual({
      message: requestErrors['code.email_already_in_use'],
      source: 'catalog',
    })
  })

  it('interpolates the details of a cataloged code', () => {
    const local = createInstance()
    void local.init({
      lng: 'en-US',
      resources: { 'en-US': { requestErrors: { 'code.app_unavailable': 'App {{name}} is down' } } },
      keySeparator: false,
      interpolation: { escapeValue: false },
    })
    const error = httpError(400, {
      code: 'app_unavailable',
      message: 'App unavailable',
      details: { name: 'Bot', nested: { ignored: true } },
    })

    expect(
      describeRequestError(error, {
        t: local.getFixedT('en-US', 'requestErrors') as RequestErrorTranslator,
      }),
    ).toBe('App Bot is down')
  })

  it("translates a code's fixed sentence with the values it carries", () => {
    const error = httpError(400, {
      code: 'file_extension_blocked',
      message: "File extension '.exe' is not allowed for security reasons",
    })

    expect(describeRequestError(error, { t, fallback: 'Upload failed' })).toBe(
      requestErrors['template.file_extension_blocked'].replace('{{extension}}', 'exe'),
    )
    expect(
      describeRequestError(
        httpError(429, {
          code: 'password_reset_rate_limit_exceeded',
          message: 'Too many password reset emails have been sent. Please try again in 5 minutes.',
        }),
        { t },
      ),
    ).toBe(requestErrors['template.password_reset_rate_limit_exceeded'].replace('{{minutes}}', '5'))
  })

  it('translates the evaluation concurrency limit with the limit from its details', () => {
    expect(
      describeRequestError(
        httpError(429, {
          code: 'evaluation_max_concurrent_runs',
          message: 'Maximum concurrent runs (3) reached.',
          details: { limit: 3 },
        }),
        { t, fallback: 'Run failed' },
      ),
    ).toBe(requestErrors['code.evaluation_max_concurrent_runs'].replace('{{limit}}', '3'))
  })

  it('falls back to the catalog entry or the server text when the sentence differs', () => {
    expect(
      describeRequestError(httpError(400, { code: 'file_extension_blocked', message: 'Blocked' }), {
        t,
        fallback: 'Upload failed',
      }),
    ).toBe(requestErrors['code.file_extension_blocked'])
    expect(
      describeRequestError(
        httpError(429, { code: 'password_reset_rate_limit_exceeded', message: 'Slow down' }),
        { t, fallback: 'Failed' },
      ),
    ).toBe('Slow down')
  })

  it('translates a known plan-limit text under the generic forbidden code', () => {
    const error = httpError(403, {
      code: 'forbidden',
      message: 'The number of documents has reached the limit of your subscription.',
    })

    expect(resolveRequestErrorMessage(error, { t, fallback: 'Upload failed' })).toEqual({
      message: requestErrors['planLimit.documents'],
      source: 'catalog',
    })
    const forbidden = (message?: string) =>
      describeRequestError(httpError(403, { code: 'forbidden', message }), {
        t,
        fallback: 'Upload failed',
      })
    // A known reason, a bare or default denial, and a call-specific text, each ahead of a fallback.
    expect(forbidden('Workspace policy prohibits ownership transfer')).toBe(
      requestErrors['forbidden.ownerTransferPolicy'],
    )
    expect(forbidden(undefined)).toBe(requestErrors['code.forbidden'])
    expect(
      forbidden(
        "You don't have the permission to access the requested resource. It is either read-protected or not readable by the server.",
      ),
    ).toBe(requestErrors['code.forbidden'])
    expect(forbidden('Only the app owner can archive logs')).toBe(
      'Only the app owner can archive logs',
    )
  })

  it('shows the server message of a passthrough code ahead of the fallback', () => {
    const error = httpError(400, {
      code: 'provider_not_initialize',
      message: 'Invalid API key for OpenAI',
    })

    expect(describeRequestError(error, { t, fallback: 'Could not run' })).toBe(
      'Invalid API key for OpenAI',
    )
  })

  it.each([
    ['a validation failure', 'invalid_param', 'Filename contains invalid characters'],
    ['a skill package limit', 'too_many_files', 'skill has more than 200 files'],
    ['a relayed skill error', 'missing_skill_description', 'SKILL.md needs a description'],
    ['a composer config reason', 'invalid_composer_config_error', 'Env var name 1A is invalid'],
  ])('shows the server message of %s ahead of the fallback', (_case, code, message) => {
    expect(
      resolveRequestErrorMessage(httpError(400, { code, message }), { t, fallback: 'Failed' }),
    ).toEqual({ message, source: 'server' })
  })

  it("prefers the caller's fallback over the server message of an uncataloged code", () => {
    const error = httpError(404, { code: 'not_found', message: 'Workflow not found' })

    expect(describeRequestError(error, { t, fallback: 'Could not open the workflow' })).toBe(
      'Could not open the workflow',
    )
  })

  it('shows the server message of an uncataloged code when the caller has no fallback', () => {
    const error = httpError(404, { code: 'not_found', message: 'Workflow not found' })

    expect(resolveRequestErrorMessage(error, { t })).toEqual({
      message: 'Workflow not found',
      source: 'server',
    })
  })

  it('falls back to generic text for the kind of failure', () => {
    expect(describeRequestError(new TypeError('Failed to fetch'), { t })).toBe(
      requestErrors['generic.network'],
    )
    expect(
      describeRequestError(new DOMException('The operation timed out.', 'TimeoutError'), { t }),
    ).toBe(requestErrors['generic.timeout'])
    expect(describeRequestError(httpError(429), { t })).toBe(requestErrors['generic.rateLimited'])
    expect(describeRequestError(httpError(502), { t })).toBe(requestErrors['generic.server'])
    expect(resolveRequestErrorMessage(httpError(400), { t })).toEqual({
      message: requestErrors['generic.unknown'],
      source: 'generic',
    })
  })

  it('uses the fallback when a request error has no message', () => {
    expect(describeRequestError(httpError(502), { t, fallback: 'Could not load' })).toBe(
      'Could not load',
    )
  })
})
