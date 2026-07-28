import type { FetchOptionType, ResponseError } from './fetch'
import type { MessageEnd, MessageReplace, ThoughtItem } from '@/app/components/base/chat/chat/type'
import type { VisionFile } from '@/types/app'
import type {
  DataSourceNodeCompletedResponse,
  DataSourceNodeErrorResponse,
  DataSourceNodeProcessingResponse,
} from '@/types/pipeline'
import type {
  AgentLogResponse,
  HumanInputFormFilledResponse,
  HumanInputFormTimeoutResponse,
  HumanInputRequiredResponse,
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
  ReasoningChunkResponse,
  TextChunkResponse,
  TextReplaceResponse,
  WorkflowFinishedResponse,
  WorkflowPausedResponse,
  WorkflowStartedResponse,
} from '@/types/workflow'
import { toast } from '@langgenius/dify-ui/toast'
import Cookies from 'js-cookie'
import {
  API_PREFIX,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  PASSPORT_HEADER_NAME,
  PUBLIC_API_PREFIX,
  WEB_APP_SHARE_CODE_HEADER_NAME,
} from '@/config'
import { asyncRunSafe } from '@/utils'
import { isClient } from '@/utils/client'
import { resolveLoginRedirectTarget } from '@/utils/login-redirect'
import { basePath } from '@/utils/var'
import { base, ContentType, getBaseOptions } from './fetch'
import { refreshAccessTokenOrReLogin } from './refresh-token'
import { getWebAppPassport } from './webapp-auth'

const TIME_OUT = 100000

const isAbortError = (error: unknown) => {
  if (typeof error === 'string') return error === 'AbortError' || error.startsWith('AbortError:')

  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  )
}

const shouldNotifyStreamError = (error: unknown) =>
  !isAbortError(error) && !String(error).includes('TypeError: Cannot assign to read only property')

export type IOnDataMoreInfo = {
  event?: string
  conversationId?: string
  taskId?: string
  messageId: string
  errorMessage?: string
  errorCode?: string
}

export type IOnData = (message: string, isFirstMessage: boolean, moreInfo: IOnDataMoreInfo) => void
type IOnThought = (though: ThoughtItem) => void
type IOnFile = (file: VisionFile) => void
type IOnMessageEnd = (messageEnd: MessageEnd) => void
export type IOnMessageReplace = (messageReplace: MessageReplace) => void
export type IOnCompleted = (hasError?: boolean, errorMessage?: string) => void
export type IOnError = (msg: string, code?: string) => void
type UnhandledEventError = {
  conversationId?: string
  errorCode?: string
  errorMessage: string
  messageId?: string
}
type IOnUnhandledEvent = (event: Record<string, unknown>) => UnhandledEventError | void

type IOnWorkflowStarted = (workflowStarted: WorkflowStartedResponse) => void
type IOnWorkflowFinished = (workflowFinished: WorkflowFinishedResponse) => void
type IOnNodeStarted = (nodeStarted: NodeStartedResponse) => void
type IOnNodeFinished = (nodeFinished: NodeFinishedResponse) => void
type IOnIterationStarted = (workflowStarted: IterationStartedResponse) => void
type IOnIterationNext = (workflowStarted: IterationNextResponse) => void
type IOnNodeRetry = (nodeFinished: NodeFinishedResponse) => void
type IOnIterationFinished = (workflowFinished: IterationFinishedResponse) => void
type IOnParallelBranchStarted = (parallelBranchStarted: ParallelBranchStartedResponse) => void
type IOnParallelBranchFinished = (parallelBranchFinished: ParallelBranchFinishedResponse) => void
type IOnTextChunk = (textChunk: TextChunkResponse) => void
type IOnReasoning = (reasoningChunk: ReasoningChunkResponse) => void
type IOnTTSChunk = (messageId: string, audioStr: string, audioType?: string) => void
type IOnTTSEnd = (messageId: string, audioStr: string, audioType?: string) => void
type IOnTextReplace = (textReplace: TextReplaceResponse) => void
type IOnLoopStarted = (workflowStarted: LoopStartedResponse) => void
type IOnLoopNext = (workflowStarted: LoopNextResponse) => void
type IOnLoopFinished = (workflowFinished: LoopFinishedResponse) => void
type IOnAgentLog = (agentLog: AgentLogResponse) => void

type IOHumanInputRequired = (humanInputRequired: HumanInputRequiredResponse) => void
type IOnHumanInputFormFilled = (humanInputFormFilled: HumanInputFormFilledResponse) => void
type IOnHumanInputFormTimeout = (humanInputFormTimeout: HumanInputFormTimeoutResponse) => void
type IOWorkflowPaused = (workflowPaused: WorkflowPausedResponse) => void
type IOnDataSourceNodeProcessing = (
  dataSourceNodeProcessing: DataSourceNodeProcessingResponse,
) => void
type IOnDataSourceNodeCompleted = (dataSourceNodeCompleted: DataSourceNodeCompletedResponse) => void
type IOnDataSourceNodeError = (dataSourceNodeError: DataSourceNodeErrorResponse) => void

export type IOtherOptions = {
  isPublicAPI?: boolean
  isMarketplaceAPI?: boolean
  bodyStringify?: boolean
  needAllResponseContent?: boolean
  deleteContentType?: boolean
  silent?: boolean

  /** If true, behaves like standard fetch: no URL prefix, returns raw Response */
  fetchCompat?: boolean
  request?: Request

  onData?: IOnData // for stream
  onReasoning?: IOnReasoning
  onThought?: IOnThought
  onFile?: IOnFile
  onMessageEnd?: IOnMessageEnd
  onMessageReplace?: IOnMessageReplace
  onError?: IOnError
  onUnhandledEvent?: IOnUnhandledEvent
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
  onHumanInputRequired?: IOHumanInputRequired
  onHumanInputFormFilled?: IOnHumanInputFormFilled
  onHumanInputFormTimeout?: IOnHumanInputFormTimeout
  onWorkflowPaused?: IOWorkflowPaused

  // Pipeline data source node run
  onDataSourceNodeProcessing?: IOnDataSourceNodeProcessing
  onDataSourceNodeCompleted?: IOnDataSourceNodeCompleted
  onDataSourceNodeError?: IOnDataSourceNodeError

  /**
   * Controls workflow SSE recovery after a rolling-update handoff or an
   * unexpected connection loss. The default console/web reconnect endpoint is
   * used unless a feature owner supplies a more specific, owner-scoped URL.
   */
  workflowStreamReconnect?: false | WorkflowStreamReconnectOptions
}

