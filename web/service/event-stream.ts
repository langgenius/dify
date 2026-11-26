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
import { ORPCError } from '@orpc/client'
import { toast } from '@/app/notifications'
import { isAppAccessError } from '@/features/app-access-error/state'
import { resolveWebAppAddress } from './webapp-address'

export type IOnDataMoreInfo = {
  event?: string
  conversationId?: string
  taskId?: string
  messageId: string
  errorMessage?: string
  errorCode?: string
}

export type IOnData = (message: string, isFirstMessage: boolean, moreInfo: IOnDataMoreInfo) => void
export type IOnMessageReplace = (messageReplace: MessageReplace) => void
export type IOnCompleted = (hasError?: boolean, errorMessage?: string) => void
export type IOnError = (msg: string, code?: string, identity?: IOnDataMoreInfo) => void

type UnhandledEventError = {
  conversationId?: string
  errorCode?: string
  errorMessage: string
  messageId?: string
}

/** Callbacks for Dify's chat, completion, workflow and pipeline event streams. */
export type StreamCallbacks = {
  /** The request goes to the public WebApp API, whose sign-in errors redirect instead of reporting. */
  isPublicAPI?: boolean
  onData?: IOnData
  onReasoning?: (reasoningChunk: ReasoningChunkResponse) => void
  onThought?: (thought: ThoughtItem) => void
  onFile?: (file: VisionFile) => void
  onMessageEnd?: (messageEnd: MessageEnd) => void
  onMessageReplace?: IOnMessageReplace
  onError?: IOnError
  /** Replaces the default global error notification for this request. */
  onNotifyError?: IOnError
  onUnhandledEvent?: (event: Record<string, unknown>) => UnhandledEventError | void
  onCompleted?: IOnCompleted
  getAbortController?: (abortController: AbortController) => void

  onWorkflowStarted?: (workflowStarted: WorkflowStartedResponse) => void
  onWorkflowFinished?: (workflowFinished: WorkflowFinishedResponse) => void
  onNodeStarted?: (nodeStarted: NodeStartedResponse) => void
  onNodeFinished?: (nodeFinished: NodeFinishedResponse) => void
  onIterationStart?: (iterationStarted: IterationStartedResponse) => void
  onIterationNext?: (iterationNext: IterationNextResponse) => void
  onIterationFinish?: (iterationFinished: IterationFinishedResponse) => void
  onNodeRetry?: (nodeRetry: NodeFinishedResponse) => void
  onParallelBranchStarted?: (parallelBranchStarted: ParallelBranchStartedResponse) => void
  onParallelBranchFinished?: (parallelBranchFinished: ParallelBranchFinishedResponse) => void
  onTextChunk?: (textChunk: TextChunkResponse) => void
  onTTSChunk?: (messageId: string, audioStr: string, audioType?: string) => void
  onTTSEnd?: (messageId: string, audioStr: string) => void
  onTextReplace?: (textReplace: TextReplaceResponse) => void
  onLoopStart?: (loopStarted: LoopStartedResponse) => void
  onLoopNext?: (loopNext: LoopNextResponse) => void
  onLoopFinish?: (loopFinished: LoopFinishedResponse) => void
  onAgentLog?: (agentLog: AgentLogResponse) => void
  onHumanInputRequired?: (humanInputRequired: HumanInputRequiredResponse) => void
  onHumanInputFormFilled?: (humanInputFormFilled: HumanInputFormFilledResponse) => void
  onHumanInputFormTimeout?: (humanInputFormTimeout: HumanInputFormTimeoutResponse) => void
  onWorkflowPaused?: (workflowPaused: WorkflowPausedResponse) => void

  // Pipeline data source node run
  onDataSourceNodeProcessing?: (dataSourceNodeProcessing: DataSourceNodeProcessingResponse) => void
  onDataSourceNodeCompleted?: (dataSourceNodeCompleted: DataSourceNodeCompletedResponse) => void
  onDataSourceNodeError?: (dataSourceNodeError: DataSourceNodeErrorResponse) => void
}

/** Callbacks that take the frame payload as their only argument. */
type PayloadCallbackKey = {
  [K in keyof StreamCallbacks]-?: NonNullable<StreamCallbacks[K]> extends (payload: never) => void
    ? K
    : never
}[keyof StreamCallbacks]

