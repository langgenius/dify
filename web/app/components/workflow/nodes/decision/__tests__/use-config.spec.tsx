import type { DecisionNodeType } from '../types'
import { act, waitFor } from '@testing-library/react'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderNodeConfig } from '@/app/components/workflow/nodes/__tests__/render-node-config'
import { BlockEnum } from '@/app/components/workflow/types'
import { DecideBy } from '../types'
import useConfig from '../use-config'

const generateDecision = vi.hoisted(() => vi.fn())
const nodeDataUpdates = vi.hoisted(() => [] as { id: string; data: Record<string, unknown> }[])

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    defaultModel: { model: 'gpt-4o-mini', model_type: 'llm', provider: { provider: 'openai' } },
  }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'decisionGenerate.post': (input) => generateDecision(input),
    }),
  }
})

// Record every node-data write so a test can prove a generated configuration
// lands in one update (one undo step).
vi.mock('@/app/components/workflow/hooks/use-node-data-update', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/components/workflow/hooks/use-node-data-update')>()
  return {
    useNodeDataUpdate: () => {
      const real = actual.useNodeDataUpdate()
      return {
        ...real,
        handleNodeDataUpdateWithSyncDraft: (
          payload: { id: string; data: Record<string, unknown> },
          options?: Parameters<typeof real.handleNodeDataUpdateWithSyncDraft>[1],
        ) => {
          nodeDataUpdates.push(payload)
          return real.handleNodeDataUpdateWithSyncDraft(payload, options)
        },
      }
    },
  }
})

const createPayload = (overrides: Partial<DecisionNodeType> = {}): DecisionNodeType => ({
  title: 'Decision',
  desc: '',
  type: BlockEnum.Decision,
  intent: 'Refund or not',
  decide_by: DecideBy.rules,
  outcomes: [
    {
      id: 'outcome-1',
      label: 'Refund',
      when: {
        logical_operator: 'and',
        conditions: [
          {
            id: 'condition-1',
            varType: 'string',
            variable_selector: ['start', 'query'],
            comparison_operator: 'contains',
            value: 'refund',
          },
        ],
      },
    },
  ],
  otherwise: { label: '' },
  inputs: [],
  context: { glossary: '', prompt: '' },
  extras: [],
  _targetBranches: [{ id: 'outcome-1', name: 'Refund' }],
  ...overrides,
})

const generatedResult = {
  decide_by: 'llm',
  decide_by_reason: 'The rule needs judgement',
  outcomes: [{ id: 'outcome_a', label: 'Approve', when: 'the order is over 500' }],
  otherwise: { label: 'Escalate' },
  inputs: [{ variable: 'amount', value_selector: ['start', 'amount'] }],
  extras: [{ name: 'note', from: 'model', hint: 'what the user wants' }],
  error: '',
}

