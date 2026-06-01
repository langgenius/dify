// service/base is the dependency we're mocking in this test; the
// no-restricted-imports rule targets production imports, not test
// instrumentation — mirrors sibling service specs (annotation.spec.ts etc.).
// eslint-disable-next-line no-restricted-imports
import { post } from './base'
import { generateWorkflow } from './debug'

// Stub the shared `post` wrapper so tests verify only what `generateWorkflow`
// composes on top of it — URL, body, and the typed response surface.
vi.mock('./base', () => ({
  post: vi.fn(),
  get: vi.fn(),
  ssePost: vi.fn(),
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
})