/** Frames whose whole payload is handed to one callback. */
const payloadEvents = {
  agent_thought: 'onThought',
  message_file: 'onFile',
  message_end: 'onMessageEnd',
  message_replace: 'onMessageReplace',
  workflow_started: 'onWorkflowStarted',
  workflow_finished: 'onWorkflowFinished',
  node_started: 'onNodeStarted',
  node_finished: 'onNodeFinished',
  iteration_started: 'onIterationStart',
  iteration_next: 'onIterationNext',
  iteration_completed: 'onIterationFinish',
  loop_started: 'onLoopStart',
  loop_next: 'onLoopNext',
  loop_completed: 'onLoopFinish',
  node_retry: 'onNodeRetry',
  parallel_branch_started: 'onParallelBranchStarted',
  parallel_branch_finished: 'onParallelBranchFinished',
  text_chunk: 'onTextChunk',
  reasoning_chunk: 'onReasoning',
  text_replace: 'onTextReplace',
  agent_log: 'onAgentLog',
  human_input_required: 'onHumanInputRequired',
  human_input_form_filled: 'onHumanInputFormFilled',
  human_input_form_timeout: 'onHumanInputFormTimeout',
  workflow_paused: 'onWorkflowPaused',
  datasource_processing: 'onDataSourceNodeProcessing',
  datasource_completed: 'onDataSourceNodeCompleted',
  datasource_error: 'onDataSourceNodeError',
} as const satisfies Record<string, PayloadCallbackKey>

type PayloadEvents = typeof payloadEvents

/**
 * The request options a stream call must forward to the generated client. `stream` lifts the
 * request layer's time limit on the response headers: a stream sends them with its first frame,
 * which can come minutes later (planning, long LLM or tool runs, queued workflows), so streams
 * end only through the signal, as with the legacy SSE helpers.
 */
export type StreamRequestOptions = {
  signal: AbortSignal
  context: { stream: true }
}

const streamRequestOptions = (signal: AbortSignal): StreamRequestOptions => ({
  signal,
  context: { stream: true },
})

/**
 * Sends the request through a generated client, e.g.
 * `(options) => consoleClient.apps.byAppId.completionMessages.post({ params, body }, options)`.
 * The client decodes a `text/event-stream` response into an async iterator of JSON frames.
 */
export type StreamRequest = (options: StreamRequestOptions) => Promise<unknown>

/**
 * Sends a request body built by the stream's owner (e.g. the chat hook) through a generated
 * client, e.g. `(body, options) => consoleClient.apps.byAppId.chatMessages.post({ params, body }, options)`.
 */
export type StreamSender = (
  body: Record<string, unknown>,
  options: StreamRequestOptions,
) => Promise<unknown>

type Frame = Record<string, unknown>

const isRecord = (value: unknown): value is Frame => typeof value === 'object' && value !== null

/** Frame fields are passed on as the backend sent them, as the legacy parser did. */
const field = (frame: Frame | undefined, key: string) => frame?.[key] as string | undefined

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  isRecord(value) && Symbol.asyncIterator in value

/** A response that is not an event stream is handled as a single frame. */
const toFrames = (value: unknown): AsyncIterable<unknown> | unknown[] =>
  isAsyncIterable(value) ? value : [value]

const isAbortError = (error: unknown) => {
  if (typeof error === 'string') return error === 'AbortError' || error.startsWith('AbortError:')
  return isRecord(error) && error.name === 'AbortError'
}

const shouldNotifyStreamError = (error: unknown) =>
  !isAbortError(error) && !String(error).includes('TypeError: Cannot assign to read only property')

const unicodeToChar = (text: string) => {
  if (!text) return ''
  return text.replace(/\\u([0-9a-f]{4})/gi, (_match, p1: string) =>
    String.fromCharCode(Number.parseInt(p1, 16)),
  )
}

const getErrorBody = (error: ORPCError<string, unknown>) => {
  const data = isRecord(error.data) ? error.data : {}
  return {
    message: typeof data.message === 'string' && data.message ? data.message : 'Server Error',
    code: typeof data.code === 'string' && data.code ? data.code : undefined,
  }
}

