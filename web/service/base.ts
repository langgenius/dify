import { API_PREFIX, IS_CE_EDITION, PUBLIC_API_PREFIX } from '@/config'
import Toast from '@/app/components/base/toast'
import type { AnnotationReply, MessageEnd, MessageReplace, ThoughtItem } from '@/app/components/base/chat/chat/type'
import type { VisionFile } from '@/types/app'
import type {
  IterationFinishedResponse,
  IterationNextResponse,
  IterationStartedResponse,
  NodeFinishedResponse,
  NodeStartedResponse,
  ParallelBranchFinishedResponse,
  ParallelBranchStartedResponse,
  TextChunkResponse,
  TextReplaceResponse,
  WorkflowFinishedResponse,
  WorkflowStartedResponse,
} from '@/types/workflow'
import { removeAccessToken } from '@/app/components/share/utils'
const TIME_OUT = 100000

const ContentType = {
  json: 'application/json',
  stream: 'text/event-stream',
  audio: 'audio/mpeg',
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
  errorCode?: string
}

export type IOnData = (message: string, isFirstMessage: boolean, moreInfo: IOnDataMoreInfo) => void
export type IOnThought = (though: ThoughtItem) => void
export type IOnFile = (file: VisionFile) => void
export type IOnMessageEnd = (messageEnd: MessageEnd) => void
export type IOnMessageReplace = (messageReplace: MessageReplace) => void
export type IOnAnnotationReply = (messageReplace: AnnotationReply) => void
export type IOnCompleted = (hasError?: boolean, errorMessage?: string) => void
export type IOnError = (msg: string, code?: string) => void

export type IOnWorkflowStarted = (workflowStarted: WorkflowStartedResponse) => void
export type IOnWorkflowFinished = (workflowFinished: WorkflowFinishedResponse) => void
export type IOnNodeStarted = (nodeStarted: NodeStartedResponse) => void
export type IOnNodeFinished = (nodeFinished: NodeFinishedResponse) => void
export type IOnIterationStarted = (workflowStarted: IterationStartedResponse) => void
export type IOnIterationNext = (workflowStarted: IterationNextResponse) => void
export type IOnIterationFinished = (workflowFinished: IterationFinishedResponse) => void
export type IOnParallelBranchStarted = (parallelBranchStarted: ParallelBranchStartedResponse) => void
export type IOnParallelBranchFinished = (parallelBranchFinished: ParallelBranchFinishedResponse) => void
export type IOnTextChunk = (textChunk: TextChunkResponse) => void
export type IOnTTSChunk = (messageId: string, audioStr: string, audioType?: string) => void
export type IOnTTSEnd = (messageId: string, audioStr: string, audioType?: string) => void
export type IOnTextReplace = (textReplace: TextReplaceResponse) => void

export type IOtherOptions = {
  isPublicAPI?: boolean
  bodyStringify?: boolean
  needAllResponseContent?: boolean
  deleteContentType?: boolean
  silent?: boolean
  onData?: IOnData // for stream
  onThought?: IOnThought
  onFile?: IOnFile
  onMessageEnd?: IOnMessageEnd
  onMessageReplace?: IOnMessageReplace
  onError?: IOnError
  onCompleted?: IOnCompleted // for stream
  getAbortController?: (abortController: AbortController) => void

  onWorkflowStarted?: IOnWorkflowStarted
  onWorkflowFinished?: IOnWorkflowFinished
  onNodeStarted?: IOnNodeStarted
  onNodeFinished?: IOnNodeFinished
  onIterationStart?: IOnIterationStarted
  onIterationNext?: IOnIterationNext
  onIterationFinish?: IOnIterationFinished
  onParallelBranchStarted?: IOnParallelBranchStarted
  onParallelBranchFinished?: IOnParallelBranchFinished
  onTextChunk?: IOnTextChunk
  onTTSChunk?: IOnTTSChunk
  onTTSEnd?: IOnTTSEnd
  onTextReplace?: IOnTextReplace
}

type ResponseError = {
  code: string
  message: string
  status: number
}

type FetchOptionType = Omit<RequestInit, 'body'> & {
  params?: Record<string, any>
  body?: BodyInit | Record<string, any> | null
}

function unicodeToChar(text: string) {
  if (!text)
    return ''

  return text.replace(/\\u[0-9a-f]{4}/g, (_match, p1) => {
    return String.fromCharCode(parseInt(p1, 16))
  })
}

function requiredWebSSOLogin() {
  globalThis.location.href = `/webapp-signin?redirect_url=${globalThis.location.pathname}`
}

export function format(text: string) {
  let res = text.trim()
  if (res.startsWith('\n'))
    res = res.replace('\n', '')

  return res.replaceAll('\n', '<br/>').replaceAll('```', '')
}

