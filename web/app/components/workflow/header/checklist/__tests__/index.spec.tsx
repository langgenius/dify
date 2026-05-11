import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum } from '../../../types'
import WorkflowChecklist from '../index'

let mockChecklistItems = [
  {
    id: 'plugin-1',
    type: BlockEnum.Tool,
    title: 'Missing Plugin',
    errorMessages: [],
    canNavigate: false,
    isPluginMissing: true,
  },
  {
    id: 'node-1',
    type: BlockEnum.LLM,
    title: 'Broken Node',
    errorMessages: ['Needs configuration'],
    canNavigate: true,
    isPluginMissing: false,
  },
]

const mockHandleNodeSelect = vi.fn()

type PopoverProps = {
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

let latestOnOpenChange: PopoverProps['onOpenChange']

vi.mock('reactflow', () => ({
  useEdges: () => [],
}))

vi.mock('@/app/components/workflow/store/workflow/use-nodes', () => ({
  default: () => [],
}))

vi.mock('../../../hooks', () => ({
  useChecklist: () => mockChecklistItems,
  useNodesInteractions: () => ({
    handleNodeSelect: mockHandleNodeSelect,
  }),
}))

vi.mock('@langgenius/dify-ui/popover', () => ({
  Popover: ({ children, onOpenChange }: PopoverProps) => {
    latestOnOpenChange = onOpenChange
    return <div data-testid="popover">{children}</div>
  },
  PopoverTrigger: ({ render }: { render: ReactNode }) => <>{render}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTitle: ({ children, className }: { children: ReactNode, className?: string }) => <h2 className={className}>{children}</h2>,
  PopoverDescription: ({ children, className }: { children: ReactNode, className?: string }) => <p className={className}>{children}</p>,
  PopoverClose: ({ children, className }: { children: ReactNode, className?: string }) => <button className={className}>{children}</button>,
}))

vi.mock('../plugin-group', () => ({
  ChecklistPluginGroup: ({ items }: { items: Array<{ title: string }> }) => <div data-testid="plugin-group">{items.map(item => item.title).join(',')}</div>,
}))

vi.mock('../node-group', () => ({
  ChecklistNodeGroup: ({ item, onItemClick }: { item: { title: string }, onItemClick: (item: { title: string }) => void }) => (
    <button data-testid={`node-group-${item.title}`} onClick={() => onItemClick(item)}>
      {item.title}
    </button>
  ),
}))

describe('WorkflowChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestOnOpenChange = undefined
    mockChecklistItems = [
      {
        id: 'plugin-1',
        type: BlockEnum.Tool,
        title: 'Missing Plugin',
        errorMessages: [],
        canNavigate: false,
        isPluginMissing: true,
      },
      {
        id: 'node-1',
        type: BlockEnum.LLM,
        title: 'Broken Node',
        errorMessages: ['Needs configuration'],
        canNavigate: true,
        isPluginMissing: false,
      },
    ]
  })

  it('should split checklist items into plugin and node groups and delegate clicks to node selection by default', () => {
    render(<WorkflowChecklist disabled={false} />)

    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-group')).toHaveTextContent('Missing Plugin')
    fireEvent.click(screen.getByTestId('node-group-Broken Node'))

    expect(mockHandleNodeSelect).toHaveBeenCalledWith('node-1')
  })

  it('should use the custom item click handler when provided', () => {
    const onItemClick = vi.fn()
    render(<WorkflowChecklist disabled={false} onItemClick={onItemClick} />)

    fireEvent.click(screen.getByTestId('node-group-Broken Node'))

    expect(onItemClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'node-1' }))
    expect(mockHandleNodeSelect).not.toHaveBeenCalled()
  })

  it('should render the resolved state when there are no checklist warnings', () => {
    mockChecklistItems = []

    render(<WorkflowChecklist disabled={false} />)

    expect(screen.getByText(/checklistResolved/i)).toBeInTheDocument()
  })

  it('should ignore popover open changes when the checklist is disabled', () => {
    render(<WorkflowChecklist disabled={true} />)

    latestOnOpenChange?.(true)

    expect(screen.getByText('2').closest('button')).toBeDisabled()
  })
})