/** Sign-in and access errors the request layer answers by redirecting or resetting the passport. */
const isWebAppAuthorizationError = (data: unknown) => {
  if (!isRecord(data)) return false
  if (
    data.code === 'web_app_access_denied' ||
    data.code === 'web_sso_auth_required' ||
    data.code === 'unauthorized' ||
    data.reason === 'APPDEPLOY_WEB_APP_ACCESS_DENIED'
  )
    return true
  return data.reason === 'APPDEPLOY_UNAUTHORIZED' && resolveWebAppAddress()?.kind === 'environment'
}

const notify = (callbacks: StreamCallbacks, message: string, code?: string) => {
  if (callbacks.onNotifyError) callbacks.onNotifyError(message, code)
  else toast.error(message)
}

/** Maps a failed request (before the stream starts) to the callbacks `ssePost` used. */
const handleRequestError = (error: unknown, callbacks: StreamCallbacks) => {
  const { onError, onCompleted } = callbacks
  if (isAppAccessError(error)) {
    // The app-access dialog owns this failure, so it is reported without a toast.
    if (!(error instanceof ORPCError)) {
      onCompleted?.(true, 'The request is no longer active.')
      return
    }
    const { message, code } = getErrorBody(error)
    if (onError) onError(message, code)
    else onCompleted?.(true, message)
    return
  }
  if (error instanceof ORPCError && typeof error.status === 'number') {
    const { message, code } = getErrorBody(error)
    if (callbacks.isPublicAPI && (error.status === 401 || error.status === 403)) {
      // The request layer already sent the user to sign in or reset the WebApp passport.
      if (isWebAppAuthorizationError(error.data)) return
    } else if (error.status === 401) {
      // The request layer already refreshed the session or sent the user to sign in.
      onError?.(message, code)
      return
    }
    onError?.(message, code)
    notify(callbacks, message, code)
    return
  }
  const errorMessage = String(error)
  if (shouldNotifyStreamError(error)) notify(callbacks, errorMessage)
  onError?.(errorMessage)
}

const consumeFrames = async (
  frames: AsyncIterable<unknown> | unknown[],
  callbacks: StreamCallbacks,
) => {
  const { onCompleted, onUnhandledEvent } = callbacks
  let isFirstMessage = true
  let lastFrame: Frame | undefined

  const onData: IOnData = (message, first, moreInfo) => {
    if (moreInfo.errorMessage) {
      callbacks.onError?.(moreInfo.errorMessage, moreInfo.errorCode, moreInfo)
      // These errors can happen when a stream is intentionally stopped or its page is left.
      if (shouldNotifyStreamError(moreInfo.errorMessage))
        notify(callbacks, moreInfo.errorMessage, moreInfo.errorCode)
      return
    }
    callbacks.onData?.(message, first, moreInfo)
  }

  const fail = (moreInfo: IOnDataMoreInfo & { errorMessage: string }) => {
    onData('', false, moreInfo)
    onCompleted?.(true, moreInfo.errorMessage)
  }

  /** Returns false when the frame ends the stream with an error. */
  const dispatch = (frame: unknown): boolean => {
    if (!isRecord(frame)) {
      onData('', isFirstMessage, {
        conversationId: undefined,
        messageId: '',
        errorMessage: 'Invalid response data',
        errorCode: 'invalid_data',
      })
      onCompleted?.(true, 'Invalid response data')
      return false
    }
    lastFrame = frame
    const event: unknown = frame.event
    const hasErrorStatus = typeof frame.status === 'number' && frame.status >= 400
    if (event === 'error' || hasErrorStatus || !event) {
      fail({
        conversationId: field(frame, 'conversation_id'),
        messageId: field(frame, 'message_id') ?? '',
        errorMessage: field(frame, 'message')!,
        errorCode: field(frame, 'code'),
      })
      return false
    }
    if (event === 'message' || event === 'agent_message') {
      // Answers arrive split across frames, so they are passed on without formatting.
      onData(unicodeToChar(field(frame, 'answer')!), isFirstMessage, {
        event,
        conversationId: field(frame, 'conversation_id'),
        taskId: field(frame, 'task_id'),
        messageId: field(frame, 'id')!,
      })
      isFirstMessage = false
      return true
    }
    if (event === 'tts_message') {
      callbacks.onTTSChunk?.(
        field(frame, 'message_id')!,
        field(frame, 'audio')!,
        field(frame, 'audio_type'),
      )
      return true
    }
    if (event === 'tts_message_end') {
      callbacks.onTTSEnd?.(field(frame, 'message_id')!, field(frame, 'audio')!)
      return true
    }
    if (typeof event === 'string' && Object.hasOwn(payloadEvents, event)) {
      const callback = callbacks[payloadEvents[event as keyof PayloadEvents]] as
        | ((payload: unknown) => void)
        | undefined
      callback?.(frame)
      return true
    }
    const unhandledEventError = onUnhandledEvent?.(frame)
    if (unhandledEventError) {
      fail({
        conversationId: unhandledEventError.conversationId,
        messageId: unhandledEventError.messageId ?? '',
        errorMessage: unhandledEventError.errorMessage,
        errorCode: unhandledEventError.errorCode,
      })
      return false
    }
    console.warn(`Unknown event: ${String(event)}`, frame)
    return true
  }

  const iterator = (Array.isArray(frames) ? frames.values() : frames[Symbol.asyncIterator]()) as
    | AsyncIterator<unknown>
    | Iterator<unknown>
  while (true) {
    let result: IteratorResult<unknown>
    try {
      result = await iterator.next()
    } catch (error) {
      fail({
        conversationId: field(lastFrame, 'conversation_id'),
        messageId: field(lastFrame, 'message_id') ?? '',
        errorMessage: String(error),
        errorCode: 'stream_read_error',
      })
      return
    }
    if (result.done) break
    let shouldContinue: boolean
    try {
      shouldContinue = dispatch(result.value)
    } catch (error) {
      fail({ conversationId: undefined, messageId: '', errorMessage: `${error}` })
      shouldContinue = false
    }
    if (!shouldContinue) {
      // Stop reading; the request stays open until the caller aborts it, as before.
      return
    }
  }
  onCompleted?.()
}