type WorkflowStreamReconnectOptions = {
  resolveUrl?: (workflowRunId: string) => string | undefined
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
}

function jumpTo(url: string) {
  if (!url || !isClient) return
  const targetPath = new URL(url, window.location.origin).pathname
  if (targetPath === window.location.pathname) return
  window.location.href = url
}

const OAUTH_AUTHORIZE_PATH = '/account/oauth/authorize'
const SIGNIN_PATH = '/signin'

export const buildSigninUrlWithRedirect = (): string => {
  const loginUrl = `${isClient ? window.location.origin : ''}${basePath}/signin`
  if (!isClient) return loginUrl

  const signinPath = `${basePath}${SIGNIN_PATH}`
  if (window.location.pathname === signinPath || window.location.pathname === `${signinPath}/`)
    return loginUrl

  if (window.location.pathname.includes(OAUTH_AUTHORIZE_PATH)) {
    const currentUrl = window.location.href
    return `${loginUrl}?redirect_url=${encodeURIComponent(currentUrl)}`
  }

  const currentTarget = resolveLoginRedirectTarget(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
    { allowSameOriginAbsolute: false },
  )
  if (!currentTarget || currentTarget.kind !== 'internal') return loginUrl

  return `${loginUrl}?redirect_url=${encodeURIComponent(currentTarget.href)}`
}

function unicodeToChar(text: string) {
  if (!text) return ''

  return text.replace(/\\u([0-9a-f]{4})/g, (_match, p1) => {
    return String.fromCharCode(Number.parseInt(p1, 16))
  })
}

const WBB_APP_LOGIN_PATH = '/webapp-signin'

export function isWebAppSigninPath(pathname: string) {
  const basePathSegment = basePath.replace(/^\/+|\/+$/g, '')
  const signinPath = `${basePathSegment ? `/${basePathSegment}` : ''}${WBB_APP_LOGIN_PATH}`
  return pathname === signinPath || pathname === `${signinPath}/`
}

export function buildWebAppSigninUrlWithRedirect(
  origin: string,
  pathname: string,
  search: string,
  message?: string,
  code?: number,
) {
  const params = new URLSearchParams()
  params.set('redirect_url', `${pathname}${search}`)
  if (message) params.set('message', message)
  if (code) params.set('code', String(code))

  return `${origin}${basePath}${WBB_APP_LOGIN_PATH}?${params.toString()}`
}

function requiredWebSSOLogin(message?: string, code?: number) {
  if (!isClient) return

  // prevent redirect loop
  if (isWebAppSigninPath(window.location.pathname)) return

  window.location.href = buildWebAppSigninUrlWithRedirect(
    window.location.origin,
    window.location.pathname,
    window.location.search,
    message,
    code,
  )
}

function formatURL(url: string, isPublicAPI: boolean) {
  const urlPrefix = isPublicAPI ? PUBLIC_API_PREFIX : API_PREFIX
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  const urlWithoutProtocol = url.startsWith('/') ? url : `/${url}`
  return `${urlPrefix}${urlWithoutProtocol}`
}

const WORKFLOW_MAINTENANCE_PAUSED_EVENT = 'workflow_maintenance_paused'
const WORKFLOW_RUN_ID_HEADER = 'X-Workflow-Run-ID'
const MAX_TRACKED_EVENT_IDS = 4096

type WorkflowStreamSession = {
  workflowRunId?: string
  confirmedWorkflowRunId: boolean
  cursor?: string
  seenEventIds: Set<string>
  seenEventIdOrder: string[]
  seenLifecycleEvents: Set<string>
  seenLifecycleEventOrder: string[]
  hasMessageChunk: boolean
  expectsMessageEnd: boolean
  hasMessageEnd: boolean
  hasWorkflowFinished: boolean
  waitingAfterWorkflowPause: boolean
  activeContinueOnPauseRequest: boolean
  terminal: boolean
  completionNotified: boolean
  dispatchedEventCount: number
}

type StreamEventPayload = Record<string, unknown> & {
  event?: string
  status?: number
  message?: string
  code?: string
  answer?: string
  workflow_run_id?: string
  conversation_id?: string
  task_id?: string
  message_id?: string
  id?: string
  audio?: string
  audio_type?: string
  data?: Record<string, unknown>
}

type StreamOutcome =
  | { kind: 'eof' }
  | { kind: 'maintenance-paused' }
  | { kind: 'workflow-paused' }
  | { kind: 'application-error'; message: string; code?: string }
  | { kind: 'read-error'; error: unknown }

type ParsedEventResult =
  | { kind: 'continue' }
  | { kind: 'maintenance-paused' }
  | { kind: 'workflow-paused' }
  | { kind: 'application-error'; message: string; code?: string }

const workflowStreamSessions = new Map<string, WorkflowStreamSession>()

const createWorkflowStreamSession = (): WorkflowStreamSession => ({
  confirmedWorkflowRunId: false,
  seenEventIds: new Set(),
  seenEventIdOrder: [],
  seenLifecycleEvents: new Set(),
  seenLifecycleEventOrder: [],
  hasMessageChunk: false,
  expectsMessageEnd: false,
  hasMessageEnd: false,
  hasWorkflowFinished: false,
  waitingAfterWorkflowPause: false,
  activeContinueOnPauseRequest: false,
  terminal: false,
  completionNotified: false,
  dispatchedEventCount: 0,
})

