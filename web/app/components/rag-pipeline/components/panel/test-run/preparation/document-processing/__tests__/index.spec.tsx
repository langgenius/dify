import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowContext } from '@/app/components/workflow/context'
import { renderEditor } from '@/app/components/workflow/editor-resource/__tests__/render'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { createDeferred } from '@/test/deferred'
import { createPipelineVariable } from '@/test/pipeline-variables'
import DocumentProcessing from '../index'

const { parameters } = vi.hoisted(() => ({ parameters: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.workflows.draft.processing.parameters.get': parameters,
    }),
  }
})

it('waits for processing parameters, then submits user input through the generated form', async () => {
  const user = userEvent.setup()
  const response = createDeferred<{ variables: ReturnType<typeof createPipelineVariable>[] }>()
  parameters.mockReturnValue(response.promise)
  const onProcess = vi.fn()
  const onBack = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  renderEditor(
    <QueryClientProvider client={client}>
      <WorkflowContext value={createWorkflowStore({})}>
        <DocumentProcessing dataSourceNodeId="source-node" onProcess={onProcess} onBack={onBack} />
      </WorkflowContext>
    </QueryClientProvider>,
    { resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' } },
  )
  const process = screen.getByRole('button', { name: 'datasetPipeline.operations.process' })
  expect(process).toBeDisabled()
  await user.click(process)
  expect(onProcess).not.toHaveBeenCalled()
  response.resolve({ variables: [createPipelineVariable({ default_value: 'original' })] })
  const input = await screen.findByRole('textbox', { name: /Source/ })
  expect(input).toHaveValue('original')
  expect(parameters).toHaveBeenCalledWith({
    params: { pipeline_id: 'pipeline-1' },
    query: { node_id: 'source-node' },
  })
  await user.clear(input)
  await user.type(input, 'edited')
  await user.click(process)
  await waitFor(() => expect(onProcess).toHaveBeenCalledExactlyOnceWith({ source: 'edited' }))
  await user.click(
    screen.getByRole('button', { name: 'datasetPipeline.operations.backToDataSource' }),
  )
  expect(onBack).toHaveBeenCalledOnce()
})
