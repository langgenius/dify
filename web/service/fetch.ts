import type { AfterResponseHook, BeforeErrorHook, BeforeRequestHook, Hooks } from 'ky'
import ky from 'ky'
import type { IOtherOptions } from './base'
import Toast from '@/app/components/base/toast'
import { API_PREFIX, MARKETPLACE_API_PREFIX, PUBLIC_API_PREFIX } from '@/config'

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
  if (response.status === 204) return Response.json({ result: 'success' })
}

export type ResponseError = {
  code: string
  message: string
  status: number
}

const afterResponseErrorCode = (otherOptions: IOtherOptions): AfterResponseHook => {
  return async (_request, _options, response) => {
    const clonedResponse = response.clone()
    if (!/^(2|3)\d{2}$/.test(String(clonedResponse.status))) {
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

export const getPublicToken = () => {
  let token = ''
  const sharedToken = globalThis.location.pathname.split('/').slice(-1)[0]
  const accessToken = localStorage.getItem('token') || JSON.stringify({ [sharedToken]: '' })
  let accessTokenJson = { [sharedToken]: '' }
  try {
    accessTokenJson = JSON.parse(accessToken)
  }
  catch { }
  token = accessTokenJson[sharedToken]
  return token || ''
}

export function getAccessToken(isPublicAPI?: boolean) {
  if (isPublicAPI) {
    const sharedToken = globalThis.location.pathname.split('/').slice(-1)[0]
    const accessToken = localStorage.getItem('token') || JSON.stringify({ [sharedToken]: '' })
    let accessTokenJson = { [sharedToken]: '' }
    try {
      accessTokenJson = JSON.parse(accessToken)
    }
    catch (e) {

    }
    return accessTokenJson[sharedToken]
  }
  else {
    return localStorage.getItem('console_token') || ''
  }
}

const beforeRequestPublicAuthorization: BeforeRequestHook = (request) => {
  const token = getAccessToken(true)
  request.headers.set('Authorization', `Bearer ${token}`)
}

const beforeRequestAuthorization: BeforeRequestHook = (request) => {
  const accessToken = getAccessToken()
  request.headers.set('Authorization', `Bearer ${accessToken}`)
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

export const baseOptions: RequestInit = {
  method: 'GET',
  mode: 'cors',
  credentials: 'include', // always send cookies、HTTP Basic authentication.
  headers: new Headers({
    'Content-Type': ContentType.json,
  }),
  redirect: 'follow',
}

async function base<T>(url: string, options: FetchOptionType = {}, otherOptions: IOtherOptions = {}): Promise<T> {
  const { params, body, headers, ...init } = Object.assign({}, baseOptions, options)
  const {
    isPublicAPI = false,
    isMarketplaceAPI = false,
    bodyStringify = true,
    needAllResponseContent,
    deleteContentType,
    getAbortController,
  } = otherOptions

  const base
    = isMarketplaceAPI
      ? MARKETPLACE_API_PREFIX
      : isPublicAPI
        ? PUBLIC_API_PREFIX
        : API_PREFIX

  if (getAbortController) {
    const abortController = new AbortController()
    getAbortController(abortController)
    options.signal = abortController.signal
  }

  const fetchPathname = `${base}${url.startsWith('/') ? url : `/${url}`}`

  if (deleteContentType)
    (headers as any).delete('Content-Type')

  const client = baseClient.extend({
    hooks: {
      ...baseHooks,
      beforeError: [
        ...baseHooks.beforeError || [],
        beforeErrorToast(otherOptions),
      ],
      beforeRequest: [
        ...baseHooks.beforeRequest || [],
        isPublicAPI && beforeRequestPublicAuthorization,
        !isPublicAPI && !isMarketplaceAPI && beforeRequestAuthorization,
      ].filter(Boolean),
      afterResponse: [
        ...baseHooks.afterResponse || [],
        afterResponseErrorCode(otherOptions),
      ],
    },
  })

  const res = await client(fetchPathname, {
    ...init,
    headers,
    credentials: isMarketplaceAPI
      ? 'omit'
      : (options.credentials || 'include'),
    retry: {
      methods: [],
    },
    ...(bodyStringify ? { json: body } : { body: body as BodyInit }),
    searchParams: params,
  })

  if (needAllResponseContent)
    return res as T
  const contentType = res.headers.get('content-type')
  if (
    contentType
    && [ContentType.download, ContentType.audio, ContentType.downloadZip].includes(contentType)
  )
    return await res.blob() as T

  return await res.json() as T
}

export { base }