const bindWorkflowRunId = (
  session: WorkflowStreamSession,
  workflowRunId?: string,
  confirmed = false,
) => {
  if (!workflowRunId || (session.workflowRunId && session.workflowRunId !== workflowRunId)) return
  session.workflowRunId = workflowRunId
  if (confirmed) session.confirmedWorkflowRunId = true
  workflowStreamSessions.set(workflowRunId, session)
}

const getWorkflowRunId = (event: StreamEventPayload) => {
  if (typeof event.workflow_run_id === 'string') return event.workflow_run_id
  if (typeof event.data?.workflow_run_id === 'string') return event.data.workflow_run_id
  if (
    (event.event === 'workflow_started' || event.event === 'workflow_finished') &&
    typeof event.data?.id === 'string'
  )
    return event.data.id
}

const getLifecycleEventKey = (event: StreamEventPayload) => {
  const workflowRunId = getWorkflowRunId(event) ?? ''
  switch (event.event) {
    case 'workflow_started':
      return `${event.event}:${workflowRunId}:${event.task_id ?? ''}`
    case 'workflow_finished':
      return `${event.event}:${workflowRunId}`
    case 'workflow_paused':
      return `${event.event}:${workflowRunId}:${event.task_id ?? ''}:${JSON.stringify(event.data?.paused_nodes ?? [])}:${JSON.stringify(event.data?.reasons ?? [])}`
    case 'message_end':
      return `${event.event}:${event.id ?? event.message_id ?? ''}:${workflowRunId}`
    case 'message_replace':
      return `${event.event}:${workflowRunId}:${event.message_id ?? event.id ?? ''}:${event.answer ?? ''}`
    case 'text_replace':
      return `${event.event}:${workflowRunId}:${String(event.data?.text ?? '')}`
    case 'human_input_required':
    case 'human_input_form_filled':
    case 'human_input_form_timeout':
      return event.data?.form_id || event.data?.node_id
        ? `${event.event}:${workflowRunId}:${event.data?.form_id ?? event.data?.node_id}`
        : undefined
    case 'node_started':
    case 'node_finished':
    case 'iteration_started':
    case 'iteration_completed':
    case 'loop_started':
    case 'loop_completed':
      return event.data?.id ? `${event.event}:${event.data.id}` : undefined
    case 'parallel_branch_started':
    case 'parallel_branch_finished':
      return event.data?.id || event.data?.parallel_id
        ? `${event.event}:${event.data?.id ?? event.data?.parallel_id}`
        : undefined
    default:
      return undefined
  }
}

