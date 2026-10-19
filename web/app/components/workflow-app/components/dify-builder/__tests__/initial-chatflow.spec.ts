import type { DifyBuilderCanvasSnapshot } from '../utils'
import { createStore } from 'jotai'
import answerDefault from '@/app/components/workflow/nodes/answer/default'
import llmDefault from '@/app/components/workflow/nodes/llm/default'
import startDefault from '@/app/components/workflow/nodes/start/default'
import { BlockEnum } from '@/app/components/workflow/types'
import { createDifyBuilderRuntime } from '@/test/fixtures/dify-builder'
import { difyBuilderRuntimeAtom, difyBuilderStartPromptAtom } from '../store'
import { isInitialChatflow, shouldStartBuildSession } from '../utils'

const initialCanvas = (): DifyBuilderCanvasSnapshot => ({
  isChatflow: true,
  nodes: [
    {
      id: 'input-123',
      data: { ...startDefault.defaultValue, type: BlockEnum.Start, title: '用户输入' },
    },
    {
      id: 'llm-456',
      data: {
        ...llmDefault.defaultValue,
        type: BlockEnum.LLM,
        memory: {
          window: { enabled: false, size: 10 },
          query_prompt_template: '{{#sys.query#}}\n\n{{#sys.files#}}',
        },
      },
    },
    {
      id: 'reply-789',
      data: { ...answerDefault.defaultValue, type: BlockEnum.Answer, answer: '{{#llm-456.text#}}' },
    },
  ],
  edges: [
    { source: 'input-123', target: 'llm-456', sourceHandle: 'source', targetHandle: 'target' },
    { source: 'llm-456', target: 'reply-789', sourceHandle: 'source', targetHandle: 'target' },
  ],
})

describe('Builder initial Chatflow routing', () => {
  it('recognizes the actual editor defaults with arbitrary node IDs and translated titles', () => {
    expect(shouldStartBuildSession(initialCanvas())).toBe(true)
  })

  it('allows automatically filled model identity, role prefixes and canvas presentation', () => {
    const canvas = initialCanvas()
    const data = canvas.nodes[1]!.data!
    data.model = {
      provider: 'openai',
      name: 'gpt-4o',
      mode: 'chat',
      completion_params: { temperature: 0.7 },
    }
    data.memory = { ...(data.memory as object), role_prefix: { user: '', assistant: '' } }
    data.model_selector = undefined
    data._connectedSourceHandleIds = ['source']
    data.selected = true
    data.desc = ''
    canvas.nodes.reverse()
    canvas.edges.reverse()
    expect(shouldStartBuildSession(canvas)).toBe(true)
  })

  it.each([
    ['input variables', 0, { variables: [{ variable: 'topic', type: 'text-input' }] }],
    ['prompt', 1, { prompt_template: [{ role: 'system', text: 'Summarize support tickets' }] }],
    [
      'Jinja prompt',
      1,
      {
        prompt_template: [
          { role: 'system', text: '', edition_type: 'jinja2', jinja2_text: '{{ topic }}' },
        ],
      },
    ],
    ['context', 1, { context: { enabled: true, variable_selector: ['knowledge', 'result'] } }],
    ['model parameters', 1, { model: { mode: 'chat', completion_params: { temperature: 0.3 } } }],
    ['model selector', 1, { model_selector: ['env', 'model'] }],
    [
      'memory',
      1,
      { memory: { window: { enabled: true, size: 3 }, query_prompt_template: '{{#sys.query#}}' } },
    ],
    ['vision', 1, { vision: { enabled: true } }],
    ['retry behavior', 1, { retry_config: { retry_enabled: true } }],
    ['reply', 2, { answer: 'Hello' }],
  ] as const)('edits a Chatflow with configured %s', (_name, index, patch) => {
    const canvas = initialCanvas()
    canvas.nodes[index]!.data = { ...canvas.nodes[index]!.data, ...patch }
    expect(shouldStartBuildSession(canvas)).toBe(false)
  })

  it.each(['rewired', 'missing edge', 'branch handle', 'additional node', 'different app mode'])(
    'does not treat %s as the initial template',
    (change) => {
      const canvas = initialCanvas()
      if (change === 'rewired') canvas.edges[0]!.target = 'reply-789'
      if (change === 'missing edge') canvas.edges.pop()
      if (change === 'branch handle') canvas.edges[0]!.sourceHandle = 'true'
      if (change === 'additional node')
        canvas.nodes.push({ id: 'extra', data: { type: BlockEnum.Code } })
      if (change === 'different app mode') canvas.isChatflow = false
      expect(isInitialChatflow(canvas)).toBe(false)
      expect(shouldStartBuildSession(canvas)).toBe(false)
    },
  )

  it.each([BlockEnum.Start, BlockEnum.StartPlaceholder, BlockEnum.TriggerWebhook])(
    'keeps the existing build entry for an unconnected %s',
    (type) => {
      expect(
        shouldStartBuildSession({ nodes: [{ data: { type } }], edges: [], isChatflow: false }),
      ).toBe(true)
    },
  )

  it.each([false, true])(
    'submits the first Chatflow prompt through the correct session API (configured: %s)',
    async (configured) => {
      const canvas = initialCanvas()
      if (configured)
        canvas.nodes[1]!.data!.prompt_template = [{ role: 'system', text: 'Summarize' }]
      const store = createStore()
      const startBuild = vi.fn(async () => true)
      const startEdit = vi.fn(async () => true)
      store.set(
        difyBuilderRuntimeAtom,
        createDifyBuilderRuntime({
          appId: 'chatflow-1',
          getCanvasSnapshot: () => canvas,
          session: { startBuild, startEdit },
        }),
      )
      const model = { provider: 'openai', name: 'gpt-4o', mode: 'chat', completion_params: {} }
      expect(
        await store.set(difyBuilderStartPromptAtom, { text: 'Build a support assistant', model }),
      ).toBe(true)
      expect(configured ? startEdit : startBuild).toHaveBeenCalledExactlyOnceWith(
        'chatflow-1',
        'Build a support assistant',
        model,
      )
      expect(configured ? startBuild : startEdit).not.toHaveBeenCalled()
    },
  )
})
