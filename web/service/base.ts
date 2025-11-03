import { API_PREFIX, CSRF_COOKIE_NAME, CSRF_HEADER_NAME, IS_CE_EDITION, PASSPORT_HEADER_NAME, PUBLIC_API_PREFIX, WEB_APP_SHARE_CODE_HEADER_NAME } from '@/config'
import { refreshAccessTokenOrRelogin } from './refresh-token'
import Toast from '@/app/components/base/toast'
import { basePath } from '@/utils/var'
import type { AnnotationReply, MessageEnd, MessageReplace, ThoughtItem } from '@/app/components/base/chat/chat/type'
import type { VisionFile } from '@/types/app'
import type {
  AgentLogResponse,
  IterationFinishedResponse,
  IterationNextResponse,
  IterationStartedResponse,
  LoopFinishedResponse,
  LoopNextResponse,
  LoopStartedResponse,
  NodeFinishedResponse,
  NodeStartedResponse,
  ParallelBranchFinishedResponse,
  ParallelBranchStartedResponse,
  TextChunkResponse,
  TextReplaceResponse,
  WorkflowFinishedResponse,
  WorkflowStartedResponse,
} from '@/types/workflow'
import type { FetchOptionType, ResponseError } from './fetch'
import { ContentType, base, getBaseOptions } from './fetch'
import { asyncRunSafe } from '@/utils'
import type {
  DataSourceNodeCompletedResponse,
  DataSourceNodeErrorResponse,
  DataSourceNodeProcessingResponse,
} from '@/types/pipeline'
import Cookies from 'js-cookie'
import { getWebAppPassport } from './webapp-auth'
const TIME_OUT = 100000

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
export type IOnNodeRetry = (nodeFinished: NodeFinishedResponse) => void
export type IOnIterationFinished = (workflowFinished: IterationFinishedResponse) => void
export type IOnParallelBranchStarted = (parallelBranchStarted: ParallelBranchStartedResponse) => void
export type IOnParallelBranchFinished = (parallelBranchFinished: ParallelBranchFinishedResponse) => void
export type IOnTextChunk = (textChunk: TextChunkResponse) => void
export type IOnTTSChunk = (messageId: string, audioStr: string, audioType?: string) => void
export type IOnTTSEnd = (messageId: string, audioStr: string, audioType?: string) => void
export type IOnTextReplace = (textReplace: TextReplaceResponse) => void
export type IOnLoopStarted = (workflowStarted: LoopStartedResponse) => void
export type IOnLoopNext = (workflowStarted: LoopNextResponse) => void
export type IOnLoopFinished = (workflowFinished: LoopFinishedResponse) => void
export type IOnAgentLog = (agentLog: AgentLogResponse) => void

export type IOnDataSourceNodeProcessing = (dataSourceNodeProcessing: DataSourceNodeProcessingResponse) => void
export type IOnDataSourceNodeCompleted = (dataSourceNodeCompleted: DataSourceNodeCompletedResponse) => void
export type IOnDataSourceNodeError = (dataSourceNodeError: DataSourceNodeErrorResponse) => void

export type IOtherOptions = {
  isPublicAPI?: boolean
  isMarketplaceAPI?: boolean
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
  onNodeRetry?: IOnNodeRetry
  onParallelBranchStarted?: IOnParallelBranchStarted
  onParallelBranchFinished?: IOnParallelBranchFinished
  onTextChunk?: IOnTextChunk
  onTTSChunk?: IOnTTSChunk
  onTTSEnd?: IOnTTSEnd
  onTextReplace?: IOnTextReplace
  onLoopStart?: IOnLoopStarted
  onLoopNext?: IOnLoopNext
  onLoopFinish?: IOnLoopFinished
  onAgentLog?: IOnAgentLog

  // Pipeline data source node run
  onDataSourceNodeProcessing?: IOnDataSourceNodeProcessing
  onDataSourceNodeCompleted?: IOnDataSourceNodeCompleted
  onDataSourceNodeError?: IOnDataSourceNodeError
}

function jumpTo(url: string) {
  if (!url)
    return
  const targetPath = new URL(url, globalThis.location.origin).pathname
  if (targetPath === globalThis.location.pathname)
    return
  globalThis.location.href = url
}