const dispatchStreamEvent = (
  bufferObj: StreamEventPayload,
  eventId: string | undefined,
  callbacks: IOtherOptions,
  session: WorkflowStreamSession,
): ParsedEventResult => {
  if (eventId !== undefined) {
    session.cursor = eventId
    if (session.seenEventIds.has(eventId)) return { kind: 'continue' }
    session.seenEventIds.add(eventId)
    session.seenEventIdOrder.push(eventId)
    if (session.seenEventIdOrder.length > MAX_TRACKED_EVENT_IDS) {
      const oldestEventId = session.seenEventIdOrder.shift()
      if (oldestEventId !== undefined) session.seenEventIds.delete(oldestEventId)
    }
  }

  if (!bufferObj || typeof bufferObj !== 'object') {
    callbacks.onData?.('', !session.hasMessageChunk, {
      conversationId: undefined,
      messageId: '',
      errorMessage: 'Invalid response data',
      errorCode: 'invalid_data',
    })
    return { kind: 'application-error', message: 'Invalid response data', code: 'invalid_data' }
  }

  bindWorkflowRunId(session, getWorkflowRunId(bufferObj), true)

  const hasErrorStatus = typeof bufferObj.status === 'number' && bufferObj.status >= 400
  if (bufferObj.event === 'error' || hasErrorStatus || !bufferObj.event) {
    const message =
      typeof bufferObj.message === 'string' ? bufferObj.message : 'Invalid response data'
    const code = typeof bufferObj.code === 'string' ? bufferObj.code : undefined
    callbacks.onData?.('', false, {
      conversationId: undefined,
      messageId: '',
      errorMessage: message,
      errorCode: code,
    })
    session.terminal = true
    return { kind: 'application-error', message, code }
  }

  if (bufferObj.event === WORKFLOW_MAINTENANCE_PAUSED_EVENT) return { kind: 'maintenance-paused' }

  session.waitingAfterWorkflowPause = bufferObj.event === 'workflow_paused'

  if (
    bufferObj.event === 'message' ||
    bufferObj.event === 'agent_message' ||
    bufferObj.event === 'message_replace' ||
    bufferObj.event === 'message_end' ||
    (bufferObj.event === 'workflow_started' && (bufferObj.message_id || bufferObj.conversation_id))
  )
    session.expectsMessageEnd = true

  if (bufferObj.event === 'message_end') session.hasMessageEnd = true
  if (bufferObj.event === 'workflow_finished') session.hasWorkflowFinished = true
  session.terminal =
    session.hasWorkflowFinished && (!session.expectsMessageEnd || session.hasMessageEnd)

  const lifecycleEventKey = getLifecycleEventKey(bufferObj)
  if (lifecycleEventKey) {
    if (session.seenLifecycleEvents.has(lifecycleEventKey)) return { kind: 'continue' }
    session.seenLifecycleEvents.add(lifecycleEventKey)
    session.seenLifecycleEventOrder.push(lifecycleEventKey)
    if (session.seenLifecycleEventOrder.length > MAX_TRACKED_EVENT_IDS) {
      const oldestLifecycleEventKey = session.seenLifecycleEventOrder.shift()
      if (oldestLifecycleEventKey !== undefined)
        session.seenLifecycleEvents.delete(oldestLifecycleEventKey)
    }
  }

  session.dispatchedEventCount += 1

  if (bufferObj.event === 'message' || bufferObj.event === 'agent_message') {
    callbacks.onData?.(unicodeToChar(bufferObj.answer ?? ''), !session.hasMessageChunk, {
      event: bufferObj.event,
      conversationId: bufferObj.conversation_id,
      taskId: bufferObj.task_id,
      messageId: bufferObj.id ?? '',
    })
    session.hasMessageChunk = true
  } else if (bufferObj.event === 'agent_thought') {
    callbacks.onThought?.(bufferObj as ThoughtItem)
  } else if (bufferObj.event === 'message_file') {
    callbacks.onFile?.(bufferObj as VisionFile)
  } else if (bufferObj.event === 'message_end') {
    callbacks.onMessageEnd?.(bufferObj as MessageEnd)
  } else if (bufferObj.event === 'message_replace') {
    callbacks.onMessageReplace?.(bufferObj as MessageReplace)
  } else if (bufferObj.event === 'workflow_started') {
    callbacks.onWorkflowStarted?.(bufferObj as WorkflowStartedResponse)
  } else if (bufferObj.event === 'workflow_finished') {
    callbacks.onWorkflowFinished?.(bufferObj as WorkflowFinishedResponse)
  } else if (bufferObj.event === 'node_started') {
    callbacks.onNodeStarted?.(bufferObj as NodeStartedResponse)
  } else if (bufferObj.event === 'node_finished') {
    callbacks.onNodeFinished?.(bufferObj as NodeFinishedResponse)
  } else if (bufferObj.event === 'iteration_started') {
    callbacks.onIterationStart?.(bufferObj as IterationStartedResponse)
  } else if (bufferObj.event === 'iteration_next') {
    callbacks.onIterationNext?.(bufferObj as IterationNextResponse)
  } else if (bufferObj.event === 'iteration_completed') {
    callbacks.onIterationFinish?.(bufferObj as IterationFinishedResponse)
  } else if (bufferObj.event === 'loop_started') {
    callbacks.onLoopStart?.(bufferObj as LoopStartedResponse)
  } else if (bufferObj.event === 'loop_next') {
    callbacks.onLoopNext?.(bufferObj as LoopNextResponse)
  } else if (bufferObj.event === 'loop_completed') {
    callbacks.onLoopFinish?.(bufferObj as LoopFinishedResponse)
  } else if (bufferObj.event === 'node_retry') {
    callbacks.onNodeRetry?.(bufferObj as NodeFinishedResponse)
  } else if (bufferObj.event === 'parallel_branch_started') {
    callbacks.onParallelBranchStarted?.(bufferObj as ParallelBranchStartedResponse)
  } else if (bufferObj.event === 'parallel_branch_finished') {
    callbacks.onParallelBranchFinished?.(bufferObj as ParallelBranchFinishedResponse)
  } else if (bufferObj.event === 'text_chunk') {
    callbacks.onTextChunk?.(bufferObj as TextChunkResponse)
  } else if (bufferObj.event === 'reasoning_chunk') {
    callbacks.onReasoning?.(bufferObj as ReasoningChunkResponse)
  } else if (bufferObj.event === 'text_replace') {
    callbacks.onTextReplace?.(bufferObj as TextReplaceResponse)
  } else if (bufferObj.event === 'agent_log') {
    callbacks.onAgentLog?.(bufferObj as AgentLogResponse)
  } else if (bufferObj.event === 'tts_message') {
    callbacks.onTTSChunk?.(bufferObj.message_id ?? '', bufferObj.audio ?? '', bufferObj.audio_type)
  } else if (bufferObj.event === 'tts_message_end') {
    callbacks.onTTSEnd?.(bufferObj.message_id ?? '', bufferObj.audio ?? '')
  } else if (bufferObj.event === 'human_input_required') {
    callbacks.onHumanInputRequired?.(bufferObj as HumanInputRequiredResponse)
  } else if (bufferObj.event === 'human_input_form_filled') {
    callbacks.onHumanInputFormFilled?.(bufferObj as HumanInputFormFilledResponse)
  } else if (bufferObj.event === 'human_input_form_timeout') {
    callbacks.onHumanInputFormTimeout?.(bufferObj as HumanInputFormTimeoutResponse)
  } else if (bufferObj.event === 'workflow_paused') {
    callbacks.onWorkflowPaused?.(bufferObj as WorkflowPausedResponse)
  } else if (bufferObj.event === 'datasource_processing') {
    callbacks.onDataSourceNodeProcessing?.(bufferObj as DataSourceNodeProcessingResponse)
  } else if (bufferObj.event === 'datasource_completed') {
    callbacks.onDataSourceNodeCompleted?.(bufferObj as DataSourceNodeCompletedResponse)
  } else if (bufferObj.event === 'datasource_error') {
    callbacks.onDataSourceNodeError?.(bufferObj as DataSourceNodeErrorResponse)
  } else {
    const unhandledEventError = callbacks.onUnhandledEvent?.(bufferObj)
    if (unhandledEventError) {
      callbacks.onData?.('', false, {
        conversationId: unhandledEventError.conversationId,
        messageId: unhandledEventError.messageId ?? '',
        errorMessage: unhandledEventError.errorMessage,
        errorCode: unhandledEventError.errorCode,
      })
      return {
        kind: 'application-error',
        message: unhandledEventError.errorMessage,
        code: unhandledEventError.errorCode,
      }
    }
    console.warn(`Unknown event: ${bufferObj.event}`, bufferObj)
  }

  return bufferObj.event === 'workflow_paused' ? { kind: 'workflow-paused' } : { kind: 'continue' }
}