describe('decision/use-config', () => {
  beforeEach(() => {
    generateDecision.mockReset()
    nodeDataUpdates.length = 0
  })

  it('converts outcome when values between modes while keeping ids and labels, and restores them on switch back', () => {
    const payload = createPayload()
    const { result } = renderNodeConfig(useConfig, payload, {})

    act(() => result.current.config.handleDecideByChange(DecideBy.llm))

    let inputs = result.current.config.inputs
    expect(inputs.decide_by).toBe(DecideBy.llm)
    expect(inputs.model).toEqual({ provider: '', name: '', mode: 'chat', completion_params: {} })
    expect(inputs.outcomes).toEqual([{ id: 'outcome-1', label: 'Refund', when: '' }])

    act(() => result.current.config.handleDecideByChange(DecideBy.rules))

    inputs = result.current.config.inputs
    expect(inputs.decide_by).toBe(DecideBy.rules)
    expect(inputs.outcomes).toEqual([payload.outcomes[0]])
    // the llm-mode value stays only in the panel stash, never in node data
    expect(JSON.stringify(inputs)).not.toContain('"when":""')
  })

  it('keeps edited llm descriptions when switching back and forth', () => {
    const payload = createPayload({
      decide_by: DecideBy.llm,
      outcomes: [{ id: 'outcome-1', label: 'Refund', when: 'wants money back' }],
    })
    const { result } = renderNodeConfig(useConfig, payload, {})

    act(() => result.current.config.handleDecideByChange(DecideBy.rules))
    expect(result.current.config.inputs.outcomes[0]!.when).toEqual({
      logical_operator: 'and',
      conditions: [],
    })

    act(() => result.current.config.handleDecideByChange(DecideBy.llm))
    expect(result.current.config.inputs.outcomes[0]!.when).toBe('wants money back')
  })

  it('adds outcomes with fresh never-reused ids and keeps _targetBranches in sync', () => {
    const payload = createPayload()
    const { result } = renderNodeConfig(useConfig, payload, {})

    act(() => result.current.config.handleAddOutcome())
    act(() => result.current.config.handleAddOutcome())

    const inputs = result.current.config.inputs
    const ids = inputs.outcomes.map((outcome) => outcome.id)
    expect(new Set(ids).size).toBe(ids.length)
    // only the generated ids must match the outcome_<random> pattern
    expect(ids.slice(1).every((id) => /^outcome_[\w-]{1,64}$/.test(id))).toBe(true)
    expect(inputs.outcomes.map((outcome) => outcome.id)).toEqual(['outcome-1', ...ids.slice(1)])
    expect(result.current.flow.getNode('node')?.data._targetBranches).toEqual([
      { id: 'outcome-1', name: 'Refund' },
      ...ids.slice(1).map((id) => ({ id, name: '' })),
      { id: 'otherwise', name: '' },
    ])
  })

  it('removes the deleted outcome and only its own edges', () => {
    const payload = createPayload()
    const { result } = renderNodeConfig(useConfig, payload, {
      nodes: [createNode({ id: 'node', data: payload }), createNode({ id: 'target' })],
      edges: [
        createEdge({ id: 'kept', source: 'node', target: 'target', sourceHandle: 'otherwise' }),
        createEdge({
          id: 'removed',
          source: 'node',
          target: 'target',
          sourceHandle: 'outcome-1',
        }),
      ],
    })

    // The outcome's exit really carries an edge before anything is removed;
    // the deletion below must be what makes it disappear.
    expect(result.current.flow.getEdges().map((edge) => edge.id)).toContain('removed')

    act(() => result.current.config.handleRemoveOutcome('outcome-1'))

    expect(result.current.flow.getNode('node')?.data.outcomes).toEqual([])
    expect(result.current.flow.getEdges().map((edge) => edge.id)).toEqual(['kept'])
    expect(result.current.flow.getNode('node')?.data._targetBranches).toEqual([
      { id: 'otherwise', name: '' },
    ])
  })

  it('edits outcome labels, when descriptions and the fallback label', () => {
    const payload = createPayload({
      decide_by: DecideBy.llm,
      outcomes: [{ id: 'outcome-1', label: '', when: '' }],
    })
    const { result } = renderNodeConfig(useConfig, payload, {})

    act(() => result.current.config.handleUpdateOutcomeLabel('outcome-1', 'Refund'))
    act(() => result.current.config.handleUpdateOutcomeWhenText('outcome-1', 'wants money back'))
    act(() => result.current.config.handleOtherwiseLabelChange('Hand off'))

    const node = result.current.flow.getNode('node')!.data as DecisionNodeType
    expect(node.outcomes[0]).toEqual({ id: 'outcome-1', label: 'Refund', when: 'wants money back' })
    expect(node.otherwise).toEqual({ label: 'Hand off' })
    expect(node._targetBranches).toEqual([
      { id: 'outcome-1', name: 'Refund' },
      { id: 'otherwise', name: 'Hand off' },
    ])
  })

  describe('generate from the sentence', () => {
    it('asks before replacing rules the user would lose', () => {
      const payload = createPayload()
      const { result } = renderNodeConfig(useConfig, payload, {})

      act(() => result.current.config.handleGenerate())

      expect(result.current.config.isConfirmReplaceOpen).toBe(true)
      expect(generateDecision).not.toHaveBeenCalled()

      act(() => result.current.config.handleCancelReplace())
      expect(result.current.config.isConfirmReplaceOpen).toBe(false)
      expect(generateDecision).not.toHaveBeenCalled()
    })

    it('generates without asking when no outcome is named and no when is filled in', async () => {
      const payload = createPayload({
        outcomes: [
          { id: 'outcome-1', label: '', when: { logical_operator: 'and', conditions: [] } },
        ],
      })
      const { result } = renderNodeConfig(useConfig, payload, {})
      generateDecision.mockResolvedValueOnce(generatedResult)

      await act(async () => result.current.config.handleGenerate())

      expect(result.current.config.isConfirmReplaceOpen).toBe(false)
      expect(generateDecision).toHaveBeenCalledTimes(1)
    })

    it('writes the generated configuration in one update, keeps the sentence, fills the model only when missing, and drops edges on vanished exits', async () => {
      const payload = createPayload()
      const { result } = renderNodeConfig(useConfig, payload, {
        nodes: [createNode({ id: 'node', data: payload }), createNode({ id: 'target' })],
        edges: [
          createEdge({ id: 'kept', source: 'node', target: 'target', sourceHandle: 'otherwise' }),
        ],
      })
      act(() =>
        result.current.flow.addEdges(
          createEdge({
            id: 'vanished',
            source: 'node',
            target: 'target',
            sourceHandle: 'outcome-1',
          }),
        ),
      )
      nodeDataUpdates.length = 0
      generateDecision.mockResolvedValueOnce(generatedResult)

      act(() => result.current.config.handleGenerate())
      await act(async () => result.current.config.handleConfirmReplace())
      await waitFor(() => expect(result.current.config.isGenerating).toBe(false))

      const node = result.current.flow.getNode('node')!.data as DecisionNodeType
      expect(node.intent).toBe('Refund or not')
      expect(node.decide_by).toBe(DecideBy.llm)
      expect(node.outcomes).toEqual([
        { id: 'outcome_a', label: 'Approve', when: 'the order is over 500' },
      ])
      expect(node.otherwise).toEqual({ label: 'Escalate' })
      expect(node.inputs).toEqual([{ variable: 'amount', value_selector: ['start', 'amount'] }])
      expect(node.extras).toEqual([
        { name: 'note', from: 'model', values: {}, hint: 'what the user wants' },
      ])
      expect(node.model).toEqual({
        provider: 'openai',
        name: 'gpt-4o-mini',
        mode: 'chat',
        completion_params: {},
      })
      expect(node._targetBranches).toEqual([
        { id: 'outcome_a', name: 'Approve' },
        { id: 'otherwise', name: 'Escalate' },
      ])
      expect(result.current.flow.getEdges().map((edge) => edge.id)).toEqual(['kept'])
      expect(nodeDataUpdates).toHaveLength(1)
      expect(result.current.config.suggestedReason).toBe('The rule needs judgement')
      // the suggestion is panel state only, never node data
      expect(JSON.stringify(node)).not.toContain('The rule needs judgement')
    })

    it('keeps the model the node already has and sends it to the generator', async () => {
      const payload = createPayload({
        decide_by: DecideBy.llm,
        model: { provider: 'anthropic', name: 'claude', mode: 'chat', completion_params: {} },
        outcomes: [{ id: 'outcome-1', label: 'Refund', when: 'wants money back' }],
      })
      const { result } = renderNodeConfig(useConfig, payload, {})
      generateDecision.mockResolvedValueOnce(generatedResult)

      act(() => result.current.config.handleGenerate())
      await act(async () => result.current.config.handleConfirmReplace())
      await waitFor(() => expect(result.current.config.isGenerating).toBe(false))

      expect(generateDecision).toHaveBeenCalledWith({
        body: expect.objectContaining({
          model_config: expect.objectContaining({ provider: 'anthropic', name: 'claude' }),
        }),
      })
      const node = result.current.flow.getNode('node')!.data as DecisionNodeType
      expect(node.model).toEqual({
        provider: 'anthropic',
        name: 'claude',
        mode: 'chat',
        completion_params: {},
      })
    })

    it('shows the returned error inline and leaves the node untouched', async () => {
      const payload = createPayload({
        outcomes: [
          { id: 'outcome-1', label: '', when: { logical_operator: 'and', conditions: [] } },
        ],
      })
      const { result } = renderNodeConfig(useConfig, payload, {})
      generateDecision.mockResolvedValueOnce({ ...generatedResult, error: 'Model refused' })

      await act(async () => result.current.config.handleGenerate())

      expect(result.current.config.generateFeedback).toEqual({
        kind: 'error',
        message: 'Model refused',
      })
      const node = result.current.flow.getNode('node')!.data as DecisionNodeType
      expect(node.outcomes).toEqual(payload.outcomes)
    })

    it('ignores a response that arrives after the panel closed', async () => {
      const payload = createPayload({
        outcomes: [
          { id: 'outcome-1', label: '', when: { logical_operator: 'and', conditions: [] } },
        ],
      })
      let finish!: (value: typeof generatedResult) => void
      generateDecision.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      const { result, unmount } = renderNodeConfig(useConfig, payload, {
        nodes: [createNode({ id: 'node', data: payload })],
      })

      act(() => result.current.config.handleGenerate())
      await waitFor(() => expect(generateDecision).toHaveBeenCalledTimes(1))
      nodeDataUpdates.length = 0
      unmount()
      await act(async () => {
        finish(generatedResult)
      })

      // The closed panel writes nothing: the late response is dropped.
      expect(nodeDataUpdates).toHaveLength(0)
    })
  })

  describe('extra outputs', () => {
    it('drops a removed outcome from every extra value table', () => {
      const payload = createPayload({
        outcomes: [
          { id: 'outcome-1', label: 'Refund', when: { logical_operator: 'and', conditions: [] } },
          { id: 'outcome-2', label: 'Reject', when: { logical_operator: 'and', conditions: [] } },
        ],
        extras: [
          { name: 'note', from: 'fixed', values: { 'outcome-1': 'a', 'outcome-2': 'b' } },
          { name: 'risk', from: 'fixed', values: { 'outcome-2': 'low' } },
        ],
      })
      const { result } = renderNodeConfig(useConfig, payload, {})

      act(() => result.current.config.handleRemoveOutcome('outcome-2'))

      const node = result.current.flow.getNode('node')!.data as DecisionNodeType
      expect(node.extras).toEqual([
        { name: 'note', from: 'fixed', values: { 'outcome-1': 'a' } },
        { name: 'risk', from: 'fixed', values: {} },
      ])
    })

    it('adds, edits and removes extras', () => {
      const payload = createPayload()
      const { result } = renderNodeConfig(useConfig, payload, {})

      act(() => result.current.config.handleAddExtra())
      act(() => result.current.config.handleCommitExtraName(0, 'customer_note'))
      act(() => result.current.config.handleUpdateExtraSource(0, 'model'))
      act(() => result.current.config.handleUpdateExtraHint(0, 'what the user wants'))

      let node = result.current.flow.getNode('node')!.data as DecisionNodeType
      expect(node.extras).toEqual([
        { name: 'customer_note', from: 'model', values: {}, hint: 'what the user wants' },
      ])

      act(() => result.current.config.handleUpdateExtraSource(0, 'fixed'))
      act(() => result.current.config.handleUpdateExtraValue(0, 'outcome-1', 'needs a look'))

      node = result.current.flow.getNode('node')!.data as DecisionNodeType
      expect(node.extras[0]).toEqual({
        name: 'customer_note',
        from: 'fixed',
        values: { 'outcome-1': 'needs a look' },
        hint: 'what the user wants',
      })

      act(() => result.current.config.handleRemoveExtra(0))
      node = result.current.flow.getNode('node')!.data as DecisionNodeType
      expect(node.extras).toEqual([])
    })

    it('commits an extra name once, after the edit ends, and follows downstream references', () => {
      const payload = createPayload({
        outcomes: [],
        extras: [{ name: 'note', from: 'fixed', values: {}, hint: '' }],
      })
      const downstream = createNode({
        id: 'downstream',
        data: {
          type: BlockEnum.Code,
          title: 'Code',
          desc: '',
          code_language: 'python3',
          code: '',
          outputs: {},
          variables: [{ variable: 'input', value_selector: ['node', 'note'] }],
        },
      })
      const { result } = renderNodeConfig(useConfig, payload, {
        nodes: [createNode({ id: 'node', data: payload }), downstream],
        edges: [createEdge({ source: 'node', target: 'downstream', sourceHandle: 'otherwise' })],
      })
      const readDownstreamSelector = () =>
        result.current.flow.getNode('downstream')!.data.variables[0]!.value_selector as string[]

      // The intermediate empty draft never reaches node data, so the
      // committed identity survives to the next commit.
      act(() => result.current.config.handleCommitExtraName(0, ''))
      let node = result.current.flow.getNode('node')!.data as DecisionNodeType
      expect(node.extras[0]!.name).toBe('note')
      expect(readDownstreamSelector()).toEqual(['node', 'note'])

      act(() => result.current.config.handleCommitExtraName(0, 'new_note'))
      node = result.current.flow.getNode('node')!.data as DecisionNodeType
      expect(node.extras[0]!.name).toBe('new_note')
      expect(readDownstreamSelector()).toEqual(['node', 'new_note'])
    })

    it('keeps the committed name when a draft is invalid', () => {
      const payload = createPayload({
        outcomes: [],
        extras: [{ name: 'note', from: 'fixed', values: {}, hint: '' }],
      })
      const { result } = renderNodeConfig(useConfig, payload, {})

      act(() => result.current.config.handleCommitExtraName(0, '1bad'))
      act(() => result.current.config.handleCommitExtraName(0, 'outcome'))
      act(() => result.current.config.handleCommitExtraName(0, '   '))

      const node = result.current.flow.getNode('node')!.data as DecisionNodeType
      expect(node.extras[0]!.name).toBe('note')
    })
  })
})
