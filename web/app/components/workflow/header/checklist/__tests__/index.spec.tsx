import type { ChecklistItem } from '../../../hooks/use-checklist'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { difyBuilderSessionBusyAtom } from '@/app/components/dify-builder/state'
import {
  difyBuilderChecklistErrorsAtom,
  difyBuilderRuntimeAtom,
} from '@/app/components/workflow-app/components/dify-builder/store'
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
const mockStartChecklistFix = vi.fn(async () => true)
const mockSyncDraft = vi.fn(async () => undefined)

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

const renderChecklist = (
  props: React.ComponentProps<typeof WorkflowChecklist>,
  {
    busy = false,
    canEdit = true,
    enabled = true,
  }: {
    busy?: boolean
    canEdit?: boolean
    enabled?: boolean
  } = {},
) => {
  const store = createStore()
  store.set(difyBuilderRuntimeAtom, {
    appId: 'app-1',
    canEdit,
    enabled,
    getCanvasSnapshot: () => ({ nodes: [], edgeCount: 0 }),
    onSyncDraft: mockSyncDraft,
    session: {
      refresh: vi.fn(async () => true),
      restore: vi.fn(async () => true),
      reset: vi.fn(),
      runAction: vi.fn(async () => true),
      sendMessage: vi.fn(async () => true),
      startBuild: vi.fn(async () => true),
      startChecklistFix: mockStartChecklistFix,
      startEdit: vi.fn(async () => true),
      startFix: vi.fn(async () => true),
      updateModel: vi.fn(async () => true),
    },
    setShowPanel: vi.fn(),
  })
  store.set(difyBuilderSessionBusyAtom, busy)
  return {
    store,
    ...render(
      <Provider store={store}>
        <WorkflowChecklist {...props} />
      </Provider>,
    ),
  }
}

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
    renderChecklist({ disabled: false })

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
    renderChecklist({ disabled: false, onItemClick })

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
    renderChecklist({ disabled: false })

    await user.click(screen.getByRole('button', { name: 'workflow.panel.checklist' }))
    await user.click(screen.getByTestId('node-group-Inline Agent'))

    expect(mockHandleNodeSelect).toHaveBeenCalledWith('node-1')
    expect(mockSetOpenInlineAgentPanelNodeId).toHaveBeenCalledWith('node-1')
  })

  it('should render the resolved state when there are no checklist warnings', async () => {
    const user = userEvent.setup()
    mockChecklistItems = []

    renderChecklist({ disabled: false })

    await user.click(screen.getByRole('button', { name: 'workflow.panel.checklist' }))
    expect(screen.getByText(/checklistResolved/i)).toBeInTheDocument()
  })

  it('should ignore popover open changes when the checklist is disabled', () => {
    renderChecklist({ disabled: true })

    expect(screen.getByText('2').closest('button')).toBeDisabled()
  })

  it('should start a checklist fix from the entry at the bottom of the list', async () => {
    const user = userEvent.setup()
    const { store } = renderChecklist({ disabled: false })

    await user.click(screen.getByRole('button', { name: 'workflow.panel.checklist' }))
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.fixWithAppBuilder' }))

    expect(mockStartChecklistFix).toHaveBeenCalledWith(
      'app-1',
      [
        expect.objectContaining({
          node_id: 'node-1',
          messages: ['Needs configuration'],
        }),
      ],
      undefined,
    )
    expect(store.get(difyBuilderChecklistErrorsAtom)).toEqual([
      expect.objectContaining({ node_id: 'node-1', messages: ['Needs configuration'] }),
    ])
  })

  it('should hide checklist Fix while Builder is disabled', async () => {
    const user = userEvent.setup()
    renderChecklist({ disabled: false }, { enabled: false })

    await user.click(screen.getByRole('button', { name: 'workflow.panel.checklist' }))

    expect(
      screen.queryByRole('button', { name: 'workflow.difyBuilder.fixWithAppBuilder' }),
    ).not.toBeInTheDocument()
  })

  it('should keep checklist Fix disabled without edit access or while the session is busy', async () => {
    const user = userEvent.setup()
    const { unmount } = renderChecklist({ disabled: false }, { canEdit: false })

    await user.click(screen.getByRole('button', { name: 'workflow.panel.checklist' }))
    expect(
      screen.getByRole('button', { name: 'workflow.difyBuilder.fixWithAppBuilder' }),
    ).toBeDisabled()

    unmount()
    renderChecklist({ disabled: false }, { busy: true })
    await user.click(screen.getByRole('button', { name: 'workflow.panel.checklist' }))
    expect(
      screen.getByRole('button', { name: 'workflow.difyBuilder.fixWithAppBuilder' }),
    ).toBeDisabled()
  })
})