const consumeEventStream = async (
  response: Response,
  callbacks: IOtherOptions,
  session: WorkflowStreamSession,
): Promise<StreamOutcome> => {
  const reader = response.body?.getReader()
  if (!reader) return { kind: 'eof' }

  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let eventId: string | undefined
  let dataLines: string[] = []
  let sawWorkflowPause = false

  const dispatchFrame = (): ParsedEventResult => {
    if (dataLines.length === 0) {
      eventId = undefined
      return { kind: 'continue' }
    }

    const data = dataLines.join('\n')
    dataLines = []
    const currentEventId = eventId
    eventId = undefined

    let parsedEvent: StreamEventPayload
    try {
      parsedEvent = JSON.parse(data) as StreamEventPayload
    } catch {
      callbacks.onData?.('', !session.hasMessageChunk, {
        conversationId: undefined,
        messageId: '',
      })
      return { kind: 'continue' }
    }

    return dispatchStreamEvent(parsedEvent, currentEventId, callbacks, session)
  }

  const processLine = (line: string): ParsedEventResult => {
    if (line === '') return dispatchFrame()
    if (line.startsWith(':')) return { kind: 'continue' }

    const separatorIndex = line.indexOf(':')
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex)
    let value = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'id' && !value.includes('\0')) eventId = value
    else if (field === 'data') dataLines.push(value)

    return { kind: 'continue' }
  }

  try {
    while (true) {
      const result = await reader.read()
      if (result.done) {
        buffer += decoder.decode()
        if (buffer) {
          const finalResult = processLine(buffer.replace(/\r$/, ''))
          if (finalResult.kind !== 'continue') return finalResult
        }
        const finalResult = dispatchFrame()
        if (finalResult.kind === 'workflow-paused') return finalResult
        if (finalResult.kind !== 'continue') return finalResult
        return sawWorkflowPause ? { kind: 'workflow-paused' } : { kind: 'eof' }
      }

      buffer += decoder.decode(result.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const parsedResult = processLine(rawLine.replace(/\r$/, ''))
        if (parsedResult.kind === 'maintenance-paused') {
          await reader.cancel().catch(() => undefined)
          return parsedResult
        }
        if (parsedResult.kind === 'application-error') {
          await reader.cancel().catch(() => undefined)
          return parsedResult
        }
        if (parsedResult.kind === 'workflow-paused') sawWorkflowPause = true
      }
    }
  } catch (error) {
    return { kind: 'read-error', error }
  }
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

export const upload = async (
  options: UploadOptions,
  isPublicAPI?: boolean,
  url?: string,
  searchParams?: string,
): Promise<UploadResponse> => {
  const urlPrefix = isPublicAPI ? PUBLIC_API_PREFIX : API_PREFIX
  const shareCode = globalThis.location.pathname.split('/').slice(-1)[0]
  const defaultOptions = {
    method: 'POST',
    url: (url ? `${urlPrefix}${url}` : `${urlPrefix}/files/upload`) + (searchParams || ''),
    headers: {
      [CSRF_HEADER_NAME]: Cookies.get(CSRF_COOKIE_NAME()) || '',
      [PASSPORT_HEADER_NAME]: getWebAppPassport(shareCode!),
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
    for (const key in mergedOptions.headers) xhr.setRequestHeader(key, mergedOptions.headers[key]!)

    xhr.withCredentials = true
    xhr.responseType = 'json'
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status === 201) resolve(xhr.response)
        else reject(xhr)
      }
    }
    if (mergedOptions.onprogress) xhr.upload.onprogress = mergedOptions.onprogress
    xhr.send(mergedOptions.data)
  })
}

const DEFAULT_RECONNECT_ATTEMPTS = 12
const DEFAULT_RECONNECT_INITIAL_DELAY = 250
const DEFAULT_RECONNECT_MAX_DELAY = 5000

