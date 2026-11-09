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
})