function unicodeToChar(text: string) {
  if (!text)
    return ''

  return text.replace(/\\u([0-9a-f]{4})/g, (_match, p1) => {
    return String.fromCharCode(Number.parseInt(p1, 16))
  })
}

const WBB_APP_LOGIN_PATH = '/webapp-signin'
function requiredWebSSOLogin(message?: string, code?: number) {
  const params = new URLSearchParams()
  // prevent redirect loop
  if (globalThis.location.pathname === WBB_APP_LOGIN_PATH)
    return

  params.append('redirect_url', encodeURIComponent(`${globalThis.location.pathname}${globalThis.location.search}`))
  if (message)
    params.append('message', message)
  if (code)
    params.append('code', String(code))
  globalThis.location.href = `${globalThis.location.origin}${basePath}/${WBB_APP_LOGIN_PATH}?${params.toString()}`
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
  onLoopStart?: IOnLoopStarted,
  onLoopNext?: IOnLoopNext,
  onLoopFinish?: IOnLoopFinished,
  onNodeRetry?: IOnNodeRetry,
  onParallelBranchStarted?: IOnParallelBranchStarted,
  onParallelBranchFinished?: IOnParallelBranchFinished,
  onTextChunk?: IOnTextChunk,
  onTTSChunk?: IOnTTSChunk,
  onTTSEnd?: IOnTTSEnd,
  onTextReplace?: IOnTextReplace,
  onAgentLog?: IOnAgentLog,
  onDataSourceNodeProcessing?: IOnDataSourceNodeProcessing,
  onDataSourceNodeCompleted?: IOnDataSourceNodeCompleted,
  onDataSourceNodeError?: IOnDataSourceNodeError,
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
    reader?.read().then((result: ReadableStreamReadResult<Uint8Array>) => {
      if (result.done) {
        onCompleted?.()
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
            catch {
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
            else if (bufferObj.event === 'loop_started') {
              onLoopStart?.(bufferObj as LoopStartedResponse)
            }
            else if (bufferObj.event === 'loop_next') {
              onLoopNext?.(bufferObj as LoopNextResponse)
            }
            else if (bufferObj.event === 'loop_completed') {
              onLoopFinish?.(bufferObj as LoopFinishedResponse)
            }
            else if (bufferObj.event === 'node_retry') {
              onNodeRetry?.(bufferObj as NodeFinishedResponse)
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
            else if (bufferObj.event === 'agent_log') {
              onAgentLog?.(bufferObj as AgentLogResponse)
            }
            else if (bufferObj.event === 'tts_message') {
              onTTSChunk?.(bufferObj.message_id, bufferObj.audio, bufferObj.audio_type)
            }
            else if (bufferObj.event === 'tts_message_end') {
              onTTSEnd?.(bufferObj.message_id, bufferObj.audio)
            }
            else if (bufferObj.event === 'datasource_processing') {
              onDataSourceNodeProcessing?.(bufferObj as DataSourceNodeProcessingResponse)
            }
            else if (bufferObj.event === 'datasource_completed') {
              onDataSourceNodeCompleted?.(bufferObj as DataSourceNodeCompletedResponse)
            }
            else if (bufferObj.event === 'datasource_error') {
              onDataSourceNodeError?.(bufferObj as DataSourceNodeErrorResponse)
            }
            else {
              console.warn(`Unknown event: ${bufferObj.event}`, bufferObj)
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

const baseFetch = base

type UploadOptions = {
  xhr: XMLHttpRequest
  method?: string
  url?: string
  headers?: Record<string, string>
  data: FormData
  onprogress?: (this: XMLHttpRequest, ev: ProgressEvent<EventTarget>) => void
}

type UploadResponse = {
  id: string
  [key: string]: unknown
}

export const upload = async (options: UploadOptions, isPublicAPI?: boolean, url?: string, searchParams?: string): Promise<UploadResponse> => {
  const urlPrefix = isPublicAPI ? PUBLIC_API_PREFIX : API_PREFIX
  const shareCode = globalThis.location.pathname.split('/').slice(-1)[0]
  const defaultOptions = {
    method: 'POST',
    url: (url ? `${urlPrefix}${url}` : `${urlPrefix}/files/upload`) + (searchParams || ''),
    headers: {
      [CSRF_HEADER_NAME]: Cookies.get(CSRF_COOKIE_NAME()) || '',
      [PASSPORT_HEADER_NAME]: getWebAppPassport(shareCode),
      [WEB_APP_SHARE_CODE_HEADER_NAME]: shareCode,
    },
  }
  const mergedOptions = {
    ...defaultOptions,
    ...options,
    url: options.url || defaultOptions.url,
    headers: { ...defaultOptions.headers, ...options.headers } as Record<string, string>,
  }
  return new Promise((resolve, reject) => {
    const xhr = mergedOptions.xhr
    xhr.open(mergedOptions.method, mergedOptions.url)
    for (const key in mergedOptions.headers)
      xhr.setRequestHeader(key, mergedOptions.headers[key])

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
    if (mergedOptions.onprogress)
      xhr.upload.onprogress = mergedOptions.onprogress
    xhr.send(mergedOptions.data)
  })
}

export const ssePost = async (
  url: string,
  fetchOptions: FetchOptionType,
  otherOptions: IOtherOptions,
) => {
  const {
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
    onNodeRetry,
    onParallelBranchStarted,
    onParallelBranchFinished,
    onTextChunk,
    onTTSChunk,
    onTTSEnd,
    onTextReplace,
    onAgentLog,
    onError,
    getAbortController,
    onLoopStart,
    onLoopNext,
    onLoopFinish,
    onDataSourceNodeProcessing,
    onDataSourceNodeCompleted,
    onDataSourceNodeError,
  } = otherOptions
  const abortController = new AbortController()

  // No need to get token from localStorage, cookies will be sent automatically

  const baseOptions = getBaseOptions()
  const shareCode = globalThis.location.pathname.split('/').slice(-1)[0]
  const options = Object.assign({}, baseOptions, {
    method: 'POST',
    signal: abortController.signal,
    headers: new Headers({
      [CSRF_HEADER_NAME]: Cookies.get(CSRF_COOKIE_NAME()) || '',
      [WEB_APP_SHARE_CODE_HEADER_NAME]: shareCode,
      [PASSPORT_HEADER_NAME]: getWebAppPassport(shareCode),
    }),
  } as RequestInit, fetchOptions)

  const contentType = (options.headers as Headers).get('Content-Type')
  if (!contentType)
    (options.headers as Headers).set('Content-Type', ContentType.json)

  getAbortController?.(abortController)

  const urlPrefix = isPublicAPI ? PUBLIC_API_PREFIX : API_PREFIX
  const urlWithPrefix = (url.startsWith('http://') || url.startsWith('https://'))
    ? url
    : `${urlPrefix}${url.startsWith('/') ? url : `/${url}`}`

  const { body } = options
  if (body)
    options.body = JSON.stringify(body)

  globalThis.fetch(urlWithPrefix, options as RequestInit)
    .then((res) => {
      if (!/^[23]\d{2}$/.test(String(res.status))) {
        if (res.status === 401) {
          if (isPublicAPI) {
            res.json().then((data: { code?: string; message?: string }) => {
              if (isPublicAPI) {
                if (data.code === 'web_app_access_denied')
                  requiredWebSSOLogin(data.message, 403)

                if (data.code === 'web_sso_auth_required')
                  requiredWebSSOLogin()

                if (data.code === 'unauthorized')
                  requiredWebSSOLogin()
              }
            })
          }
          else {
            refreshAccessTokenOrRelogin(TIME_OUT).then(() => {
              ssePost(url, fetchOptions, otherOptions)
            }).catch((err) => {
              console.error(err)
            })
          }
        }
        else {
          res.json().then((data) => {
            Toast.notify({ type: 'error', message: data.message || 'Server Error' })
          })
          onError?.('Server Error')
        }
        return
      }
      return handleStream(
        res,
        (str: string, isFirstMessage: boolean, moreInfo: IOnDataMoreInfo) => {
          if (moreInfo.errorMessage) {
            onError?.(moreInfo.errorMessage, moreInfo.errorCode)
            // TypeError: Cannot assign to read only property ... will happen in page leave, so it should be ignored.
            if (moreInfo.errorMessage !== 'AbortError: The user aborted a request.' && !moreInfo.errorMessage.includes('TypeError: Cannot assign to read only property'))
              Toast.notify({ type: 'error', message: moreInfo.errorMessage })
            return
          }
          onData?.(str, isFirstMessage, moreInfo)
        },
        onCompleted,
        onThought,
        onMessageEnd,
        onMessageReplace,
        onFile,
        onWorkflowStarted,
        onWorkflowFinished,
        onNodeStarted,
        onNodeFinished,
        onIterationStart,
        onIterationNext,
        onIterationFinish,
        onLoopStart,
        onLoopNext,
        onLoopFinish,
        onNodeRetry,
        onParallelBranchStarted,
        onParallelBranchFinished,
        onTextChunk,
        onTTSChunk,
        onTTSEnd,
        onTextReplace,
        onAgentLog,
        onDataSourceNodeProcessing,
        onDataSourceNodeCompleted,
        onDataSourceNodeError,
      )
    }).catch((e) => {
      if (e.toString() !== 'AbortError: The user aborted a request.' && !e.toString().includes('TypeError: Cannot assign to read only property'))
        Toast.notify({ type: 'error', message: e })
      onError?.(e)
    })
}

// base request
export const request = async<T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  try {
    const otherOptionsForBaseFetch = otherOptions || {}
    const [err, resp] = await asyncRunSafe<T>(baseFetch(url, options, otherOptionsForBaseFetch))
    if (err === null)
      return resp
    const errResp: Response = err as any
    if (errResp.status === 401) {
      const [parseErr, errRespData] = await asyncRunSafe<ResponseError>(errResp.json())
      const loginUrl = `${globalThis.location.origin}${basePath}/signin`
      if (parseErr) {
        globalThis.location.href = loginUrl
        return Promise.reject(err)
      }
      if (/\/login/.test(url))
        return Promise.reject(errRespData)
      // special code
      const { code, message } = errRespData
      // webapp sso
      if (code === 'web_app_access_denied') {
        requiredWebSSOLogin(message, 403)
        return Promise.reject(err)
      }
      if (code === 'web_sso_auth_required') {
        requiredWebSSOLogin()
        return Promise.reject(err)
      }
      if (code === 'unauthorized_and_force_logout') {
        // Cookies will be cleared by the backend
        globalThis.location.reload()
        return Promise.reject(err)
      }
      const {
        isPublicAPI = false,
        silent,
      } = otherOptionsForBaseFetch
      if (isPublicAPI && code === 'unauthorized') {
        requiredWebSSOLogin()
        return Promise.reject(err)
      }
      if (code === 'init_validate_failed' && IS_CE_EDITION && !silent) {
        Toast.notify({ type: 'error', message, duration: 4000 })
        return Promise.reject(err)
      }
      if (code === 'not_init_validated' && IS_CE_EDITION) {
        jumpTo(`${globalThis.location.origin}${basePath}/init`)
        return Promise.reject(err)
      }
      if (code === 'not_setup' && IS_CE_EDITION) {
        jumpTo(`${globalThis.location.origin}${basePath}/install`)
        return Promise.reject(err)
      }

      // refresh token
      const [refreshErr] = await asyncRunSafe(refreshAccessTokenOrRelogin(TIME_OUT))
      if (refreshErr === null)
        return baseFetch<T>(url, options, otherOptionsForBaseFetch)
      if (location.pathname !== `${basePath}/signin` || !IS_CE_EDITION) {
        jumpTo(loginUrl)
        return Promise.reject(err)
      }
      if (!silent) {
        Toast.notify({ type: 'error', message })
        return Promise.reject(err)
      }
      jumpTo(loginUrl)
      return Promise.reject(err)
    }
    else {
      return Promise.reject(err)
    }
  }
  catch (error) {
    console.error(error)
    return Promise.reject(error)
  }
}

// request methods
export const get = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return request<T>(url, Object.assign({}, options, { method: 'GET' }), otherOptions)
}

// For public API
export const getPublic = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return get<T>(url, options, { ...otherOptions, isPublicAPI: true })
}

// For Marketplace API
export const getMarketplace = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return get<T>(url, options, { ...otherOptions, isMarketplaceAPI: true })
}

export const post = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return request<T>(url, Object.assign({}, options, { method: 'POST' }), otherOptions)
}

// For Marketplace API
export const postMarketplace = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return post<T>(url, options, { ...otherOptions, isMarketplaceAPI: true })
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
