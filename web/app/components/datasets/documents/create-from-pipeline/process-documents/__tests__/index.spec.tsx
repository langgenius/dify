import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import DatasetDetailContext from '@/context/dataset-detail'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import ProcessDocuments from '../index'

const getParameters = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.workflows.published.processing.parameters.get': getParameters,
    }),
  }
})
const parameters = {
  variables: [
    {
      type: 'text-input',
      belong_to_node_id: 'node-1',
      variable: 'separator',
      label: 'Separator',
      required: false,
      default_value: '---',
    },
  ],
}
function renderProcess({ loading = false, isRunning = false } = {}) {
  const queryClient = createConsoleQueryClient()
  if (!loading)
    queryClient.setQueryData(
      consoleQuery.rag.pipelines.byPipelineId.workflows.published.processing.parameters.get.queryKey(
        { input: { params: { pipeline_id: 'pipeline-1' }, query: { node_id: 'node-1' } } },
      ),
      parameters,
    )
  const ref = createRef<{ submit: () => void }>()
  const callbacks = { onProcess: vi.fn(), onPreview: vi.fn(), onBack: vi.fn(), onSubmit: vi.fn() }
  renderWithConsoleQuery(
    <DatasetDetailContext.Provider
      value={{ dataset: createDatasetFixture({ pipeline_id: 'pipeline-1' }) }}
    >
      <ProcessDocuments ref={ref} dataSourceNodeId="node-1" isRunning={isRunning} {...callbacks} />
    </DatasetDetailContext.Provider>,
    { queryClient },
  )
  return { ref, ...callbacks }
}
it.each([
  { action: 'onProcess', name: 'datasetPipeline.operations.saveAndProcess' },
  { action: 'onBack', name: 'datasetPipeline.operations.dataSource' },
  { action: 'onPreview', name: 'datasetPipeline.addDocuments.stepTwo.previewChunks' },
] as const)('routes $action from the real processing form', async ({ action, name }) => {
  const user = userEvent.setup()
  const callbacks = renderProcess()
  await user.click(screen.getByRole('button', { name }))
  expect(callbacks[action]).toHaveBeenCalledOnce()
})
it.each([false, true])(
  'disables processing while parameters load (running=%s)',
  async (isRunning) => {
    const pending = createDeferred<typeof parameters>()
    getParameters.mockReturnValueOnce(pending.promise)
    renderProcess({ loading: true, isRunning })
    const process = screen.getByRole('button', {
      name: 'datasetPipeline.operations.saveAndProcess',
    })
    expect(process).toBeDisabled()
    await act(async () => pending.resolve(parameters))
    await waitFor(() =>
      expect(getParameters).toHaveBeenCalledWith({
        params: { pipeline_id: 'pipeline-1' },
        query: { node_id: 'node-1' },
      }),
    )
    if (isRunning) expect(process).toBeDisabled()
    else await waitFor(() => expect(process).toBeEnabled())
  },
)
it('converts published variables to editable defaults and submits the edited values', async () => {
  const user = userEvent.setup()
  const { ref, onSubmit } = renderProcess()
  const input = screen.getByRole('textbox', { name: 'Separator' })
  expect(input).toHaveValue('---')
  await user.clear(input)
  await user.type(screen.getByRole('textbox', { name: 'Separator' }), '|||')
  await act(async () => ref.current!.submit())
  await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ separator: '|||' }))
})
