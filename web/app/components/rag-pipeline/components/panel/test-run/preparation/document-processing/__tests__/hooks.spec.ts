import { waitFor } from '@testing-library/react'
import { renderEditorHook as renderHook } from '@/app/components/workflow/editor-resource/__tests__/render'
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
it('fetches the new node parameters when the selected datasource changes', async () => {
  getParams.mockResolvedValueOnce(response).mockResolvedValueOnce({ variables: [] })
  const { result, rerender } = renderHook(({ nodeId }) => useInputVariables(nodeId), {
    initialProps: { nodeId: 'node-1' },
    resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
  })
  await waitFor(() => expect(result.current.paramsConfig?.variables).toEqual(response.variables))

  rerender({ nodeId: 'node-2' })

  await waitFor(() => expect(result.current.paramsConfig?.variables).toEqual([]))
  expect(getParams).toHaveBeenLastCalledWith({
    params: { pipeline_id: 'pipeline-1' },
    query: { node_id: 'node-2' },
  })
})
