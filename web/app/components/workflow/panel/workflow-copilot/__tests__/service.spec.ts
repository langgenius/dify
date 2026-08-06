import type { CopilotGenerateBody } from '../service'
import {
  deleteCopilotConversation,
  fetchCopilotMessages,
  generateWorkflowCopilot,
  listCopilotConversations,
} from '../service'

const serviceMocks = vi.hoisted(() => ({
  del: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
}))

vi.mock('@/service/base', () => serviceMocks)

const body: CopilotGenerateBody = {
  app_id: 'app-1',
  mode: 'workflow',
  message: 'Build a workflow',
  model_config: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: 'chat',
    completion_params: {},
  },
}

describe('workflow copilot service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateWorkflowCopilot', () => {
    it('passes the AbortSignal through to the shared client', () => {
      const controller = new AbortController()

      generateWorkflowCopilot(body, { signal: controller.signal })

      expect(serviceMocks.post).toHaveBeenCalledWith('/workflow-copilot', {
        body,
        signal: controller.signal,
      })
    })

    it('omits signal when the caller does not provide one', () => {
      generateWorkflowCopilot(body)

      expect(serviceMocks.post).toHaveBeenCalledWith('/workflow-copilot', { body })
    })
  })

  it('fetches messages for the requested conversation', () => {
    fetchCopilotMessages('conv-1')

    expect(serviceMocks.get).toHaveBeenCalledWith('/workflow-copilot/conv-1/messages')
  })

  it('lists conversations scoped to the app', () => {
    listCopilotConversations('app-1')

    expect(serviceMocks.get).toHaveBeenCalledWith('/workflow-copilot/conversations', {
      params: { app_id: 'app-1' },
    })
  })

  it('deletes the requested conversation', () => {
    deleteCopilotConversation('conv-1')

    expect(serviceMocks.del).toHaveBeenCalledWith('/workflow-copilot/conv-1')
  })
})
