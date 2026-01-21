import type { AfterResponseHook, BeforeErrorHook, BeforeRequestHook, Hooks } from 'ky'
import type { IOtherOptions } from './base'
import Cookies from 'js-cookie'
import ky from 'ky'
import Toast from '@/app/components/base/toast'
import { API_PREFIX, APP_VERSION, CSRF_COOKIE_NAME, CSRF_HEADER_NAME, IS_MARKETPLACE, MARKETPLACE_API_PREFIX, PASSPORT_HEADER_NAME, PUBLIC_API_PREFIX, WEB_APP_SHARE_CODE_HEADER_NAME } from '@/config'
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
  params?: Record<string, any>
  body?: BodyInit | Record<string, any> | null
}

const afterResponse204: AfterResponseHook = async (_request, _options, response) => {
  if (response.status === 204) {
    return new Response(JSON.stringify({ result: 'success' }), {
      status: 200,
      headers: { 'Content-Type': ContentType.json },
    })
  }
}

export type ResponseError = {
  code: string
  message: string
  status: number
}

const afterResponseErrorCode = (otherOptions: IOtherOptions): AfterResponseHook => {
  return async (_request, _options, response) => {
    const clonedResponse = response.clone()
    if (!/^([23])\d{2}$/.test(String(clonedResponse.status))) {
      const bodyJson = clonedResponse.json() as Promise<ResponseError>
      switch (clonedResponse.status) {
        case 403:
          bodyJson.then((data: ResponseError) => {
            if (!otherOptions.silent)
              Toast.notify({ type: 'error', message: data.message })
            if (data.code === 'already_setup')
              globalThis.location.href = `${globalThis.location.origin}/signin`
          })
          break
        case 401:
          return Promise.reject(response)
        // fall through
        default:
          bodyJson.then((data: ResponseError) => {
            if (!otherOptions.silent)
              Toast.notify({ type: 'error', message: data.message })
          })
          return Promise.reject(response)
      }
    }
  }
}

const beforeErrorToast = (otherOptions: IOtherOptions): BeforeErrorHook => {
  return (error) => {
    if (!otherOptions.silent)
      Toast.notify({ type: 'error', message: error.message })
    return error
  }
}

const SHARE_ROUTE_DENY_LIST = new Set(['webapp-signin', 'check-code', 'login'])

const resolveShareCode = () => {
  const pathnameSegments = globalThis.location.pathname.split('/').filter(Boolean)
  const lastSegment = pathnameSegments.at(-1) || ''
  if (lastSegment && !SHARE_ROUTE_DENY_LIST.has(lastSegment))
    return lastSegment

  const redirectParam = new URLSearchParams(globalThis.location.search).get('redirect_url')
  if (!redirectParam)
    return ''
  try {
    const redirectUrl = new URL(decodeURIComponent(redirectParam), globalThis.location.origin)
    const redirectSegments = redirectUrl.pathname.split('/').filter(Boolean)
    const redirectSegment = redirectSegments.at(-1) || ''
    return SHARE_ROUTE_DENY_LIST.has(redirectSegment) ? '' : redirectSegment
  }
  catch {
    return ''
  }
}

const beforeRequestPublicWithCode = (request: Request) => {
  const accessToken = getWebAppAccessToken()
  if (accessToken)
    request.headers.set('Authorization', `Bearer ${accessToken}`)
  else
    request.headers.delete('Authorization')
  const shareCode = resolveShareCode()
  if (!shareCode)
    return
  request.headers.set(WEB_APP_SHARE_CODE_HEADER_NAME, shareCode)
  request.headers.set(PASSPORT_HEADER_NAME, getWebAppPassport(shareCode))
}

const baseHooks: Hooks = {
  afterResponse: [
    afterResponse204,
  ],
}

const baseClient = ky.create({
  hooks: baseHooks,
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

async function base<T>(url: string, options: FetchOptionType = {}, otherOptions: IOtherOptions = {}): Promise<T> {
  // In fetchCompat mode, skip baseOptions to avoid overriding Request object's method, headers,
  const baseOptions = otherOptions.fetchCompat
    ? {
        mode: 'cors',
        credentials: 'include', // always send cookies、HTTP Basic authentication.
        redirect: 'follow',
      }
    : {
        mode: 'cors',
        credentials: 'include', // always send cookies、HTTP Basic authentication.
        headers: new Headers({
          'Content-Type': ContentType.json,
        }),
        method: 'GET',
        redirect: 'follow',
      }
  const { params, body, headers: headersFromProps, ...init } = Object.assign({}, baseOptions, options)
  const headers = new Headers(headersFromProps || {})

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

  let base: string
  if (isMarketplaceAPI)
    base = MARKETPLACE_API_PREFIX
  else if (isPublicAPI)
    base = PUBLIC_API_PREFIX
  else
    base = API_PREFIX

  if (getAbortController) {
    const abortController = new AbortController()
    getAbortController(abortController)
    options.signal = abortController.signal
  }

  const fetchPathname = base + (url.startsWith('/') ? url : `/${url}`)
  if (!isMarketplaceAPI)
    headers.set(CSRF_HEADER_NAME, Cookies.get(CSRF_COOKIE_NAME()) || '')

  if (deleteContentType)
    headers.delete('Content-Type')

  // ! For Marketplace API, help to filter tags added in new version
  if (isMarketplaceAPI)
    headers.set('X-Dify-Version', !IS_MARKETPLACE ? APP_VERSION : '999.0.0')

  const client = baseClient.extend({
    hooks: {
      ...baseHooks,
      beforeError: [
        ...baseHooks.beforeError || [],
        beforeErrorToast(otherOptions),
      ],
      beforeRequest: [
        ...baseHooks.beforeRequest || [],
        isPublicAPI && beforeRequestPublicWithCode,
      ].filter((h): h is BeforeRequestHook => Boolean(h)),
      afterResponse: [
        ...baseHooks.afterResponse || [],
        afterResponseErrorCode(otherOptions),
      ],
    },
  })

  const res = await client(request || fetchPathname, {
    ...init,
    headers,
    credentials: isMarketplaceAPI
      ? 'omit'
      : (options.credentials || 'include'),
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

  if (needAllResponseContent || fetchCompat)
    return res as T
  const contentType = res.headers.get('content-type')
  if (
    contentType
    && [ContentType.download, ContentType.audio, ContentType.downloadZip].includes(contentType)
  ) {
    return await res.blob() as T
  }

  return await res.json() as T
}

export { base }
