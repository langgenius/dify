import type { AfterResponseHook, BeforeRequestHook, Hooks } from 'ky'
import type { IOtherOptions } from './base'
import type { RequestGuard } from './request-guard'
import Cookies from 'js-cookie'
import ky from 'ky'
import {
  API_PREFIX,
  APP_VERSION,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  IS_MARKETPLACE,
  MARKETPLACE_API_PREFIX,
  PASSPORT_HEADER_NAME,
  PUBLIC_API_PREFIX,
  WEB_APP_SHARE_CODE_HEADER_NAME,
} from '@/config'
import { shouldSuppressAppDeletionErrorToast } from './app-deletion'
import { httpErrorFromResponse, isHttpErrorStatus } from './http-error'
import { clearRequestErrorToasts, notifyRequestError } from './request-error-toast'
import { captureRequestGuard } from './request-guard'
import { getWebAppPublicApiPath, resolveWebAppAddress } from './webapp-address'
import { getWebAppAccessToken, getWebAppPassport } from './webapp-auth'

const TIME_OUT = 100000

export const ContentType = {
  json: 'application/json',
  stream: 'text/event-stream',
  audio: 'audio/mpeg',
  form: 'application/x-www-form-urlencoded; charset=UTF-8',
  download: 'application/octet-stream', // for download
  downloadZip: 'application/zip', // for download
  upload: 'multipart/form-data', // for upload
}

export type FetchOptionType = Omit<RequestInit, 'body'> & {
  params?: Record<string, string | number | boolean | undefined>
  body?: BodyInit | Record<string, unknown> | null
}

const afterResponse204: AfterResponseHook = async ({ response }) => {
  if (response.status === 204) {
    return new Response(JSON.stringify({ result: 'success' }), {
      status: 200,
      headers: { 'Content-Type': ContentType.json },
    })
  }
}

const afterResponseErrorCode = (
  otherOptions: IOtherOptions,
  requestGuard: RequestGuard | undefined,
): AfterResponseHook => {
  return async ({ request, response }) => {
    if (isHttpErrorStatus(response.status)) {
      const error = await httpErrorFromResponse(response)
      const errorData = error.data
      const handled = requestGuard?.handleError(response.status, errorData, error)
      if (handled || requestGuard?.isActive() === false) throw error
      const shouldNotifyError =
        response.status >= 400 &&
        response.status !== 401 &&
        errorData &&
        !otherOptions.silent &&
        !shouldSuppressAppDeletionErrorToast(request.url, response.status)

      const errorMessage = [errorData?.message, errorData?.error].find(
        (value): value is string => typeof value === 'string' && !!value.trim(),
      )
      if (shouldNotifyError && errorMessage) notifyRequestError(request, errorMessage)

      if (response.status === 403 && errorData?.code === 'already_setup')
        globalThis.location.href = `${globalThis.location.origin}/signin`
      throw error
    } else {
      clearRequestErrorToasts(request)
    }
  }
}

const beforeRequestPublicWithCode: BeforeRequestHook = ({ request }) => {
  if (!request.headers.has('Authorization')) {
    const accessToken = getWebAppAccessToken()
    if (accessToken) request.headers.set('Authorization', `Bearer ${accessToken}`)
    else request.headers.delete('Authorization')
  }
  const address = resolveWebAppAddress()
  if (!address) return
  request.headers.set(WEB_APP_SHARE_CODE_HEADER_NAME, address.code)
  request.headers.set(PASSPORT_HEADER_NAME, getWebAppPassport(address))
}

const baseHooks: Hooks = {
  afterResponse: [afterResponse204],
}

const baseClient = ky.create({
  hooks: baseHooks,
  throwHttpErrors: isHttpErrorStatus,
  timeout: TIME_OUT,
})

export const getBaseOptions = (): RequestInit => ({
  method: 'GET',
  mode: 'cors',
  credentials: 'include', // always send cookies、HTTP Basic authentication.
  headers: new Headers({
    'Content-Type': ContentType.json,
  }),
  redirect: 'follow',
})

