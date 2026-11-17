import { act, renderHook } from '@testing-library/react'
import { useEvaluationStore, useIsEvaluationConfigDirty } from '../store'

const resourceId = 'app-1'
const nodeInfo = { node_id: 'llm-1', title: 'LLM', type: 'llm' }

describe('evaluation config change tracking', () => {
  beforeEach(() => {
    useEvaluationStore.setState({ resources: {}, initialResources: {}, conditionErrorsVisible: {} })
  })

  it('treats a removed and re-added metric as unchanged', () => {
    act(() => {
      useEvaluationStore.getState().hydrateResource('apps', resourceId, {
        evaluation_framework: 'ragas',
        evaluation_model: 'claude-sonnet-5',
        evaluation_model_provider: 'anthropic',
        default_metrics: [{ metric: 'answer_correctness', node_info_list: [nodeInfo] }],
      })
    })
    const { result } = renderHook(() => useIsEvaluationConfigDirty('apps', resourceId))
    expect(result.current).toBe(false)

    const metricId = useEvaluationStore.getState().resources[`apps:${resourceId}`]!.metrics[0]!.id
    act(() => useEvaluationStore.getState().removeMetric('apps', resourceId, metricId))
    expect(result.current).toBe(true)

    // Re-adding generates a new id, which is not a configuration change.
    act(() =>
      useEvaluationStore
        .getState()
        .addBuiltinMetric('apps', resourceId, 'answer_correctness', [nodeInfo]),
    )
    expect(result.current).toBe(false)
  })

  it('applies renamed node titles without marking the config dirty', () => {
    act(() => {
      useEvaluationStore.getState().hydrateResource('apps', resourceId, {
        evaluation_framework: 'ragas',
        evaluation_model: 'claude-sonnet-5',
        evaluation_model_provider: 'anthropic',
        default_metrics: [{ metric: 'answer_correctness', node_info_list: [nodeInfo] }],
      })
    })
    const { result } = renderHook(() => useIsEvaluationConfigDirty('apps', resourceId))

    act(() =>
      useEvaluationStore
        .getState()
        .syncNodeTitles('apps', resourceId, new Map([['llm-1', 'Answer Writer']])),
    )

    const state = useEvaluationStore.getState()
    expect(state.resources[`apps:${resourceId}`]!.metrics[0]!.nodeInfoList).toEqual([
      { ...nodeInfo, title: 'Answer Writer' },
    ])
    expect(result.current).toBe(false)

    // Reset restores the saved config, which carries the new title as well.
    act(() => useEvaluationStore.getState().resetResourceConfig('apps', resourceId))
    expect(
      useEvaluationStore.getState().resources[`apps:${resourceId}`]!.metrics[0]!.nodeInfoList?.[0]
        ?.title,
    ).toBe('Answer Writer')
  })

  it('keeps the store unchanged when titles already match', () => {
    act(() => {
      useEvaluationStore.getState().hydrateResource('apps', resourceId, {
        evaluation_framework: 'ragas',
        default_metrics: [{ metric: 'answer_correctness', node_info_list: [nodeInfo] }],
      })
    })
    const before = useEvaluationStore.getState()

    act(() =>
      useEvaluationStore.getState().syncNodeTitles('apps', resourceId, new Map([['llm-1', 'LLM']])),
    )

    expect(useEvaluationStore.getState()).toBe(before)
  })
})
