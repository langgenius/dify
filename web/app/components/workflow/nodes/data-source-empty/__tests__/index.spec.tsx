import type { ComponentProps, ReactNode } from 'react'
import type { OnSelectBlock } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import DataSourceEmptyNode from '../index'

const mockUseReplaceDataSourceNode = vi.hoisted(() => vi.fn())

vi.mock('../hooks', () => ({
  useReplaceDataSourceNode: mockUseReplaceDataSourceNode,
}))

vi.mock('@/app/components/workflow/block-selector', () => ({
  default: ({
    onSelect,
    trigger,
  }: {
    onSelect: OnSelectBlock
    trigger: ((open?: boolean) => ReactNode) | ReactNode
  }) => (
    <div>
      {typeof trigger === 'function' ? trigger(false) : trigger}
      <button
        type="button"
        onClick={() => onSelect(BlockEnum.DataSource, {
          plugin_id: 'plugin-id',
          provider_type: 'datasource',
          provider_name: 'file',
          datasource_name: 'local-file',
          datasource_label: 'Local File',
          title: 'Local File',
        })}
      >
        select data source
      </button>
    </div>
  ),
}))

type DataSourceEmptyNodeProps = ComponentProps<typeof DataSourceEmptyNode>

const createNodeProps = (): DataSourceEmptyNodeProps => ({
  id: 'data-source-empty-node',
  data: {
    width: 240,
    height: 88,
  },
  type: 'default',
  selected: false,
  zIndex: 0,
  isConnectable: true,
  xPos: 0,
  yPos: 0,
  dragging: false,
  dragHandle: undefined,
} as unknown as DataSourceEmptyNodeProps)

describe('DataSourceEmptyNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseReplaceDataSourceNode.mockReturnValue({
      handleReplaceNode: vi.fn(),
    })
  })

  // The empty datasource node should render the add trigger and forward selector choices.
  describe('Rendering and Selection', () => {
    it('should render the datasource add trigger', () => {
      render(
        <DataSourceEmptyNode {...createNodeProps()} />,
      )

      expect(screen.getByText('workflow.nodes.dataSource.add')).toBeInTheDocument()
      expect(screen.getByText('workflow.blocks.datasource')).toBeInTheDocument()
    })

    it('should forward block selections to the replace hook', async () => {
      const user = userEvent.setup()
      const handleReplaceNode = vi.fn()
      mockUseReplaceDataSourceNode.mockReturnValue({
        handleReplaceNode,
      })

      render(
        <DataSourceEmptyNode {...createNodeProps()} />,
      )

      await user.click(screen.getByRole('button', { name: 'select data source' }))

      expect(handleReplaceNode).toHaveBeenCalledWith(BlockEnum.DataSource, {
        plugin_id: 'plugin-id',
        provider_type: 'datasource',
        provider_name: 'file',
        datasource_name: 'local-file',
        datasource_label: 'Local File',
        title: 'Local File',
      })
    })
  })
})
