import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { Node } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import DataSourceOptions from '../index'

const mockUseDatasourceOptions = vi.fn()

vi.mock('../../hooks', () => ({
  useDatasourceOptions: (nodes: Node<DataSourceNodeType>[]) => mockUseDatasourceOptions(nodes),
}))

vi.mock('../option-card', () => ({
  default: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
}))

const createNode = (id: string, title: string): Node<DataSourceNodeType> => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    title,
    desc: '',
    type: BlockEnum.DataSource,
    plugin_id: `plugin-${id}`,
    provider_type: 'local_file',
    provider_name: 'Test Provider',
    datasource_name: `datasource-${id}`,
    datasource_label: title,
    datasource_parameters: {},
    datasource_configurations: {},
  },
})

const nodes = [createNode('node-1', 'Local files'), createNode('node-2', 'Notion')]
const options = nodes.map((node) => ({
  label: node.data.title,
  value: node.id,
  data: node.data,
}))

describe('DataSourceOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseDatasourceOptions.mockReturnValue(options)
  })

  it('selects the first data source when none is selected', () => {
    const onSelect = vi.fn()

    render(<DataSourceOptions pipelineNodes={nodes} datasourceNodeId="" onSelect={onSelect} />)

    expect(onSelect).toHaveBeenCalledWith({
      nodeId: 'node-1',
      nodeData: nodes[0]!.data,
    })
  })

  it('keeps an existing data source selection on mount', () => {
    const onSelect = vi.fn()

    render(
      <DataSourceOptions pipelineNodes={nodes} datasourceNodeId="node-2" onSelect={onSelect} />,
    )

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('returns the selected data source', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <DataSourceOptions pipelineNodes={nodes} datasourceNodeId="node-1" onSelect={onSelect} />,
    )

    await user.click(screen.getByRole('button', { name: 'Notion' }))

    expect(onSelect).toHaveBeenCalledWith({
      nodeId: 'node-2',
      nodeData: nodes[1]!.data,
    })
  })

  it('does not select anything when the pipeline has no data sources', () => {
    const onSelect = vi.fn()
    mockUseDatasourceOptions.mockReturnValue([])

    render(<DataSourceOptions pipelineNodes={[]} datasourceNodeId="" onSelect={onSelect} />)

    expect(onSelect).not.toHaveBeenCalled()
  })
})
