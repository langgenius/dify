import type { StreamCallbacks, StreamRequest, StreamSender } from '@/service/event-stream'

export type RecordedStreamCall = (
  url: string,
  fetchOptions: { body?: Record<string, unknown> },
  callbacks: StreamCallbacks,
) => unknown

const eventsURL = Symbol('eventsURL')

type WorkflowRunEventsRequest = StreamRequest & { [eventsURL]?: string }

/**
 * Records generated-client streams as `(url, { body }, callbacks)` calls, so specs can drive the
 * stream callbacks and assert the target and body without a network layer.
 *
 * Mock `streamEvents` from `@/service/event-stream` and `workflowRunEventsRequest` from
 * `@/service/workflow-events` with the returned functions, and pass `sender(url)` wherever the
 * code under test takes a `StreamSender`.
 */
export function createStreamRecorder({
  post,
  get,
}: {
  post: RecordedStreamCall
  get: RecordedStreamCall
}) {
  let pendingCallbacks: StreamCallbacks = {}

  const streamEvents = (request: WorkflowRunEventsRequest, callbacks: StreamCallbacks) => {
    const url = request[eventsURL]
    if (url) {
      void get(url, {}, callbacks)
      return
    }
    pendingCallbacks = callbacks
    // Requests that do not go through a recorded sender would reach the network; ignore them.
    request({
      signal: new AbortController().signal,
      context: { stream: true },
    }).catch(() => {})
  }

  const sender =
    (url: string): StreamSender =>
    (body) => {
      void post(url, { body }, pendingCallbacks)
      return Promise.resolve()
    }

  const workflowRunEventsRequest = (workflowRunId: string): StreamRequest =>
    Object.assign(() => Promise.resolve(), {
      [eventsURL]: `/workflow/${workflowRunId}/events?include_state_snapshot=true&continue_on_pause=true`,
    })

  const shareURL = (path: string, appSourceType: string, appId: string) => {
    if (appSourceType === 'installedApp') return `installed-apps/${appId}/${path}`
    if (appSourceType === 'tryApp') return `trial-apps/${appId}/${path}`
    return path
  }

  const chatMessagesSender = (appSourceType: string, appId: string) =>
    sender(shareURL('chat-messages', appSourceType, appId))

  const shareStream =
    (path: string) =>
    async (
      body: Record<string, unknown>,
      callbacks: StreamCallbacks,
      appSourceType: string,
      appId = '',
    ) => {
      void post(
        shareURL(path, appSourceType, appId),
        { body: { ...body, response_mode: 'streaming' } },
        { ...callbacks, isPublicAPI: appSourceType === 'webApp' },
      )
    }

  return {
    streamEvents,
    sender,
    workflowRunEventsRequest,
    /** Stand-ins for `@/service/share`'s streaming requests. */
    chatMessagesSender,
    sendCompletionMessage: shareStream('completion-messages'),
    sendWorkflowMessage: shareStream('workflows/run'),
    /** Stand-in for `@/service/console-chat-messages`. */
    consoleChatMessages: {
      appChatMessagesSender: (appId: string) => sender(`apps/${appId}/chat-messages`),
      agentChatMessagesSender: (agentId: string) => sender(`agent/${agentId}/chat-messages`),
    },
    /** Stand-in for `@/service/debug`'s `appCompletionMessagesSender`. */
    appCompletionMessagesSender: (appId: string) => sender(`apps/${appId}/completion-messages`),
  }
}
