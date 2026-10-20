import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { PipelineInputVarType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as render,
} from '@/test/console/query-data'
import ProcessDocuments from '../index'

// Mock dataset detail context - required for useInputVariables hook
const mockPipelineId = 'pipeline-123'
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: { dataset: { pipeline_id: string } }) => string,
  ) => selector({ dataset: { pipeline_id: mockPipelineId } }),
}))

const variables = [
  {
    belong_to_node_id: 'node-123',
    type: PipelineInputVarType.textInput,
    variable: 'separator',
    label: 'Separator',
    required: true,
    default_value: '---',
  },
]
const input = { params: { pipeline_id: 'pipeline-123' }, query: { node_id: 'node-123' } }
const defaultProps = {
  datasourceNodeId: 'node-123',
  lastRunInputData: {},
  isRunning: false,
  onProcess: vi.fn(),
  onPreview: vi.fn(),
  onSubmit: vi.fn(),
}
const renderComponent = (props = {}) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.rag.pipelines.byPipelineId.workflows.published.processing.parameters.get.queryKey({
      input,
    }),
    { variables },
  )
  const ref = createRef<{ submit: () => void }>()
  return {
    ref,
    ...render(<ProcessDocuments {...defaultProps} ref={ref} {...props} />, { queryClient }),
  }
}

describe('Pipeline processing settings', () => {
  it.each([{}, { separator: 'previous' }])(
    'restores saved input before submitting an edited value',
    async (lastRunInputData) => {
      const user = userEvent.setup()
      const { ref } = renderComponent({ lastRunInputData })
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' }),
        ).toBeEnabled(),
      )
      const field = screen.getByRole('textbox', { name: /Separator/ })
      expect(field).toHaveValue(lastRunInputData.separator ?? '---')
      await user.clear(field)
      await user.type(field, '|||')
      await act(async () => ref.current!.submit())
      await waitFor(() => expect(defaultProps.onSubmit).toHaveBeenCalledWith({ separator: '|||' }))
    },
  )

  it.each([false, true])('gates processing and preview while running=%s', async (isRunning) => {
    const user = userEvent.setup()
    renderComponent({ isRunning })
    await user.click(
      screen.getByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' }),
    )
    await user.click(screen.getByRole('button', { name: /preview/i }))
    expect(defaultProps.onProcess).toHaveBeenCalledTimes(isRunning ? 0 : 1)
    expect(defaultProps.onPreview).toHaveBeenCalledTimes(isRunning ? 0 : 1)
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.workflows.published.processing.parameters.get': async () => ({
        variables: [
          {
            belong_to_node_id: 'node-123',
            type: PipelineInputVarType.textInput,
            variable: 'separator',
            label: 'Separator',
            required: true,
            default_value: '---',
          },
        ],
      }),
    }),
  }
})
