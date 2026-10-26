import { act, waitFor } from '@testing-library/react'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { useInputVariables } from '../hooks'

const { getParams } = vi.hoisted(() => ({ getParams: vi.fn() }))
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: { dataset: { pipeline_id: string } }) => unknown,
  ) => selector({ dataset: { pipeline_id: 'pipeline-1' } }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.workflows.published.processing.parameters.get': getParams,
    }),
  }
})

const response = {
  variables: [
    {
      variable: 'chunkSize',
      label: 'Chunk size',
      type: 'number',
      required: true,
      default_value: 100,
    },
  ],
}
const renderVariables = () => renderHook(() => useInputVariables('node-1'))

describe('useInputVariables', () => {
  it('loads the current pipeline and node parameters before exposing the configuration', async () => {
    const pending = createDeferred<typeof response>()
    getParams.mockReturnValue(pending.promise)
    const { result } = renderVariables()
    expect(result.current.isFetchingParams).toBe(true)
    expect(result.current.paramsConfig).toBeUndefined()
    await act(async () => pending.resolve(response))
    await waitFor(() => expect(result.current.isFetchingParams).toBe(false))
    expect(result.current.paramsConfig?.variables).toEqual(response.variables)
    expect(getParams).toHaveBeenCalledWith({
      params: { pipeline_id: 'pipeline-1' },
      query: { node_id: 'node-1' },
    })
  })
})
