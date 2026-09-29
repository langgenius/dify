import type {
  AgentIterationLogResponse,
  AgentLogResponse,
  AgentToolCallResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { ConsoleClient } from '@/service/console'

export const createToolCall = (
  overrides: Partial<AgentToolCallResponse> = {},
): AgentToolCallResponse => ({
  status: 'success',
  error: null,
  time_cost: 1.5,
  tool_name: 'search',
  tool_label: { 'en-US': 'Search' },
  tool_icon: '',
  tool_input: { query: 'hello' },
  tool_output: { result: 'world' },
  tool_parameters: {},
  ...overrides,
})

export const createIteration = (
  overrides: Partial<AgentIterationLogResponse> = {},
): AgentIterationLogResponse => ({
  created_at: '2024-03-12T10:00:05Z',
  files: [],
  thought: 'A useful answer',
  tokens: 100,
  tool_calls: [createToolCall()],
  tool_raw: { inputs: '{}', outputs: 'Search observation' },
  ...overrides,
})

export const createLogResponse = (overrides: Partial<AgentLogResponse> = {}): AgentLogResponse => ({
  meta: {
    status: 'success',
    executor: 'User',
    start_time: '2024-03-12T10:00:00Z',
    elapsed_time: 1,
    total_tokens: 100,
    agent_mode: 'function_call',
    iterations: 1,
  },
  iterations: [createIteration()],
  files: [],
  ...overrides,
})

export const createChatLog = (overrides: Partial<IChatItem> = {}): IChatItem => ({
  id: 'msg-id',
  content: 'Output content',
  isAnswer: true,
  conversationId: 'conv-id',
  input: 'User input',
  ...overrides,
})

export const withAgentLogOperation = (
  client: ConsoleClient,
  get: ConsoleClient['apps']['byAppId']['agent']['logs']['get'],
): ConsoleClient =>
  new Proxy(client, {
    get(target, property, receiver) {
      if (property !== 'apps') return Reflect.get(target, property, receiver)
      return new Proxy(target.apps, {
        get(apps, property, receiver) {
          if (property !== 'byAppId') return Reflect.get(apps, property, receiver)
          return new Proxy(apps.byAppId, {
            get(byAppId, property, receiver) {
              if (property !== 'agent') return Reflect.get(byAppId, property, receiver)
              return { logs: { get } }
            },
          })
        },
      })
    },
  })