async function base<T>(
  url: string,
  options: FetchOptionType = {},
  otherOptions: IOtherOptions = {},
): Promise<T> {
  // In fetchCompat mode, skip baseOptions to avoid overriding Request object's method, headers,
  const baseOptions = otherOptions.fetchCompat
    ? ({
        mode: 'cors',
        credentials: 'include', // always send cookies、HTTP Basic authentication.
        redirect: 'follow',
      } as const)
    : ({
        mode: 'cors',
        credentials: 'include', // always send cookies、HTTP Basic authentication.
        headers: new Headers({
          'Content-Type': ContentType.json,
        }),
        method: 'GET',
        redirect: 'follow',
      } as const)
  const { params, body, headers: headersFromProps, ...init } = { ...baseOptions, ...options }

  const {
    isPublicAPI = false,
    isMarketplaceAPI = false,
    bodyStringify = true,
    needAllResponseContent,
    deleteContentType,
    getAbortController,
    fetchCompat = false,
    request,
  } = otherOptions
  const requestGuard = captureRequestGuard(url, isPublicAPI, request?.method || init.method)
  requestGuard?.beforeRequest()

  const headers = new Headers(headersFromProps || {})

  let base: string
  if (isMarketplaceAPI) base = MARKETPLACE_API_PREFIX
  else if (isPublicAPI) base = PUBLIC_API_PREFIX
  else base = API_PREFIX

  if (getAbortController) {
    const abortController = new AbortController()
    getAbortController(abortController)
    options.signal = abortController.signal
  }

  const fetchPathname = isPublicAPI
    ? base + getWebAppPublicApiPath(resolveWebAppAddress(), url)
    : base + (url.startsWith('/') ? url : `/${url}`)
  if (!isMarketplaceAPI) headers.set(CSRF_HEADER_NAME, Cookies.get(CSRF_COOKIE_NAME()) || '')

  if (deleteContentType) headers.delete('Content-Type')

  // ! For Marketplace API, help to filter tags added in new version
  if (isMarketplaceAPI) headers.set('X-Dify-Version', !IS_MARKETPLACE ? APP_VERSION : '999.0.0')

  const client = baseClient.extend({
    hooks: {
      ...baseHooks,
      beforeRequest: [
        ...(baseHooks.beforeRequest || []),
        isPublicAPI && beforeRequestPublicWithCode,
      ].filter((h): h is BeforeRequestHook => Boolean(h)),
      afterResponse: [
        ...(baseHooks.afterResponse || []),
        afterResponseErrorCode(otherOptions, requestGuard),
      ],
    },
  })

  const res = await client(request ? request.clone() : fetchPathname, {
    ...init,
    headers,
    credentials: isMarketplaceAPI ? 'omit' : options.credentials || 'include',
    retry: {
      methods: [],
    },
    ...(bodyStringify && !fetchCompat ? { json: body } : { body: body as BodyInit }),
    searchParams: !fetchCompat ? params : undefined,
    fetch(resource: RequestInfo | URL, options?: RequestInit) {
      if (resource instanceof Request && options) {
        const mergedHeaders = new Headers(options.headers || {})
        resource.headers.forEach((value, key) => {
          mergedHeaders.append(key, value)
        })
        options.headers = mergedHeaders
      }
      return globalThis.fetch(resource, options)
    },
  })

  if (needAllResponseContent || fetchCompat) return res as T
  const contentType = res.headers.get('content-type')
  if (
    contentType &&
    [ContentType.download, ContentType.audio, ContentType.downloadZip].includes(contentType)
  ) {
    return (await res.blob()) as T
  }

  return (await res.json()) as T
}

/**
 * Fire-and-forget POST with `keepalive: true` for use during page unload.
 * Includes credentials, Authorization (if available), and CSRF header
 * so the request is authenticated, matching the headers sent by the
 * standard `base()` fetch wrapper.
 */
export function postWithKeepalive(url: string, body: Record<string, unknown>): void {
  const headers = new Headers({
    'Content-Type': ContentType.json,
    [CSRF_HEADER_NAME]: Cookies.get(CSRF_COOKIE_NAME()) || '',
  })

  // Add Authorization header if an access token is available
  const accessToken = getWebAppAccessToken()
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)

  globalThis
    .fetch(url, {
      method: 'POST',
      keepalive: true,
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
    })
    .catch(() => {})
}

export { base }
