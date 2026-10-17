import type { ClientLink, StandardLazyResponse } from '@orpc/client'
import type { StandardLinkTransportInterceptorOptions } from '@orpc/client/standard'
import type { RouterContract } from '@orpc/contract'
import type { ConsoleClientContext } from './index'
import type { HttpError } from '@/service/http-error'
import { onError } from '@orpc/client'
import { TimeoutLinkPlugin } from '@orpc/client/plugins'
import Cookies from 'js-cookie'
import { API_PREFIX, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'
// oxlint-disable-next-line no-restricted-imports -- Console auth recovery is shared with the legacy request helpers.
import { recoverFromAuthError } from '../base'
import {
  httpErrorFromStandardResponse,
  isHttpErrorStatus,
  resolveHttpErrorBody,
} from '../http-error'
import { clearRequestErrorToasts, reportHttpError } from '../request-error-toast'
import { createConsoleContractLink } from './contract-loader'
import { validateDefinedErrors } from './defined-errors'
import { ConsoleOpenAPILink } from './openapi-link'
import { toOpenAPILinkBase } from './openapi-url'

const REQUEST_TIMEOUT_MS = 100_000

// The console API answers some writes with 204; callers read `{ result: 'success' }`.
const noContentResponse = (): StandardLazyResponse => ({
  status: 200,
  headers: { 'content-type': 'application/json' },
  resolveBody: async () => ({ result: 'success' }),
})

/**
 * Reports backend errors as toasts and recovers from 401s: after a token refresh the request is
 * sent once more, otherwise the user is sent to sign-in or web SSO. Error responses are passed on
 * so `customErrorResponseBodyDecoder` turns them into `HttpError`s.
 */
const consoleTransportInterceptor =
  (origin: () => string) =>
  async ({
    next,
    request,
    context,
  }: StandardLinkTransportInterceptorOptions<ConsoleClientContext> & {
    next: () => Promise<StandardLazyResponse>
  }): Promise<StandardLazyResponse> => {
    const identity = { method: request.method, url: `${origin()}${request.url}` }

    const send = async (): Promise<{ response: StandardLazyResponse; error?: HttpError }> => {
      const response = await next()
      if (!isHttpErrorStatus(response.status)) {
        clearRequestErrorToasts(identity)
        return { response: response.status === 204 ? noContentResponse() : response }
      }
      const error = httpErrorFromStandardResponse(await response.resolveBody(), response)
      reportHttpError(identity, error, context.silent)
      return { response, error }
    }

    const first = await send()
    if (first.error?.status !== 401) return first.response

    const recovery = await recoverFromAuthError(first.error, identity.url, {
      silent: context.silent,
    })
    if (recovery.retry) return (await send()).response
    if (recovery.error !== first.error) throw recovery.error
    return first.response
  }

function createBrowserLink(contract: RouterContract): ClientLink<ConsoleClientContext> {
  const linkBase = () => toOpenAPILinkBase(new URL(API_PREFIX, window.location.origin))
  const origin = () => linkBase().origin ?? window.location.origin
  return new ConsoleOpenAPILink<ConsoleClientContext>(contract, {
    origin,
    url: () => linkBase().url,
    fetch: (url, init, { context }) => {
      // A token refresh also rotates the CSRF cookie; read it again for transport retries.
      const headers = new Headers(init.headers)
      headers.set(CSRF_HEADER_NAME, Cookies.get(CSRF_COOKIE_NAME()) || '')
      return globalThis.fetch(url, {
        ...init,
        headers,
        mode: 'cors',
        credentials: 'include',
        ...(context.keepalive ? { keepalive: true } : {}),
      })
    },
    customErrorResponseBodyDecoder: httpErrorFromStandardResponse,
    transportInterceptors: [consoleTransportInterceptor(origin), resolveHttpErrorBody],
    interceptors: [validateDefinedErrors(contract), onError((error) => console.error(error))],
    plugins: [new TimeoutLinkPlugin({ timeout: REQUEST_TIMEOUT_MS })],
  })
}

export const consoleBrowserLink = createConsoleContractLink(createBrowserLink)
