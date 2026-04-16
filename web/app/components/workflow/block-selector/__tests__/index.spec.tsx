import type { NodeDefault, ToolWithProvider } from '../../types'
import { screen } from '@testing-library/react'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import NodeSelectorWrapper from '../index'
import { BlockClassificationEnum } from '../types'

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock())

vi.mock('@/service/use-plugins', () => ({
  useFeaturedToolsRecommendations: () => ({
    plugins: [],
    isLoading: false,
  }),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: [] }),
  useAllCustomTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
  useAllMCPTools: () => ({ data: [] }),
  useInvalidateAllBuiltInTools: () => vi.fn(),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: { enable_marketplace: boolean } }) => unknown) => selector({
    systemFeatures: { enable_marketplace: false },
  }),
}))

const createBlock = (type: BlockEnum, title: string): NodeDefault => ({
  metaData: {
    type,
    title,
    sort: 0,
    classification: BlockClassificationEnum.Default,
    author: 'Dify',
    description: `${title} description`,
  },
  defaultValue: {},
  checkValid: () => ({ isValid: true }),
})

const dataSource: ToolWithProvider = {
  id: 'datasource-1',
  name: 'datasource',
  author: 'Dify',
  description: { en_US: 'Data source', zh_Hans: '数据源' },
  icon: 'icon',
  label: { en_US: 'Data Source', zh_Hans: 'Data Source' },
  type: 'datasource' as ToolWithProvider['type'],
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
  tools: [],
  meta: { version: '1.0.0' } as ToolWithProvider['meta'],
}

describe('NodeSelectorWrapper', () => {
  it('filters hidden block types from hooks store and forwards data sources', async () => {
    renderWorkflowComponent(
      <NodeSelectorWrapper
        open
        onSelect={vi.fn()}
        availableBlocksTypes={[BlockEnum.Code]}
      />,
      {
        hooksStoreProps: {
          availableNodesMetaData: {
            nodes: [
              createBlock(BlockEnum.Start, 'Start'),
              createBlock(BlockEnum.Tool, 'Tool'),
              createBlock(BlockEnum.Code, 'Code'),
              createBlock(BlockEnum.DataSource, 'Data Source'),
            ],
          },
        },
        initialStoreState: {
          dataSourceList: [dataSource],
        },
      },
    )

    expect(await screen.findByText('Code')).toBeInTheDocument()
    expect(screen.queryByText('Start')).not.toBeInTheDocument()
    expect(screen.queryByText('Tool')).not.toBeInTheDocument()
  })
})