const handleStream = (
  response: Response,
  onData: IOnData,
  onCompleted?: IOnCompleted,
  onThought?: IOnThought,
  onMessageEnd?: IOnMessageEnd,
  onMessageReplace?: IOnMessageReplace,
  onFile?: IOnFile,
  onWorkflowStarted?: IOnWorkflowStarted,
  onWorkflowFinished?: IOnWorkflowFinished,
  onNodeStarted?: IOnNodeStarted,
  onNodeFinished?: IOnNodeFinished,
  onIterationStart?: IOnIterationStarted,
  onIterationNext?: IOnIterationNext,
  onIterationFinish?: IOnIterationFinished,
  onParallelBranchStarted?: IOnParallelBranchStarted,
  onParallelBranchFinished?: IOnParallelBranchFinished,
  onTextChunk?: IOnTextChunk,
  onTTSChunk?: IOnTTSChunk,
  onTTSEnd?: IOnTTSEnd,
  onTextReplace?: IOnTextReplace,
) => {
  if (!response.ok)
    throw new Error('Network response was not ok')

  const reader = response.body?.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let bufferObj: Record<string, any>
  let isFirstMessage = true
  function read() {
    let hasError = false
    reader?.read().then((result: any) => {
      if (result.done) {
        onCompleted && onCompleted()
        return
      }
      buffer += decoder.decode(result.value, { stream: true })
      const lines = buffer.split('\n')
      try {
        lines.forEach((message) => {
          if (message.startsWith('data: ')) { // check if it starts with data:
            try {
              bufferObj = JSON.parse(message.substring(6)) as Record<string, any>// remove data: and parse as json
            }
            catch (e) {
              // mute handle message cut off
              onData('', isFirstMessage, {
                conversationId: bufferObj?.conversation_id,
                messageId: bufferObj?.message_id,
              })
              return
            }
            if (bufferObj.status === 400 || !bufferObj.event) {
              onData('', false, {
                conversationId: undefined,
                messageId: '',
                errorMessage: bufferObj?.message,
                errorCode: bufferObj?.code,
              })
              hasError = true
              onCompleted?.(true, bufferObj?.message)
              return
            }
            if (bufferObj.event === 'message' || bufferObj.event === 'agent_message') {
              // can not use format here. Because message is splitted.
              onData(unicodeToChar(bufferObj.answer), isFirstMessage, {
                conversationId: bufferObj.conversation_id,
                taskId: bufferObj.task_id,
                messageId: bufferObj.id,
              })
              isFirstMessage = false
            }
            else if (bufferObj.event === 'agent_thought') {
              onThought?.(bufferObj as ThoughtItem)
            }
            else if (bufferObj.event === 'message_file') {
              onFile?.(bufferObj as VisionFile)
            }
            else if (bufferObj.event === 'message_end') {
              onMessageEnd?.(bufferObj as MessageEnd)
            }
            else if (bufferObj.event === 'message_replace') {
              onMessageReplace?.(bufferObj as MessageReplace)
            }
            else if (bufferObj.event === 'workflow_started') {
              onWorkflowStarted?.(bufferObj as WorkflowStartedResponse)
            }
            else if (bufferObj.event === 'workflow_finished') {
              onWorkflowFinished?.(bufferObj as WorkflowFinishedResponse)
            }
            else if (bufferObj.event === 'node_started') {
              onNodeStarted?.(bufferObj as NodeStartedResponse)
            }
            else if (bufferObj.event === 'node_finished') {
              onNodeFinished?.(bufferObj as NodeFinishedResponse)
            }
            else if (bufferObj.event === 'iteration_started') {
              onIterationStart?.(bufferObj as IterationStartedResponse)
            }
            else if (bufferObj.event === 'iteration_next') {
              onIterationNext?.(bufferObj as IterationNextResponse)
            }
            else if (bufferObj.event === 'iteration_completed') {
              onIterationFinish?.(bufferObj as IterationFinishedResponse)
            }
            else if (bufferObj.event === 'parallel_branch_started') {
              onParallelBranchStarted?.(bufferObj as ParallelBranchStartedResponse)
            }
            else if (bufferObj.event === 'parallel_branch_finished') {
              onParallelBranchFinished?.(bufferObj as ParallelBranchFinishedResponse)
            }
            else if (bufferObj.event === 'text_chunk') {
              onTextChunk?.(bufferObj as TextChunkResponse)
            }
            else if (bufferObj.event === 'text_replace') {
              onTextReplace?.(bufferObj as TextReplaceResponse)
            }
            else if (bufferObj.event === 'tts_message') {
              onTTSChunk?.(bufferObj.message_id, bufferObj.audio, bufferObj.audio_type)
            }
            else if (bufferObj.event === 'tts_message_end') {
              onTTSEnd?.(bufferObj.message_id, bufferObj.audio)
            }
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
        onCompleted?.(true, e as string)
        return
      }
      if (!hasError)
        read()
    })
  }
  read()
}

const baseFetch = <T>(
  url: string,
  fetchOptions: FetchOptionType,
  {
    isPublicAPI = false,
    bodyStringify = true,
    needAllResponseContent,
    deleteContentType,
    getAbortController,
    silent,
  }: IOtherOptions,
): Promise<T> => {
  const options: typeof baseOptions & FetchOptionType = Object.assign({}, baseOptions, fetchOptions)
  if (getAbortController) {
    const abortController = new AbortController()
    getAbortController(abortController)
    options.signal = abortController.signal
  }
  if (isPublicAPI) {
    const sharedToken = globalThis.location.pathname.split('/').slice(-1)[0]
    const accessToken = localStorage.getItem('token') || JSON.stringify({ [sharedToken]: '' })
    let accessTokenJson = { [sharedToken]: '' }
    try {
      accessTokenJson = JSON.parse(accessToken)
    }
    catch (e) {

    }
    options.headers.set('Authorization', `Bearer ${accessTokenJson[sharedToken]}`)
  }
  else {
    const accessToken = localStorage.getItem('console_token') || ''
    options.headers.set('Authorization', `Bearer ${accessToken}`)
  }

  if (deleteContentType) {
    options.headers.delete('Content-Type')
  }
  else {
    const contentType = options.headers.get('Content-Type')
    if (!contentType)
      options.headers.set('Content-Type', ContentType.json)
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

  if (body && bodyStringify)
    options.body = JSON.stringify(body)

  // Handle timeout
  return Promise.race([
    new Promise((resolve, reject) => {
      setTimeout(() => {
        reject(new Error('request timeout'))
      }, TIME_OUT)
    }),
    new Promise((resolve, reject) => {
      globalThis.fetch(urlWithPrefix, options as RequestInit)
        .then((res) => {
          const resClone = res.clone()
          // Error handler
          if (!/^(2|3)\d{2}$/.test(String(res.status))) {
            const bodyJson = res.json()
            switch (res.status) {
              case 401: {
                if (isPublicAPI) {
                  return bodyJson.then((data: ResponseError) => {
                    if (data.code === 'web_sso_auth_required')
                      requiredWebSSOLogin()

                    if (data.code === 'unauthorized') {
                      removeAccessToken()
                      globalThis.location.reload()
                    }

                    return Promise.reject(data)
                  })
                }
                const loginUrl = `${globalThis.location.origin}/signin`
                bodyJson.then((data: ResponseError) => {
                  if (data.code === 'init_validate_failed' && IS_CE_EDITION && !silent)
                    Toast.notify({ type: 'error', message: data.message, duration: 4000 })
                  else if (data.code === 'not_init_validated' && IS_CE_EDITION)
                    globalThis.location.href = `${globalThis.location.origin}/init`
                  else if (data.code === 'not_setup' && IS_CE_EDITION)
                    globalThis.location.href = `${globalThis.location.origin}/install`
                  else if (location.pathname !== '/signin' || !IS_CE_EDITION)
                    globalThis.location.href = loginUrl
                  else if (!silent)
                    Toast.notify({ type: 'error', message: data.message })
                }).catch(() => {
                  // Handle any other errors
                  globalThis.location.href = loginUrl
                })

                break
              }
              case 403:
                bodyJson.then((data: ResponseError) => {
                  if (!silent)
                    Toast.notify({ type: 'error', message: data.message })
                  if (data.code === 'already_setup')
                    globalThis.location.href = `${globalThis.location.origin}/signin`
                })
                break
              // fall through
              default:
                bodyJson.then((data: ResponseError) => {
                  if (!silent)
                    Toast.notify({ type: 'error', message: data.message })
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
          if (options.headers.get('Content-type') === ContentType.download || options.headers.get('Content-type') === ContentType.audio)
            resolve(needAllResponseContent ? resClone : res.blob())

          else resolve(needAllResponseContent ? resClone : res.json())
        })
        .catch((err) => {
          if (!silent)
            Toast.notify({ type: 'error', message: err })
          reject(err)
        })
    }),
  ]) as Promise<T>
}

export const upload = (options: any, isPublicAPI?: boolean, url?: string, searchParams?: string): Promise<any> => {
  const urlPrefix = isPublicAPI ? PUBLIC_API_PREFIX : API_PREFIX
  let token = ''
  if (isPublicAPI) {
    const sharedToken = globalThis.location.pathname.split('/').slice(-1)[0]
    const accessToken = localStorage.getItem('token') || JSON.stringify({ [sharedToken]: '' })
    let accessTokenJson = { [sharedToken]: '' }
    try {
      accessTokenJson = JSON.parse(accessToken)
    }
    catch (e) {

    }
    token = accessTokenJson[sharedToken]
  }
  else {
    const accessToken = localStorage.getItem('console_token') || ''
    token = accessToken
  }
  const defaultOptions = {
    method: 'POST',
    url: (url ? `${urlPrefix}${url}` : `${urlPrefix}/files/upload`) + (searchParams || ''),
    headers: {
      Authorization: `Bearer ${token}`,
    },
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

export const ssePost = (
  url: string,
  fetchOptions: FetchOptionType,
  {
    isPublicAPI = false,
    onData,
    onCompleted,
    onThought,
    onFile,
    onMessageEnd,
    onMessageReplace,
    onWorkflowStarted,
    onWorkflowFinished,
    onNodeStarted,
    onNodeFinished,
    onIterationStart,
    onIterationNext,
    onIterationFinish,
    onParallelBranchStarted,
    onParallelBranchFinished,
    onTextChunk,
    onTTSChunk,
    onTTSEnd,
    onTextReplace,
    onError,
    getAbortController,
  }: IOtherOptions,
) => {
  const abortController = new AbortController()

  const options = Object.assign({}, baseOptions, {
    method: 'POST',
    signal: abortController.signal,
  }, fetchOptions)

  const contentType = options.headers.get('Content-Type')
  if (!contentType)
    options.headers.set('Content-Type', ContentType.json)

  getAbortController?.(abortController)

  const urlPrefix = isPublicAPI ? PUBLIC_API_PREFIX : API_PREFIX
  const urlWithPrefix = `${urlPrefix}${url.startsWith('/') ? url : `/${url}`}`

  const { body } = options
  if (body)
    options.body = JSON.stringify(body)

  globalThis.fetch(urlWithPrefix, options as RequestInit)
    .then((res) => {
      if (!/^(2|3)\d{2}$/.test(String(res.status))) {
        res.json().then((data: any) => {
          if (isPublicAPI) {
            if (data.code === 'web_sso_auth_required')
              requiredWebSSOLogin()

            if (data.code === 'unauthorized') {
              removeAccessToken()
              globalThis.location.reload()
            }
            if (res.status === 401)
              return
          }
          Toast.notify({ type: 'error', message: data.message || 'Server Error' })
        })
        onError?.('Server Error')
        return
      }
      return handleStream(res, (str: string, isFirstMessage: boolean, moreInfo: IOnDataMoreInfo) => {
        if (moreInfo.errorMessage) {
          onError?.(moreInfo.errorMessage, moreInfo.errorCode)
          // TypeError: Cannot assign to read only property ... will happen in page leave, so it should be ignored.
          if (moreInfo.errorMessage !== 'AbortError: The user aborted a request.' && !moreInfo.errorMessage.includes('TypeError: Cannot assign to read only property'))
            Toast.notify({ type: 'error', message: moreInfo.errorMessage })
          return
        }
        onData?.(str, isFirstMessage, moreInfo)
      }, onCompleted, onThought, onMessageEnd, onMessageReplace, onFile, onWorkflowStarted, onWorkflowFinished, onNodeStarted, onNodeFinished, onIterationStart, onIterationNext, onIterationFinish, onParallelBranchStarted, onParallelBranchFinished, onTextChunk, onTTSChunk, onTTSEnd, onTextReplace)
    }).catch((e) => {
      if (e.toString() !== 'AbortError: The user aborted a request.' && !e.toString().errorMessage.includes('TypeError: Cannot assign to read only property'))
        Toast.notify({ type: 'error', message: e })
      onError?.(e)
    })
}

// base request
export const request = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return baseFetch<T>(url, options, otherOptions || {})
}

// request methods
export const get = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return request<T>(url, Object.assign({}, options, { method: 'GET' }), otherOptions)
}

// For public API
export const getPublic = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return get<T>(url, options, { ...otherOptions, isPublicAPI: true })
}

export const post = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return request<T>(url, Object.assign({}, options, { method: 'POST' }), otherOptions)
}

export const postPublic = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return post<T>(url, options, { ...otherOptions, isPublicAPI: true })
}

export const put = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return request<T>(url, Object.assign({}, options, { method: 'PUT' }), otherOptions)
}

export const putPublic = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return put<T>(url, options, { ...otherOptions, isPublicAPI: true })
}

export const del = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return request<T>(url, Object.assign({}, options, { method: 'DELETE' }), otherOptions)
}

export const delPublic = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return del<T>(url, options, { ...otherOptions, isPublicAPI: true })
}

export const patch = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return request<T>(url, Object.assign({}, options, { method: 'PATCH' }), otherOptions)
}

export const patchPublic = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return patch<T>(url, options, { ...otherOptions, isPublicAPI: true })
}