/**
 * Runs a streaming request made with a generated client and dispatches Dify's events to the
 * callbacks, with the same events, order and error reporting as the legacy `ssePost`/`sseGet`.
 */
export function streamEvents(request: StreamRequest, callbacks: StreamCallbacks): void {
  const abortController = new AbortController()
  callbacks.getAbortController?.(abortController)
  request(streamRequestOptions(abortController.signal)).then(
    (output) => consumeFrames(toFrames(output), callbacks),
    (error: unknown) => handleRequestError(error, callbacks),
  )
}

export type GeneratorStreamCallbacks<TPlan, TResult> = {
  /** Fired once when the planner stage finishes — carries the high-level plan. */
  onPlan?: (plan: TPlan) => void
  /** Fired once when the builder and validation finish — carries the final graph envelope. */
  onResult?: (result: TResult) => void
  onError?: (message: string) => void
  onCompleted?: () => void
  getAbortController?: (abortController: AbortController) => void
}

/**
 * Consumes the workflow generator's plan-first stream: a `plan` frame, then a `result` frame.
 * Errors are reported only through `onError`, and aborts are silent.
 */
export function streamGeneratorEvents<TPlan, TResult>(
  request: StreamRequest,
  {
    onPlan,
    onResult,
    onError,
    onCompleted,
    getAbortController,
  }: GeneratorStreamCallbacks<TPlan, TResult>,
): void {
  const abortController = new AbortController()
  getAbortController?.(abortController)

  const fail = (error: unknown) => {
    // Aborts are intentional (modal close / regenerate), so they are never surfaced.
    if (isAbortError(error)) return
    onError?.(`${error}`)
  }

  const run = async () => {
    let output: unknown
    try {
      output = await request(streamRequestOptions(abortController.signal))
    } catch (error) {
      if (error instanceof ORPCError && typeof error.status === 'number') {
        onError?.(error.status === 401 ? 'Unauthorized' : getErrorBody(error).message)
        return
      }
      fail(error)
      return
    }
    try {
      for await (const frame of toFrames(output)) {
        if (!isRecord(frame)) continue
        if (frame.event === 'plan') onPlan?.(frame as TPlan)
        else if (frame.event === 'result') onResult?.(frame as TResult)
      }
    } catch (error) {
      fail(error)
      return
    }
    onCompleted?.()
  }
  void run()
}
