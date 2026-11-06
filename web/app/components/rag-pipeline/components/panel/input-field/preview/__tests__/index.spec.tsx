import type { Datasource } from '../../../test-run/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { createPipelineVariable } from '@/test/pipeline-variables'
import PreviewPanel from '../index'

const { preProcessing, processing } = vi.hoisted(() => ({
  preProcessing: vi.fn(),
  processing: vi.fn(),
}))
// Provider catalog icons are independently tested; these scenarios own graph selection and forms.
vi.mock('@/app/components/workflow/hooks/use-tool-icon', () => ({ useToolIcon: () => '' }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.workflows.draft.preProcessing.parameters.get': preProcessing,
      'rag.pipelines.byPipelineId.workflows.draft.processing.parameters.get': processing,
    }),
  }
})
const nodeData: Datasource['nodeData'] = {
  type: BlockEnum.DataSource,
  title: 'Source',
  desc: '',
  plugin_id: 'plugin-1',
  provider_type: 'online_document',
  provider_name: 'source',
  datasource_name: 'source',
  datasource_label: 'Source',
  datasource_parameters: {},
  datasource_configurations: {},
}

const nodes = ['source-1', 'source-2'].map((id) => ({
  id,
  position: { x: 0, y: 0 },
  data: { ...nodeData, title: id },
}))

it('loads both forms for the selected datasource and replaces their parameters when selection changes', async () => {
  const user = userEvent.setup()
  preProcessing.mockImplementation(async ({ query }: { query: { node_id: string } }) => ({
    variables: [
      createPipelineVariable({
        variable: `url_${query.node_id}`,
        label: `URL ${query.node_id}`,
        default_value: `https://${query.node_id}.example.com`,
      }),
    ],
  }))
  processing.mockImplementation(async ({ query }: { query: { node_id: string } }) => ({
    variables: [
      createPipelineVariable({
        variable: `prompt_${query.node_id}`,
        label: `Prompt ${query.node_id}`,
        default_value: `Process ${query.node_id}`,
      }),
    ],
  }))
  renderWorkflowFlowComponent(<PreviewPanel />, {
    resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
    nodes,
    initialStoreState: { showInputFieldPreviewPanel: true },
  })
  await user.click(await screen.findByRole('radio', { name: 'source-1' }))
  expect(screen.getByRole('radio', { name: 'source-1' })).toBeChecked()
  expect(await screen.findByRole('textbox', { name: /URL source-1/ })).toHaveValue(
    'https://source-1.example.com',
  )
  expect(await screen.findByRole('textbox', { name: /Prompt source-1/ })).toHaveValue(
    'Process source-1',
  )
  await user.click(screen.getByRole('radio', { name: 'source-2' }))
  expect(await screen.findByRole('textbox', { name: /URL source-2/ })).toHaveValue(
    'https://source-2.example.com',
  )
  expect(await screen.findByRole('textbox', { name: /Prompt source-2/ })).toHaveValue(
    'Process source-2',
  )
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: /URL source-1/ })).not.toBeInTheDocument(),
  )
  expect(screen.queryByRole('textbox', { name: /Prompt source-1/ })).not.toBeInTheDocument()
  for (const request of [preProcessing, processing]) {
    expect(request).toHaveBeenCalledWith({
      params: { pipeline_id: 'pipeline-1' },
      query: { node_id: 'source-2' },
    })
  }
})

it('does not request either form when the graph has no datasource', () => {
  renderWorkflowFlowComponent(<PreviewPanel />, {
    resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
  })
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(preProcessing).not.toHaveBeenCalled()
  expect(processing).not.toHaveBeenCalled()
})