const extractWorkflowRunIdFromEventsUrl = (url: string) => {
  const match = url.match(/\/workflow\/([^/?]+)\/events(?:[/?]|$)/)
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

const addReconnectSearchParams = (
  url: string,
  cursor?: string,
  includeStateSnapshot = true,
  continueOnPause = false,
) => {
  const isAbsolute = /^https?:\/\//.test(url)
  const parsedUrl = new URL(url, 'http://dify.local')
  parsedUrl.searchParams.set('include_state_snapshot', String(includeStateSnapshot))
  if (continueOnPause) parsedUrl.searchParams.set('continue_on_pause', 'true')
  else parsedUrl.searchParams.delete('continue_on_pause')
  if (cursor) parsedUrl.searchParams.set('cursor', cursor)
  else parsedUrl.searchParams.delete('cursor')
  if (isAbsolute) return parsedUrl.toString()
  return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`
}

const parseRetryAfter = (response: Response) => {
  const retryAfter = response.headers.get('Retry-After')
  if (!retryAfter) return undefined
  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const retryAt = Date.parse(retryAfter)
  if (Number.isNaN(retryAt)) return undefined
  return Math.max(0, retryAt - Date.now())
}

const waitForReconnect = (delay: number, signal: AbortSignal) =>
  new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false)
      return
    }

    let timeoutId: ReturnType<typeof globalThis.setTimeout>
    const handleAbort = () => {
      globalThis.clearTimeout(timeoutId)
      resolve(false)
    }
    timeoutId = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort)
      resolve(true)
    }, delay)
    signal.addEventListener('abort', handleAbort, { once: true })
  })

const createSseRequestOptions = (
  method: 'GET' | 'POST',
  fetchOptions: FetchOptionType,
  abortController: AbortController,
  cursor?: string,
) => {
  const baseOptions = getBaseOptions()
  const shareCode = globalThis.location.pathname.split('/').slice(-1)[0]!
  const options = Object.assign({}, baseOptions, fetchOptions, {
    method,
    signal: abortController.signal,
  }) as RequestInit & { body?: BodyInit | Record<string, unknown> | null }
  const headers = new Headers(options.headers)
  if (!headers.has(CSRF_HEADER_NAME))
    headers.set(CSRF_HEADER_NAME, Cookies.get(CSRF_COOKIE_NAME()) || '')
  if (!headers.has(WEB_APP_SHARE_CODE_HEADER_NAME))
    headers.set(WEB_APP_SHARE_CODE_HEADER_NAME, shareCode)
  if (!headers.has(PASSPORT_HEADER_NAME))
    headers.set(PASSPORT_HEADER_NAME, getWebAppPassport(shareCode))
  if (!headers.has('Content-Type')) headers.set('Content-Type', ContentType.json)
  if (cursor) headers.set('Last-Event-ID', cursor)
  options.headers = headers

  if (method === 'POST' && options.body && typeof options.body !== 'string')
    options.body = JSON.stringify(options.body)
  if (method === 'GET') delete options.body

  return options as RequestInit
}

const createStreamCallbacks = (otherOptions: IOtherOptions): IOtherOptions => ({
  ...otherOptions,
  onData: (message, isFirstMessage, moreInfo) => {
    if (moreInfo.errorMessage) {
      otherOptions.onError?.(moreInfo.errorMessage, moreInfo.errorCode)
      if (shouldNotifyStreamError(moreInfo.errorMessage)) toast.error(moreInfo.errorMessage)
      return
    }
    otherOptions.onData?.(message, isFirstMessage, moreInfo)
  },
})

const runSseRequest = async (
  method: 'GET' | 'POST',
  url: string,
  fetchOptions: FetchOptionType,
  otherOptions: IOtherOptions,
  initialResponse?: {
    response: Response
    abortController: AbortController
  },
) => {
  const { isPublicAPI = false, workflowStreamReconnect } = otherOptions
  const reconnectOptions = workflowStreamReconnect === false ? undefined : workflowStreamReconnect
  const reconnectEnabled = workflowStreamReconnect !== false
  const responseWorkflowRunId = initialResponse?.response.headers
    ?.get(WORKFLOW_RUN_ID_HEADER)
    ?.trim()
  const initialWorkflowRunId =
    responseWorkflowRunId || (method === 'GET' ? extractWorkflowRunIdFromEventsUrl(url) : undefined)
  const session =
    (initialWorkflowRunId && workflowStreamSessions.get(initialWorkflowRunId)) ||
    createWorkflowStreamSession()
  bindWorkflowRunId(session, initialWorkflowRunId, Boolean(responseWorkflowRunId))

  const isContinueOnPauseRequest = method === 'GET' && session.waitingAfterWorkflowPause
  if (isContinueOnPauseRequest && session.activeContinueOnPauseRequest) return

  const abortController = initialResponse?.abortController ?? new AbortController()
  otherOptions.getAbortController?.(abortController)
  const callbacks = createStreamCallbacks(otherOptions)
  if (isContinueOnPauseRequest) session.activeContinueOnPauseRequest = true
  const maxAttempts = reconnectOptions?.maxAttempts ?? DEFAULT_RECONNECT_ATTEMPTS
  const initialDelay = reconnectOptions?.initialDelayMs ?? DEFAULT_RECONNECT_INITIAL_DELAY
  const maxDelay = reconnectOptions?.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY
  let currentMethod = method
  let currentUrl = url
  let reconnectAttempts = 0
  let retryDelayOverride: number | undefined
  let canRefreshAccessToken = true
  let pendingResponse = initialResponse?.response

  const cleanupSession = () => {
    if (isContinueOnPauseRequest) session.activeContinueOnPauseRequest = false
    if (session.workflowRunId && workflowStreamSessions.get(session.workflowRunId) === session)
      workflowStreamSessions.delete(session.workflowRunId)
  }

  const finishWithError = (error: unknown, code?: string, complete = false) => {
    if (session.completionNotified) return
    session.completionNotified = true
    const errorMessage = String(error)
    if (shouldNotifyStreamError(error)) toast.error(errorMessage)
    if (code) otherOptions.onError?.(errorMessage, code)
    else otherOptions.onError?.(errorMessage)
    if (complete) otherOptions.onCompleted?.(true, errorMessage)
    cleanupSession()
  }

  const getReconnectUrl = () => {
    if (!reconnectEnabled || !session.workflowRunId) return undefined
    const resolvedUrl = reconnectOptions?.resolveUrl
      ? reconnectOptions.resolveUrl(session.workflowRunId)
      : `/workflow/${session.workflowRunId}/events`
    return resolvedUrl
      ? addReconnectSearchParams(
          resolvedUrl,
          session.cursor,
          !session.waitingAfterWorkflowPause || Boolean(session.cursor),
          isContinueOnPauseRequest || session.waitingAfterWorkflowPause,
        )
      : undefined
  }

  const prepareReconnect = async (immediate = false) => {
    const reconnectUrl = getReconnectUrl()
    if (!reconnectUrl || reconnectAttempts >= maxAttempts) return false

    const delay = immediate
      ? 0
      : (retryDelayOverride ?? Math.min(initialDelay * 2 ** reconnectAttempts, maxDelay))
    retryDelayOverride = undefined
    reconnectAttempts += 1
    if (delay > 0 && !(await waitForReconnect(delay, abortController.signal))) return false
    if (abortController.signal.aborted) return false

    currentMethod = 'GET'
    currentUrl = reconnectUrl
    return true
  }

  while (!abortController.signal.aborted) {
    const requestUrl =
      currentMethod === 'GET' && session.workflowRunId
        ? addReconnectSearchParams(
            currentUrl,
            session.cursor,
            !session.waitingAfterWorkflowPause || Boolean(session.cursor),
            isContinueOnPauseRequest || session.waitingAfterWorkflowPause,
          )
        : currentUrl
    const requestOptions = createSseRequestOptions(
      currentMethod,
      fetchOptions,
      abortController,
      currentMethod === 'GET' ? session.cursor : undefined,
    )

    let response = pendingResponse
    pendingResponse = undefined
    if (!response) {
      try {
        response = await globalThis.fetch(formatURL(requestUrl, isPublicAPI), requestOptions)
      } catch (error) {
        if (abortController.signal.aborted) {
          cleanupSession()
          return
        }
        if (session.workflowRunId && (await prepareReconnect())) continue
        finishWithError(error, session.workflowRunId ? 'stream_reconnect_exhausted' : undefined)
        return
      }
    }

    bindWorkflowRunId(
      session,
      response.headers?.get(WORKFLOW_RUN_ID_HEADER) || undefined,
      Boolean(response.headers?.get(WORKFLOW_RUN_ID_HEADER)),
    )

    if (response.status === 202 && session.workflowRunId) {
      retryDelayOverride = parseRetryAfter(response)
      if (await prepareReconnect()) continue
      finishWithError('Workflow stream reconnect timed out', 'stream_reconnect_exhausted', true)
      return
    }

    if (!/^[23]\d{2}$/.test(String(response.status))) {
      if (response.status === 401) {
        if (isPublicAPI) {
          const data = (await response.json().catch(() => ({}))) as {
            code?: string
            message?: string
          }
          if (data.code === 'web_app_access_denied') requiredWebSSOLogin(data.message, 403)
          if (data.code === 'web_sso_auth_required' || data.code === 'unauthorized')
            requiredWebSSOLogin()
          cleanupSession()
          return
        }
        if (canRefreshAccessToken) {
          canRefreshAccessToken = false
          try {
            await refreshAccessTokenOrReLogin(TIME_OUT)
            continue
          } catch (error) {
            console.error(error)
            otherOptions.onError?.(String(error))
            cleanupSession()
            return
          }
        }
      }

      const isRetryableStatus = [404, 408, 409, 425, 429, 500, 502, 503, 504].includes(
        response.status,
      )
      if (
        session.workflowRunId &&
        isRetryableStatus &&
        (response.status !== 404 || session.confirmedWorkflowRunId)
      ) {
        retryDelayOverride = parseRetryAfter(response)
        if (await prepareReconnect()) continue
      }

      const data = (await response.json().catch(() => ({}))) as { message?: string }
      toast.error(data.message || 'Server Error')
      otherOptions.onError?.('Server Error')
      cleanupSession()
      return
    }

    canRefreshAccessToken = true
    const eventCountBeforeRequest = session.dispatchedEventCount
    const outcome = await consumeEventStream(response, callbacks, session)
    if (session.dispatchedEventCount > eventCountBeforeRequest) reconnectAttempts = 0
    if (abortController.signal.aborted) {
      cleanupSession()
      return
    }

    if (outcome.kind === 'application-error') {
      if (!session.completionNotified) {
        session.completionNotified = true
        otherOptions.onCompleted?.(true, outcome.message)
      }
      cleanupSession()
      return
    }

    if (outcome.kind === 'workflow-paused' && !isContinueOnPauseRequest) {
      if (!session.activeContinueOnPauseRequest) cleanupSession()
      return
    }

    if (session.terminal) {
      if (!session.completionNotified) {
        session.completionNotified = true
        otherOptions.onCompleted?.()
      }
      cleanupSession()
      return
    }

    if (outcome.kind === 'maintenance-paused') {
      if (await prepareReconnect(true)) continue
      finishWithError(
        'Workflow stream reconnect is unavailable',
        'stream_reconnect_unavailable',
        true,
      )
      return
    }

    if (outcome.kind === 'read-error') {
      if (session.workflowRunId && (await prepareReconnect())) continue
      finishWithError(outcome.error, 'stream_read_error', true)
      return
    }

    if (session.workflowRunId) {
      if (await prepareReconnect()) continue
      finishWithError('Workflow stream reconnect timed out', 'stream_reconnect_exhausted', true)
      return
    }

    otherOptions.onCompleted?.()
    return
  }

  cleanupSession()
}

export const ssePost = (url: string, fetchOptions: FetchOptionType, otherOptions: IOtherOptions) =>
  runSseRequest('POST', url, fetchOptions, otherOptions)

export const sseGet = (url: string, fetchOptions: FetchOptionType, otherOptions: IOtherOptions) =>
  runSseRequest('GET', url, fetchOptions, otherOptions)

/**
 * Consume an SSE response obtained by a caller that must inspect a preliminary
 * JSON polling response first (for example trigger debugging). Once a stable
 * workflow run id is available, the same bounded cursor-based recovery used by
 * `ssePost` and `sseGet` takes over.
 */
export const handleSseResponse = (
  response: Response,
  otherOptions: IOtherOptions,
  abortController: AbortController,
) =>
  runSseRequest('POST', '', {}, otherOptions, {
    response,
    abortController,
  })

export type GeneratorStreamCallbacks = {
  /** Fired once when the planner stage finishes — carries the high-level plan. */
  onPlan?: (data: Record<string, unknown>) => void
  /** Fired once when the builder + validation finish — carries the final graph envelope. */
  onResult?: (data: Record<string, unknown>) => void
  onError?: (message: string) => void
  onCompleted?: () => void
  getAbortController?: (abortController: AbortController) => void
}

/**
 * Dedicated SSE consumer for the workflow generator's plan-first stream
 * (`/workflow-generate/stream`). Kept separate from ``ssePost`` / ``sseGet``
 * on purpose: those are wired to the chat / workflow-run event
 * vocabulary (``message``, ``node_finished``, …) and threading two more
 * positional callbacks through that shared, high-blast-radius path isn't worth
 * it. This helper reuses the same cookie-auth + CSRF + abort setup but
 * only understands the generator's two events: ``plan`` then ``result``.
 */
export const sseGeneratorPost = (
  url: string,
  body: unknown,
  { onPlan, onResult, onError, onCompleted, getAbortController }: GeneratorStreamCallbacks,
) => {
  const abortController = new AbortController()
  const baseOptions = getBaseOptions()
  const options = Object.assign({}, baseOptions, {
    method: 'POST',
    signal: abortController.signal,
    headers: new Headers({
      [CSRF_HEADER_NAME]: Cookies.get(CSRF_COOKIE_NAME())! || '',
      'Content-Type': ContentType.json,
    }),
    body: JSON.stringify(body),
  } as RequestInit)

  getAbortController?.(abortController)

  const urlWithPrefix = formatURL(url, false)

  const fail = (e: unknown) => {
    // Aborts are intentional (modal close / regenerate) — never surface them.
    if (e instanceof Error && e.name === 'AbortError') return
    onError?.(`${e}`)
  }

  globalThis
    .fetch(urlWithPrefix, options as RequestInit)
    .then((res) => {
      if (!/^[23]\d{2}$/.test(String(res.status))) {
        if (res.status === 401) {
          refreshAccessTokenOrReLogin(TIME_OUT)
            .then(() =>
              sseGeneratorPost(url, body, {
                onPlan,
                onResult,
                onError,
                onCompleted,
                getAbortController,
              }),
            )
            .catch(() => onError?.('Unauthorized'))
          return
        }
        res
          .json()
          .then((data: { message?: string }) => onError?.(data?.message || 'Server Error'))
          .catch(() => onError?.('Server Error'))
        return
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      const read = () => {
        reader
          ?.read()
          .then(({ done, value }) => {
            if (done) {
              onCompleted?.()
              return
            }
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            // Process every complete line; keep the trailing partial in the buffer.
            lines.slice(0, -1).forEach((message) => {
              if (!message.startsWith('data: ')) return
              let obj: Record<string, unknown>
              try {
                obj = JSON.parse(message.slice(6))
              } catch {
                // A chunk boundary split the JSON — it'll re-arrive intact next read.
                return
              }
              if (obj.event === 'plan') onPlan?.(obj)
              else if (obj.event === 'result') onResult?.(obj)
            })
            buffer = lines[lines.length - 1] || ''
            read()
          })
          .catch(fail)
      }
      read()
    })
    .catch(fail)
}

// base request
export const request = async <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  try {
    const otherOptionsForBaseFetch = otherOptions || {}
    const [err, resp] = await asyncRunSafe<T>(baseFetch(url, options, otherOptionsForBaseFetch))
    if (err === null) return resp
    const errResp: Response = err as any
    if (errResp.status === 401) {
      if (!isClient) return Promise.reject(err)

      const [parseErr, errRespData] = await asyncRunSafe<ResponseError>(errResp.json())
      if (parseErr) {
        window.location.href = buildSigninUrlWithRedirect()
        return Promise.reject(err)
      }
      if (/\/login/.test(url)) return Promise.reject(errRespData)
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
        window.location.reload()
        return Promise.reject(err)
      }
      const { isPublicAPI = false, silent } = otherOptionsForBaseFetch
      if (isPublicAPI && code === 'unauthorized') {
        requiredWebSSOLogin()
        return Promise.reject(err)
      }
      if (code === 'init_validate_failed' && !silent) {
        toast.error(message, { timeout: 4000 })
        return Promise.reject(err)
      }
      if (code === 'not_init_validated') {
        jumpTo(`${window.location.origin}${basePath}/init`)
        return Promise.reject(err)
      }
      if (code === 'not_setup') {
        jumpTo(`${window.location.origin}${basePath}/install`)
        return Promise.reject(err)
      }

      // refresh token
      const [refreshErr] = await asyncRunSafe(refreshAccessTokenOrReLogin(TIME_OUT))
      if (refreshErr === null) return baseFetch<T>(url, options, otherOptionsForBaseFetch)
      // /device is the device-flow chooser; logged-out is a valid state
      // there. Redirecting to /signin loses the user_code context and
      // the post-login flow lands on /apps instead of returning here.
      if (window.location.pathname === `${basePath}/device`) return Promise.reject(err)
      if (window.location.pathname !== `${basePath}/signin`) {
        jumpTo(buildSigninUrlWithRedirect())
        return Promise.reject(err)
      }
      if (!silent) {
        toast.error(message)
        return Promise.reject(err)
      }
      jumpTo(buildSigninUrlWithRedirect())
      return Promise.reject(err)
    } else {
      return Promise.reject(err)
    }
  } catch (error) {
    console.error(error)
    return Promise.reject(error)
  }
}

// request methods
/**
 * @deprecated For console JSON APIs, prefer generated contract clients (`consoleClient`/`consoleQuery`)
 * only after the backend OpenAPI schema produces accurate method, path, input, and output types.
 * Keep this helper for endpoints whose generated contract is missing or too loose, and for non-console
 * flows such as public APIs, marketplace APIs, streaming, upload, or download.
 */
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

/**
 * @deprecated For console JSON APIs, prefer generated contract clients (`consoleClient`/`consoleQuery`)
 * only after the backend OpenAPI schema produces accurate method, path, input, and output types.
 * Keep this helper for endpoints whose generated contract is missing or too loose, and for non-console
 * flows such as public APIs, marketplace APIs, streaming, upload, or download.
 */
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

/**
 * @deprecated For console JSON APIs, prefer generated contract clients (`consoleClient`/`consoleQuery`)
 * only after the backend OpenAPI schema produces accurate method, path, input, and output types.
 * Keep this helper for endpoints whose generated contract is missing or too loose, and for non-console
 * flows such as public APIs, marketplace APIs, streaming, upload, or download.
 */
export const put = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return request<T>(url, Object.assign({}, options, { method: 'PUT' }), otherOptions)
}

/**
 * @deprecated For console JSON APIs, prefer generated contract clients (`consoleClient`/`consoleQuery`)
 * only after the backend OpenAPI schema produces accurate method, path, input, and output types.
 * Keep this helper for endpoints whose generated contract is missing or too loose, and for non-console
 * flows such as public APIs, marketplace APIs, streaming, upload, or download.
 */
export const del = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return request<T>(url, Object.assign({}, options, { method: 'DELETE' }), otherOptions)
}

export const delPublic = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return del<T>(url, options, { ...otherOptions, isPublicAPI: true })
}

/**
 * @deprecated For console JSON APIs, prefer generated contract clients (`consoleClient`/`consoleQuery`)
 * only after the backend OpenAPI schema produces accurate method, path, input, and output types.
 * Keep this helper for endpoints whose generated contract is missing or too loose, and for non-console
 * flows such as public APIs, marketplace APIs, streaming, upload, or download.
 */
export const patch = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return request<T>(url, Object.assign({}, options, { method: 'PATCH' }), otherOptions)
}

export const patchPublic = <T>(url: string, options = {}, otherOptions?: IOtherOptions) => {
  return patch<T>(url, options, { ...otherOptions, isPublicAPI: true })
}
