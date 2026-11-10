import type {
  DifyBuilderCommandSubmissionResponse,
  DifyBuilderCreatedSessionResponse,
  DifyBuilderStreamEventResponse,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { createStore } from 'jotai'
import type { SessionView } from '../../types'
import type { consoleClient } from '@/service/console'
import { UNEXPECTED_EOF_ERROR } from '../errors'
import { difyBuilderSessionViewAtom } from '../state'

type ConsoleSessions = typeof consoleClient.difyBuilder.sessions

type SessionEndpoints = ConsoleSessions['bySessionId']
type Events = AsyncIterable<DifyBuilderStreamEventResponse>
type TestEndpoint<T extends (...args: never[]) => unknown, Output> = (
  ...args: Parameters<T>
) => Promise<Output>
type ScriptedSessions = {
  post: TestEndpoint<ConsoleSessions['post'], DifyBuilderCreatedSessionResponse | Events>
  bySessionId: Omit<SessionEndpoints, 'stream' | 'actions' | 'messages'> & {
    stream: { get: TestEndpoint<SessionEndpoints['stream']['get'], Events> }
    actions: {
      post: TestEndpoint<
        SessionEndpoints['actions']['post'],
        DifyBuilderCommandSubmissionResponse | Events
      >
    }
    messages: {
      post: TestEndpoint<
        SessionEndpoints['messages']['post'],
        DifyBuilderCommandSubmissionResponse | Events
      >
    }
  }
}

const scriptedEvents = (value: unknown): AsyncIterable<DifyBuilderStreamEventResponse> => {
  if (typeof value !== 'object' || !value || !(Symbol.asyncIterator in value))
    throw new Error('Expected a scripted Builder command')
  return value as AsyncIterable<DifyBuilderStreamEventResponse>
}

/** Feed scripted worker frames into the single session stream used by the controller specs. */
export function installSessionTransport(
  sessions: ConsoleSessions,
  store: ReturnType<typeof createStore>,
  fixture: {
    view: (overrides: Partial<SessionView>) => SessionView
    stream: () => {
      push: (event: DifyBuilderStreamEventResponse) => void
      close: () => void
      iterable: AsyncIterable<DifyBuilderStreamEventResponse>
    }
  },
) {
  const scripted = sessions as unknown as ScriptedSessions
  const original = { post: scripted.post, bySessionId: scripted.bySessionId }
  const seen = new Set<string>()
  const channels = new Map<string, ReturnType<typeof fixture.stream>>()
  const openings = new Map<
    string,
    {
      view: SessionView
      first: IteratorResult<DifyBuilderStreamEventResponse>
      rest: AsyncIterator<DifyBuilderStreamEventResponse>
    }
  >()

  const feed = async (
    sessionId: string,
    rest: AsyncIterator<DifyBuilderStreamEventResponse>,
    commandId: string,
    reconnect = false,
  ) => {
    const channel = channels.get(sessionId)
    if (!channel) return
    let finished = false
    try {
      for (let next = await rest.next(); !next.done; next = await rest.next()) {
        const event = next.value
        finished ||= event.event === 'error' || event.event === 'command_finished'
        if (event.event === 'error')
          channel.push({
            ...event,
            data: { ...event.data, command_id: event.data.command_id ?? commandId },
          })
        else channel.push(event)
      }
      if (!finished && reconnect) channel.close()
      else if (!finished) {
        channel.push({
          event: 'error',
          data: {
            session_id: sessionId,
            command_id: commandId,
            code: 'command_finished_unavailable',
            message: UNEXPECTED_EOF_ERROR,
          },
        })
      }
    } catch (error) {
      channel.push({
        event: 'error',
        data: {
          session_id: sessionId,
          command_id: commandId,
          code: 'command_finished_unavailable',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  const submit = async (
    sessionId: string,
    first: IteratorResult<DifyBuilderStreamEventResponse>,
    rest: AsyncIterator<DifyBuilderStreamEventResponse>,
  ): Promise<DifyBuilderCommandSubmissionResponse> => {
    const event = first.done ? undefined : first.value
    if (event?.event === 'command_finished') {
      const { command_id, ...view } = event.data
      return { command_id, pending: false, session: { ...view, last_command_id: command_id } }
    }
    const commandId = event?.event === 'command_started' ? event.data.command_id : 'command-1'
    const channel = channels.get(sessionId)
    if (event?.event === 'error') {
      channel?.push({
        ...event,
        data: { ...event.data, command_id: event.data.command_id ?? commandId },
      })
    } else {
      if (event) channel?.push(event)
      if (commandId) void feed(sessionId, rest, commandId)
    }
    if (!commandId) {
      const terminal = await rest.next()
      if (!terminal.done && terminal.value.event === 'command_finished') {
        const { command_id, ...view } = terminal.value.data
        return { command_id, pending: false, session: { ...view, last_command_id: command_id } }
      }
      throw new Error(UNEXPECTED_EOF_ERROR)
    }
    return { command_id: commandId, pending: true }
  }

  const follow = async (
    input: { params: { session_id: string } },
    options: { signal?: AbortSignal },
  ) => {
    const originalStream = await original.bySessionId.stream?.get(input, options)
    if (originalStream) {
      const sessionId = input.params.session_id
      await feed(sessionId, originalStream[Symbol.asyncIterator](), 'command-1', true)
    }
  }

  scripted.post = async (input, options) => {
    const rest = scriptedEvents(await original.post(input, options))[Symbol.asyncIterator]()
    const first = await rest.next()
    if (
      first.done ||
      (first.value.event !== 'command_started' && first.value.event !== 'command_finished')
    )
      throw new Error('Builder stream ended without a command handshake.')
    const view = fixture.view({
      session_id: first.value.data.session_id,
      version: first.value.data.version,
      last_command_id: '',
      command_pending: false,
    })
    openings.set(view.session_id, { view, first, rest })
    return { session: view, requires_start: true }
  }
  scripted.bySessionId = {
    ...original.bySessionId,
    stream: {
      get: async (input, options) => {
        const sessionId = input.params.session_id
        const channel = fixture.stream()
        channels.set(sessionId, channel)
        options?.signal?.addEventListener(
          'abort',
          () => {
            channel.close()
            if (channels.get(sessionId) === channel) channels.delete(sessionId)
          },
          { once: true },
        )
        await Promise.resolve()
        options?.signal?.throwIfAborted()
        const current = store.get(difyBuilderSessionViewAtom)
        const seeded =
          !seen.has(sessionId) && current?.session_id === sessionId ? current : undefined
        const view =
          openings.get(sessionId)?.view ??
          seeded ??
          (await original.bySessionId.get?.(input, options))
        options?.signal?.throwIfAborted()
        const snapshot = view ?? fixture.view({ session_id: sessionId, command_pending: false })
        const commandPending =
          snapshot.command_pending ??
          (!seeded && snapshot.run_status === 'processing' && !snapshot.interrupted)
        seen.add(sessionId)
        channel.push({
          event: 'session_ready',
          data: commandPending ? { ...snapshot, command_pending: true } : snapshot,
        })
        if (commandPending && !seeded && options) void follow(input, options)
        return channel.iterable
      },
    },
    actions: {
      post: async (input, options) => {
        const sessionId = input.params.session_id
        if (input.body.action_id === 'start_session') {
          const opening = openings.get(sessionId)
          if (!opening) throw new Error('Missing scripted opening command')
          openings.delete(sessionId)
          return submit(sessionId, opening.first, opening.rest)
        }
        const rest = scriptedEvents(await original.bySessionId.actions.post(input, options))[
          Symbol.asyncIterator
        ]()
        return submit(sessionId, await rest.next(), rest)
      },
    },
    messages: {
      post: async (input, options) => {
        const response = await original.bySessionId.messages.post(input, options)
        if (response && 'pending' in response) return response
        const rest = scriptedEvents(response)[Symbol.asyncIterator]()
        return submit(input.params.session_id, await rest.next(), rest)
      },
    },
    ...(original.bySessionId.resume
      ? {
          resume: {
            post: async (input, options) => {
              const view = await original.bySessionId.resume.post(input, options)
              if (view.run_status === 'processing' && options) void follow(input, options)
              return { ...view, command_pending: view.run_status === 'processing' }
            },
          },
        }
      : {}),
    ...(original.bySessionId.fixIntents
      ? {
          fixIntents: {
            ...original.bySessionId.fixIntents,
            post: async (input, options) => {
              const receipt = await original.bySessionId.fixIntents.post(input, options)
              const commandPending =
                receipt.status === 'activated' && receipt.session.run_status === 'processing'
              if (commandPending && options) void follow(input, options)
              return {
                ...receipt,
                session: { ...receipt.session, command_pending: commandPending },
              }
            },
          },
        }
      : {}),
  }
  return () => {
    scripted.post = original.post
    scripted.bySessionId = original.bySessionId
  }
}
