import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import DataSourceEmptyNode from '../index'

const mockUseReplaceDataSourceNode = vi.hoisted(() => vi.fn())

vi.mock('../hooks', () => ({
  useReplaceDataSourceNode: mockUseReplaceDataSourceNode,
}))

type DataSourceEmptyNodeProps = ComponentProps<typeof DataSourceEmptyNode>

const createNodeProps = (): DataSourceEmptyNodeProps =>
  ({
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
  }) as unknown as DataSourceEmptyNodeProps

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
      render(<DataSourceEmptyNode {...createNodeProps()} />)

      expect(screen.getByText('workflow.nodes.dataSource.add')).toBeInTheDocument()
      expect(screen.getByText('workflow.blocks.datasource')).toBeInTheDocument()
    })
  })
})
