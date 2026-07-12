import type { AppModeEnum } from '@/types/app'
// service/base is the dependency we're mocking in this test; the
// no-restricted-imports rule targets production imports, not test
// instrumentation — mirrors sibling service specs (annotation.spec.ts etc.).
// eslint-disable-next-line no-restricted-imports
import { get, post, sseGeneratorPost, ssePost } from './base'
import {
  fetchConversationMessages,
  fetchPromptTemplate,
  fetchSuggestedQuestions,
  fetchTextGenerationMessage,
  fetchWorkflowInstructionSuggestions,
  generateBasicAppFirstTimeRule,
  generateRule,
  generateWorkflow,
  generateWorkflowStream,
  sendCompletionMessage,
  stopChatMessageResponding,
} from './debug'

// Stub the shared `post` wrapper so tests verify only what `generateWorkflow`
// composes on top of it — URL, body, and the typed response surface.
vi.mock('./base', () => ({
  post: vi.fn(),
  get: vi.fn(),
  ssePost: vi.fn(),
  sseGeneratorPost: vi.fn(),
}))

describe('debug service — generateWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The new endpoint lives at /workflow-generate; the controller mirrors
  // /rule-generate so the body must flow through unchanged.
  it('should POST to /workflow-generate with the body verbatim', () => {
    const body = {
      mode: 'workflow' as const,
      instruction: 'Summarize a URL',
      ideal_output: 'A 3-sentence summary.',
      model_config: { provider: 'openai', name: 'gpt-4o', mode: 'chat', completion_params: {} },
    }

    generateWorkflow(body)

    expect(post).toHaveBeenCalledWith('/workflow-generate', { body })
  })

  // The optional fields must still POST cleanly — `ideal_output` defaulting
  // server-side requires the helper to forward the body as-is, not augment it.
  it('should pass the body through even when ideal_output is omitted', () => {
    const body = {
      mode: 'advanced-chat' as const,
      instruction: 'Friendly support bot',
      model_config: { provider: 'openai', name: 'gpt-4o', mode: 'chat' },
    }

    generateWorkflow(body)

    expect(post).toHaveBeenCalledWith('/workflow-generate', { body })
  })

  // When the caller threads a ``getAbortController`` callback (the modal's
  // pattern for cancelling the in-flight request on close / double-click /
  // 60 s timeout), it must reach ``post()`` as the third argument so the
  // shared fetch wrapper wires it into the AbortController plumbing.
  // Without this the modal cannot abort the request and a close-while-
  // loading leaks the request beyond its UI surface.
  it('should forward getAbortController to post when provided', () => {
    const body = {
      mode: 'workflow' as const,
      instruction: 'Long-running generation',
      model_config: { provider: 'openai', name: 'gpt-4o', mode: 'chat' },
    }
    const getAbortController = vi.fn()

    generateWorkflow(body, { getAbortController })

    expect(post).toHaveBeenCalledWith('/workflow-generate', { body }, { getAbortController })
  })

  // No options → no third argument. Keeps the call site clean and lets the
  // shared wrapper apply its own defaults without a phantom empty object.
  it('should NOT pass a third argument when no options are provided', () => {
    const body = {
      mode: 'workflow' as const,
      instruction: 'Plain call',
      model_config: { provider: 'openai', name: 'gpt-4o', mode: 'chat' },
    }

    generateWorkflow(body)

    expect(post).toHaveBeenCalledWith('/workflow-generate', { body })
    expect(vi.mocked(post).mock.calls[0]).toHaveLength(2)
  })

  describe('other endpoints', () => {
    it('stopChatMessageResponding', async () => {
      await stopChatMessageResponding('app-1', 'task-1')
      expect(post).toHaveBeenCalledWith('apps/app-1/chat-messages/task-1/stop')
    })

    it('sendCompletionMessage', async () => {
      const callbacks = {
        onData: vi.fn(),
        onCompleted: vi.fn(),
        onError: vi.fn(),
        onMessageReplace: vi.fn(),
      }
      await sendCompletionMessage('app-1', { text: 'hello' }, callbacks)
      expect(ssePost).toHaveBeenCalledWith(
        'apps/app-1/completion-messages',
        {
          body: { text: 'hello', response_mode: 'streaming' },
        },
        callbacks,
      )
    })

    it('fetchSuggestedQuestions', async () => {
      const getAbortController = vi.fn()
      await fetchSuggestedQuestions('app-1', 'msg-1', getAbortController)
      expect(get).toHaveBeenCalledWith(
        'apps/app-1/chat-messages/msg-1/suggested-questions',
        {},
        { getAbortController },
      )
    })

    it('fetchConversationMessages', async () => {
      const getAbortController = vi.fn()
      await fetchConversationMessages('app-1', 'conv-1', getAbortController)
      expect(get).toHaveBeenCalledWith(
        'apps/app-1/chat-messages',
        { params: { conversation_id: 'conv-1' } },
        { getAbortController },
      )
    })

    it('generateBasicAppFirstTimeRule', async () => {
      await generateBasicAppFirstTimeRule({ mode: 'chat' })
      expect(post).toHaveBeenCalledWith('/rule-generate', { body: { mode: 'chat' } })
    })

    it('generateRule', async () => {
      await generateRule({ mode: 'chat' })
      expect(post).toHaveBeenCalledWith('/instruction-generate', { body: { mode: 'chat' } })
    })

    it('generateWorkflowStream', async () => {
      const body = {
        mode: 'workflow' as const,
        instruction: 'test',
        model_config: { provider: 'test', name: 'test', mode: 'chat' },
      }
      const callbacks = {
        onPlan: vi.fn(),
        onResult: vi.fn(),
        onError: vi.fn(),
        onCompleted: vi.fn(),
        getAbortController: vi.fn(),
      }

      vi.mocked(sseGeneratorPost).mockImplementation((_url, _body, options) => {
        options?.onPlan?.({ title: 'plan' })
        options?.onResult?.({ graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } })
        return Promise.resolve()
      })

      await generateWorkflowStream(body, callbacks)

      expect(sseGeneratorPost).toHaveBeenCalled()
      expect(callbacks.onPlan).toHaveBeenCalled()
      expect(callbacks.onResult).toHaveBeenCalled()
    })

    it('fetchWorkflowInstructionSuggestions without getAbortController', async () => {
      await fetchWorkflowInstructionSuggestions({ mode: 'workflow' })
      expect(post).toHaveBeenCalledWith('/workflow-generate/suggestions', {
        body: { mode: 'workflow' },
      })
    })

    it('fetchWorkflowInstructionSuggestions with getAbortController', async () => {
      const getAbortController = vi.fn()
      await fetchWorkflowInstructionSuggestions({ mode: 'workflow' }, { getAbortController })
      expect(post).toHaveBeenCalledWith(
        '/workflow-generate/suggestions',
        { body: { mode: 'workflow' } },
        { getAbortController },
      )
    })

    it('fetchPromptTemplate', async () => {
      await fetchPromptTemplate({
        appMode: 'chat' as AppModeEnum,
        mode: 'chat',
        modelName: 'gpt-4',
        hasSetDataSet: true,
      })
      expect(get).toHaveBeenCalledWith('/app/prompt-templates', {
        params: {
          app_mode: 'chat',
          model_mode: 'chat',
          model_name: 'gpt-4',
          has_context: true,
        },
      })
    })

    it('fetchTextGenerationMessage', async () => {
      await fetchTextGenerationMessage({ appId: 'app-1', messageId: 'msg-1' })
      expect(get).toHaveBeenCalledWith('/apps/app-1/messages/msg-1')
    })
  })
})
