import type { consoleClient } from '@/service/console'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWorkflowRunningData } from '@/app/components/workflow/__tests__/fixtures'
import { WorkflowContext } from '@/app/components/workflow/context'
import { renderEditor } from '@/app/components/workflow/editor-resource/__tests__/render'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { toast } from '@/app/notifications'
import { AppToastHost } from '@/app/notifications/host'
import { expectLoadingButton } from '@/test/button'
import { createDeferred } from '@/test/deferred'
import { createPipelineVariable } from '@/test/pipeline-variables'
import { createTestQueryClient } from '@/test/query-client'
import DocumentProcessing from '../index'

const { parameters } = vi.hoisted(() => ({
  parameters:
    vi.fn<
      typeof consoleClient.rag.pipelines.byPipelineId.workflows.draft.processing.parameters.get
    >(),
}))
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

beforeEach(() => {
  parameters.mockReset().mockResolvedValue({
    variables: [createPipelineVariable({ default_value: 'original' })],
  })
})
afterEach(() => act(() => toast.dismiss()))

function setup() {
  const user = userEvent.setup()
  const store = createWorkflowStore({})
  const onProcess = vi.fn<(data: Record<string, unknown>) => void>()
  const onBack = vi.fn()
  const client = createTestQueryClient()
  const view = (dataSourceNodeId: string) => (
    <QueryClientProvider client={client}>
      <WorkflowContext value={store}>
        <AppToastHost />
        <DocumentProcessing
          dataSourceNodeId={dataSourceNodeId}
          onProcess={onProcess}
          onBack={onBack}
        />
      </WorkflowContext>
    </QueryClientProvider>
  )
  const rendered = renderEditor(view('source-node'), {
    resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
  })
  return {
    user,
    store,
    onProcess,
    onBack,
    changeSource: (id: string) => rendered.rerender(view(id)),
  }
}
const process = () => screen.getByRole('button', { name: /datasetPipeline.operations.process/ })

it('waits for processing parameters, then submits user input through the generated form', async () => {
  const response = createDeferred<Awaited<ReturnType<typeof parameters>>>()
  parameters.mockReturnValueOnce(response.promise)
  const { user, onProcess, onBack } = setup()
  expect(process()).toBeDisabled()
  await user.click(process())
  expect(onProcess).not.toHaveBeenCalled()
  await act(async () =>
    response.resolve({
      variables: [createPipelineVariable({ default_value: 'original' })],
    }),
  )
  const input = await screen.findByRole('textbox', { name: /Source/ })
  expect(input).toHaveValue('original')
  expect(parameters).toHaveBeenCalledWith({
    params: { pipeline_id: 'pipeline-1' },
    query: { node_id: 'source-node' },
  })
  await user.clear(input)
  await user.type(input, 'edited')
  await user.click(process())
  await waitFor(() => expect(onProcess).toHaveBeenCalledExactlyOnceWith({ source: 'edited' }))
  await user.click(
    screen.getByRole('button', { name: 'datasetPipeline.operations.backToDataSource' }),
  )
  expect(onBack).toHaveBeenCalledOnce()
})

it('explains a required field error and submits the corrected value', async () => {
  const { user, onProcess } = setup()
  const input = await screen.findByRole('textbox', { name: /Source/ })
  await user.clear(input)
  await user.click(process())
  expect(await screen.findByText('Path: source Error: Source is required')).toBeInTheDocument()
  expect(onProcess).not.toHaveBeenCalled()
  await user.type(input, 'corrected')
  await user.click(process())
  await waitFor(() => expect(onProcess).toHaveBeenCalledExactlyOnceWith({ source: 'corrected' }))
})

it('prevents another submission while the pipeline is running', async () => {
  const { user, onProcess, store } = setup()
  await screen.findByRole('textbox', { name: /Source/ })
  onProcess.mockImplementationOnce(() =>
    store.getState().setWorkflowRunningData(createWorkflowRunningData()),
  )
  await user.click(process())
  await waitFor(() => expectLoadingButton(process()))
  await user.click(process())
  expect(onProcess).toHaveBeenCalledExactlyOnceWith({ source: 'original' })
})

it('loads the new datasource parameters when the selected node changes', async () => {
  const { changeSource } = setup()
  expect(await screen.findByRole('textbox', { name: /Source/ })).toHaveValue('original')
  parameters.mockResolvedValueOnce({
    variables: [
      createPipelineVariable({
        variable: 'destination',
        label: 'Destination',
        default_value: 'new source',
      }),
    ],
  })
  changeSource('another-node')
  expect(await screen.findByRole('textbox', { name: /Destination/ })).toHaveValue('new source')
  expect(screen.queryByRole('textbox', { name: /Source/ })).not.toBeInTheDocument()
  expect(parameters).toHaveBeenLastCalledWith({
    params: { pipeline_id: 'pipeline-1' },
    query: { node_id: 'another-node' },
  })
})
