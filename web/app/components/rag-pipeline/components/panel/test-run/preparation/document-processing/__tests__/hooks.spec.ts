import { act, waitFor } from '@testing-library/react'
import { renderEditorHook as renderHook } from '@/app/components/workflow/editor-resource/__tests__/render'
import { createDeferred } from '@/test/deferred'
import { useInputVariables } from '../hooks'

const { getParams } = vi.hoisted(() => ({ getParams: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.workflows.draft.processing.parameters.get': getParams,
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
const renderVariables = () =>
  renderHook(() => useInputVariables('node-1'), {
    resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
  })

describe('useInputVariables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getParams.mockResolvedValue(response)
  })
  it('fetches processing parameters for the current pipeline and node', async () => {
    const { result } = renderVariables()
    await waitFor(() => expect(result.current.paramsConfig?.variables).toHaveLength(1))
    expect(result.current.paramsConfig?.variables[0]).toMatchObject(response.variables[0]!)
    expect(getParams).toHaveBeenCalledWith({
      params: { pipeline_id: 'pipeline-1' },
      query: { node_id: 'node-1' },
    })
    expect(result.current.isFetchingParams).toBe(false)
  })
  it('stays fetching until processing parameters resolve', async () => {
    const pending = createDeferred<typeof response>()
    getParams.mockReturnValue(pending.promise)
    const { result } = renderVariables()
    expect(result.current.isFetchingParams).toBe(true)
    expect(result.current.paramsConfig).toBeUndefined()
    await act(async () => pending.resolve(response))
    await waitFor(() => expect(result.current.isFetchingParams).toBe(false))
    expect(result.current.paramsConfig?.variables).toHaveLength(1)
  })
})
