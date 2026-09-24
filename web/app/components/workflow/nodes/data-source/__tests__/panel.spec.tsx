import type { DataSourceNodeType } from '../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum } from '@/app/components/workflow/types'
import Panel from '../panel'

const { update, get } = vi.hoisted(() => ({
  update: vi.fn(),
  get: vi.fn(async (_url: string) => []),
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get,
}))
vi.mock('../../../hooks/use-node-data-update', () => ({
  useNodeDataUpdate: () => ({ handleNodeDataUpdateWithSyncDraft: update }),
}))
vi.mock('../../../hooks/use-workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/use-workflow')>()),
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
}))
vi.mock('../../_base/hooks/use-available-var-list', () => ({
  default: () => ({ availableVars: [], availableNodesWithParent: [] }),
}))

const panelProps = {
  getInputVars: () => [],
  toVarInputs: () => [],
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: () => {},
  runResult: null,
}
const createData = (overrides: Partial<DataSourceNodeType> = {}): DataSourceNodeType => ({
  title: 'Datasource',
  desc: '',
  type: BlockEnum.DataSource,
  plugin_id: 'langgenius/file',
  provider_type: 'online_document',
  provider_name: 'file',
  datasource_name: 'local-file',
  datasource_label: 'File',
  datasource_parameters: {},
  datasource_configurations: {},
  ...overrides,
})
const createProvider = () => {
  const provider = createDatasourceProvider()
  provider.declaration.datasources![0]!.parameters = [
    {
      name: 'count',
      type: 'number',
      required: true,
      default: 0,
      min: 0,
      max: 10,
      label: { en_US: 'Count', zh_Hans: null },
      description: { en_US: 'How many documents' },
    },
    {
      name: 'enabled',
      type: 'boolean',
      required: false,
      default: false,
      label: { en_US: 'Enabled' },
      description: { en_US: 'Include archived documents' },
    },
  ]
  return provider
}
beforeEach(() => vi.clearAllMocks())

it('renders real datasource fields and descriptions without tool dynamic requests, preserving numeric and boolean values', async () => {
  const user = userEvent.setup()
  const data = createData({
    datasource_parameters: {
      count: { type: VarKindType.constant, value: 0 },
      enabled: { type: VarKindType.constant, value: false },
    },
  })
  renderWorkflowFlowComponent(<Panel id="datasource" data={data} panelProps={panelProps} />, {
    nodes: [{ id: 'datasource', position: { x: 0, y: 0 }, data }],
    initialStoreState: { dataSourceList: [createProvider()] },
  })
  expect(screen.getByText('How many documents')).toBeInTheDocument()
  const count = screen.getByRole('textbox', { name: 'Count' })
  expect(count).toHaveValue('0')
  await user.click(count)
  await user.keyboard('{ArrowDown}')
  expect(count).toHaveValue('0')
  await user.clear(count)
  await user.type(count, '2')
  expect(update).toHaveBeenLastCalledWith({
    id: 'datasource',
    data: expect.objectContaining({
      datasource_parameters: expect.objectContaining({
        count: { type: VarKindType.constant, value: 2 },
      }),
    }),
  })
  await user.click(screen.getByRole('button', { name: 'False' }))
  expect(update).toHaveBeenLastCalledWith({
    id: 'datasource',
    data: expect.objectContaining({
      datasource_parameters: expect.objectContaining({
        enabled: { type: VarKindType.constant, value: false },
      }),
    }),
  })
  expect(get.mock.calls.map((call) => call[0])).not.toContain(
    '/workspaces/current/plugin/parameters/dynamic-options',
  )
})

it('renders nested and unrestricted outputs while keeping unauthorized inputs hidden', async () => {
  const user = userEvent.setup()
  const provider = createProvider()
  provider.is_authorized = false
  provider.declaration.datasources![0]!.output_schema = {
    properties: {
      metadata: {
        type: 'object',
        properties: { title: { type: 'string' }, optional: true, nullable: null },
      },
      names: { type: 'array', items: { type: 'string' } },
      unknown: false,
    },
  }
  const data = createData()
  renderWorkflowFlowComponent(<Panel id="datasource" data={data} panelProps={panelProps} />, {
    nodes: [{ id: 'datasource', position: { x: 0, y: 0 }, data }],
    initialStoreState: { dataSourceList: [provider] },
  })
  await user.click(screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' }))
  await waitFor(() => expect(screen.getByText('metadata')).toBeInTheDocument())
  expect(screen.getByText('title')).toBeInTheDocument()
  expect(screen.getByText('optional')).toBeInTheDocument()
  expect(screen.getByText('nullable')).toBeInTheDocument()
  expect(screen.getByText('array[string]')).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Count' })).not.toBeInTheDocument()
})

it('keeps local-file controls available without plugin version metadata', async () => {
  const user = userEvent.setup()
  const data = createData({ provider_type: 'local_file', fileExtensions: ['pdf', 'csv'] })
  renderWorkflowFlowComponent(<Panel id="datasource" data={data} panelProps={panelProps} />, {
    nodes: [{ id: 'datasource', position: { x: 0, y: 0 }, data }],
    initialStoreState: { dataSourceList: [createDatasourceProvider()] },
  })
  expect(screen.getByText('pdf')).toBeInTheDocument()
  expect(screen.getByText('csv')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' }))
  expect(screen.getByText('datasource_type')).toBeInTheDocument()
  expect(screen.getByText('transfer_method')).toBeInTheDocument()
})
