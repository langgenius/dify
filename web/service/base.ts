/* eslint-disable no-new, prefer-promise-reject-errors */
import { API_PREFIX, IS_CE_EDITION, PUBLIC_API_PREFIX } from '@/config'
import Toast from '@/app/components/base/toast'

const TIME_OUT = 100000

const ContentType = {
  json: 'application/json',
  stream: 'text/event-stream',
  form: 'application/x-www-form-urlencoded; charset=UTF-8',
  download: 'application/octet-stream', // for download
  upload: 'multipart/form-data', // for upload
}

const baseOptions = {
  method: 'GET',
  mode: 'cors',
  credentials: 'include', // always send cookies、HTTP Basic authentication.
  headers: new Headers({
    'Content-Type': ContentType.json,
  }),
  redirect: 'follow',
}

export type IOnDataMoreInfo = {
  conversationId?: string
  taskId?: string
  messageId: string
  errorMessage?: string
}

export type IOnData = (message: string, isFirstMessage: boolean, moreInfo: IOnDataMoreInfo) => void
export type IOnCompleted = (hasError?: boolean) => void
export type IOnError = (msg: string) => void

type IOtherOptions = {
  isPublicAPI?: boolean
  needAllResponseContent?: boolean
  onData?: IOnData // for stream
  onError?: IOnError
  onCompleted?: IOnCompleted // for stream
  getAbortController?: (abortController: AbortController) => void
}

function unicodeToChar(text: string) {
  return text.replace(/\\u[0-9a-f]{4}/g, (_match, p1) => {
    return String.fromCharCode(parseInt(p1, 16))
  })
}

export function format(text: string) {
  let res = text.trim()
  if (res.startsWith('\n'))
    res = res.replace('\n', '')

  return res.replaceAll('\n', '<br/>').replaceAll('```', '')
}

const handleStream = (response: any, onData: IOnData, onCompleted?: IOnCompleted) => {
  if (!response.ok)
    throw new Error('Network response was not ok')

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let bufferObj: any
  let isFirstMessage = true
  function read() {
    let hasError = false
    reader.read().then((result: any) => {
      if (result.done) {
        onCompleted && onCompleted()
        return
      }
      buffer += decoder.decode(result.value, { stream: true })
      const lines = buffer.split('\n')
      try {
        lines.forEach((message) => {
          if (message.startsWith('data: ')) { // check if it starts with data:
            // console.log(message);
            try {
              bufferObj = JSON.parse(message.substring(6)) // remove data: and parse as json
            }
            catch (e) {
              // mute handle message cut off
              onData('', isFirstMessage, {
                conversationId: bufferObj?.conversation_id,
                messageId: bufferObj?.id,
              })
              return
            }
            if (bufferObj.status === 400 || !bufferObj.event) {
              onData('', false, {
                conversationId: undefined,
                messageId: '',
                errorMessage: bufferObj.message,
              })
              hasError = true
              onCompleted && onCompleted(true)
              return
            }
            // can not use format here. Because message is splited.
            onData(unicodeToChar(bufferObj.answer), isFirstMessage, {
              conversationId: bufferObj.conversation_id,
              taskId: bufferObj.task_id,
              messageId: bufferObj.id,
            })
            isFirstMessage = false
          }
        })
        buffer = lines[lines.length - 1]
      }
      catch (e) {
        onData('', false, {
          conversationId: undefined,
          messageId: '',
          errorMessage: `${e}`,
        })
        hasError = true
        onCompleted && onCompleted(true)
        return
      }
      if (!hasError)
        read()
    })
  }
  read()
}

const baseFetch = (
  url: string,
  fetchOptions: any,
  {
    isPublicAPI = false,
    needAllResponseContent,
  }: IOtherOptions,
) => {
  const options = Object.assign({}, baseOptions, fetchOptions)
  if (isPublicAPI) {
    const sharedToken = globalThis.location.pathname.split('/').slice(-1)[0]
    options.headers.set('Authorization', `bearer ${sharedToken}`)
  }

  const urlPrefix = isPublicAPI ? PUBLIC_API_PREFIX : API_PREFIX
  let urlWithPrefix = `${urlPrefix}${url.startsWith('/') ? url : `/${url}`}`

  const { method, params, body } = options
  // handle query
  if (method === 'GET' && params) {
    const paramsArray: string[] = []
    Object.keys(params).forEach(key =>
      paramsArray.push(`${key}=${encodeURIComponent(params[key])}`),
    )
    if (urlWithPrefix.search(/\?/) === -1)
      urlWithPrefix += `?${paramsArray.join('&')}`

    else
      urlWithPrefix += `&${paramsArray.join('&')}`

    delete options.params
  }

  if (body)
    options.body = JSON.stringify(body)

  // Handle timeout
  return Promise.race([
    new Promise((resolve, reject) => {
      setTimeout(() => {
        reject(new Error('request timeout'))
      }, TIME_OUT)
    }),
    new Promise((resolve, reject) => {
      globalThis.fetch(urlWithPrefix, options)
        .then((res: any) => {
          const resClone = res.clone()
          // Error handler
          if (!/^(2|3)\d{2}$/.test(res.status)) {
            const bodyJson = res.json()
            switch (res.status) {
              case 401: {
                if (isPublicAPI) {
                  Toast.notify({ type: 'error', message: 'Invalid token' })
                  return
                }
                const loginUrl = `${globalThis.location.origin}/signin`
                if (IS_CE_EDITION) {
                  bodyJson.then((data: any) => {
                    if (data.code === 'not_setup') {
                      globalThis.location.href = `${globalThis.location.origin}/install`
                    }
                    else {
                      if (location.pathname === '/signin') {
                        bodyJson.then((data: any) => {
                          Toast.notify({ type: 'error', message: data.message })
                        })
                      }
                      else {
                        globalThis.location.href = loginUrl
                      }
                    }
                  })
                  return Promise.reject()
                }
                globalThis.location.href = loginUrl
                break
              }
              case 403:
                new Promise(() => {
                  bodyJson.then((data: any) => {
                    Toast.notify({ type: 'error', message: data.message })
                    if (data.code === 'already_setup')
                      globalThis.location.href = `${globalThis.location.origin}/signin`
                  })
                })
                break
              // fall through
              default:
                new Promise(() => {
                  bodyJson.then((data: any) => {
                    Toast.notify({ type: 'error', message: data.message })
                  })
                })
            }
            return Promise.reject(resClone)
          }

          // handle delete api. Delete api not return content.
          if (res.status === 204) {
            resolve({ result: 'success' })
            return
          }

          // return data
          const data = options.headers.get('Content-type') === ContentType.download ? res.blob() : res.json()

          resolve(needAllResponseContent ? resClone : data)
        })
        .catch((err) => {
          Toast.notify({ type: 'error', message: err })
          reject(err)
        })
    }),
  ])
}

