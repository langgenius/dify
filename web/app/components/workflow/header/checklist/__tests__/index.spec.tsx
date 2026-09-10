import type { ChecklistItem } from '../../../hooks/use-checklist'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '../../../types'
import WorkflowChecklist from '../index'

let mockChecklistItems: ChecklistItem[] = [
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
const mockSetOpenInlineAgentPanelNodeId = vi.fn()

vi.mock('reactflow', () => ({
  useEdges: () => [],
}))

vi.mock('@/app/components/workflow/store/workflow/use-nodes', () => ({
  default: () => [],
}))

vi.mock('../../../hooks/use-checklist', () => ({
  useChecklist: () => mockChecklistItems,
}))

vi.mock('../../../hooks/use-nodes-interactions', () => ({
  useNodesInteractions: () => ({
    handleNodeSelect: mockHandleNodeSelect,
  }),
}))

vi.mock('../../../store', () => ({
  useStore: (
    selector: (state: {
      setOpenInlineAgentPanelNodeId: typeof mockSetOpenInlineAgentPanelNodeId
    }) => unknown,
  ) =>
    selector({
      setOpenInlineAgentPanelNodeId: mockSetOpenInlineAgentPanelNodeId,
    }),
}))

vi.mock('../../../hooks-store/store', () => ({
  useHooksStore: (selector: (state: { configsMap: { flowType: string } }) => unknown) =>
    selector({
      configsMap: {
        flowType: 'workflow',
      },
    }),
}))

vi.mock('../plugin-group', () => ({
  ChecklistPluginGroup: ({ items }: { items: Array<{ title: string }> }) => (
    <div data-testid="plugin-group">{items.map((item) => item.title).join(',')}</div>
  ),
}))

vi.mock('../node-group', () => ({
  ChecklistNodeGroup: ({
    item,
    onItemClick,
  }: {
    item: { title: string }
    onItemClick: (item: { title: string }) => void
  }) => (
    <button data-testid={`node-group-${item.title}`} onClick={() => onItemClick(item)}>
      {item.title}
    </button>
  ),
}))

describe('WorkflowChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('should split checklist items into plugin and node groups and delegate clicks to node selection by default', async () => {
    const user = userEvent.setup()
    render(<WorkflowChecklist disabled={false} />)

    expect(screen.getByText('2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'workflow.panel.checklist' }))
    expect(screen.getByTestId('plugin-group')).toHaveTextContent('Missing Plugin')
    await user.click(screen.getByTestId('node-group-Broken Node'))

    expect(mockHandleNodeSelect).toHaveBeenCalledWith('node-1')
    expect(mockSetOpenInlineAgentPanelNodeId).not.toHaveBeenCalled()
  })

  it('should use the custom item click handler when provided', async () => {
    const user = userEvent.setup()
    const onItemClick = vi.fn()
    render(<WorkflowChecklist disabled={false} onItemClick={onItemClick} />)

    await user.click(screen.getByRole('button', { name: 'workflow.panel.checklist' }))
    await user.click(screen.getByTestId('node-group-Broken Node'))

    expect(onItemClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'node-1' }))
    expect(mockHandleNodeSelect).not.toHaveBeenCalled()
  })

  it('should open the inline agent editor after selecting an inline agent reference warning', async () => {
    const user = userEvent.setup()
    mockChecklistItems[1] = {
      ...mockChecklistItems[1]!,
      type: BlockEnum.AgentV2,
      title: 'Inline Agent',
      openInlineAgentPanel: true,
    }
    render(<WorkflowChecklist disabled={false} />)

    await user.click(screen.getByRole('button', { name: 'workflow.panel.checklist' }))
    await user.click(screen.getByTestId('node-group-Inline Agent'))

    expect(mockHandleNodeSelect).toHaveBeenCalledWith('node-1')
    expect(mockSetOpenInlineAgentPanelNodeId).toHaveBeenCalledWith('node-1')
  })

  it('should render the resolved state when there are no checklist warnings', async () => {
    const user = userEvent.setup()
    mockChecklistItems = []

    render(<WorkflowChecklist disabled={false} />)

    await user.click(screen.getByRole('button', { name: 'workflow.panel.checklist' }))
    expect(screen.getByText(/checklistResolved/i)).toBeInTheDocument()
  })

  it('should ignore popover open changes when the checklist is disabled', () => {
    render(<WorkflowChecklist disabled={true} />)

    expect(screen.getByText('2').closest('button')).toBeDisabled()
  })
})