export const upload = (options: any): Promise<any> => {
  const defaultOptions = {
    method: 'POST',
    url: `${API_PREFIX}/files/upload`,
    headers: {},
    data: {},
  }
  options = {
    ...defaultOptions,
    ...options,
    headers: { ...defaultOptions.headers, ...options.headers },
  }
  return new Promise((resolve, reject) => {
    const xhr = options.xhr
    xhr.open(options.method, options.url)
    for (const key in options.headers)
      xhr.setRequestHeader(key, options.headers[key])

    xhr.withCredentials = true
    xhr.responseType = 'json'
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status === 201)
          resolve(xhr.response)
        else
          reject(xhr)
      }
    }
    xhr.upload.onprogress = options.onprogress
    xhr.send(options.data)
  })
}

export const ssePost = (url: string, fetchOptions: any, { isPublicAPI = false, onData, onCompleted, onError, getAbortController }: IOtherOptions) => {
  const abortController = new AbortController()

  const options = Object.assign({}, baseOptions, {
    method: 'POST',
    signal: abortController.signal,
  }, fetchOptions)

  getAbortController?.(abortController)

  const urlPrefix = isPublicAPI ? PUBLIC_API_PREFIX : API_PREFIX
  const urlWithPrefix = `${urlPrefix}${url.startsWith('/') ? url : `/${url}`}`

  const { body } = options
  if (body)
    options.body = JSON.stringify(body)

  globalThis.fetch(urlWithPrefix, options)
    .then((res: any) => {
      // debugger
      if (!/^(2|3)\d{2}$/.test(res.status)) {
        new Promise(() => {
          res.json().then((data: any) => {
            Toast.notify({ type: 'error', message: data.message || 'Server Error' })
          })
        })
        onError?.('Server Error')
        return
      }
      return handleStream(res, (str: string, isFirstMessage: boolean, moreInfo: IOnDataMoreInfo) => {
        if (moreInfo.errorMessage) {
          Toast.notify({ type: 'error', message: moreInfo.errorMessage })
          return
        }
        onData?.(str, isFirstMessage, moreInfo)
      }, onCompleted)
    }).catch((e) => {
      // debugger
      Toast.notify({ type: 'error', message: e })
      onError?.(e)
    })
}

export const request = (url: string, options = {}, otherOptions?: IOtherOptions) => {
  return baseFetch(url, options, otherOptions || {})
}

export const get = (url: string, options = {}, otherOptions?: IOtherOptions) => {
  return request(url, Object.assign({}, options, { method: 'GET' }), otherOptions)
}

// For public API
export const getPublic = (url: string, options = {}, otherOptions?: IOtherOptions) => {
  return get(url, options, { ...otherOptions, isPublicAPI: true })
}

export const post = (url: string, options = {}, otherOptions?: IOtherOptions) => {
  return request(url, Object.assign({}, options, { method: 'POST' }), otherOptions)
}

export const postPublic = (url: string, options = {}, otherOptions?: IOtherOptions) => {
  return post(url, options, { ...otherOptions, isPublicAPI: true })
}

export const put = (url: string, options = {}, otherOptions?: IOtherOptions) => {
  return request(url, Object.assign({}, options, { method: 'PUT' }), otherOptions)
}

export const putPublic = (url: string, options = {}, otherOptions?: IOtherOptions) => {
  return put(url, options, { ...otherOptions, isPublicAPI: true })
}

export const del = (url: string, options = {}, otherOptions?: IOtherOptions) => {
  return request(url, Object.assign({}, options, { method: 'DELETE' }), otherOptions)
}

export const delPublic = (url: string, options = {}, otherOptions?: IOtherOptions) => {
  return del(url, options, { ...otherOptions, isPublicAPI: true })
}

export const patch = (url: string, options = {}, otherOptions?: IOtherOptions) => {
  return request(url, Object.assign({}, options, { method: 'PATCH' }), otherOptions)
}

export const patchPublic = (url: string, options = {}, otherOptions?: IOtherOptions) => {
  return patch(url, options, { ...otherOptions, isPublicAPI: true })
}
