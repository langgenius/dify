import type { ConversationVariable, Node } from '@/app/components/workflow/types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatVariablePanel from '../index'
import { ChatVarType } from '../type'

type MockWorkflowStoreState = {
  setShowChatVariablePanel: (value: boolean) => void
  appId: string
  conversationVariables: ConversationVariable[]
  setConversationVariables: (value: ConversationVariable[]) => void
  setControlPromptEditorRerenderKey: (value: number) => void
}

type MockFlowStore = {
  getNodes: () => Node[]
  setNodes: (nodes: Node[]) => void
}

const mockSetShowChatVariablePanel = vi.fn()
const mockSetConversationVariables = vi.fn()
const mockSetControlPromptEditorRerenderKey = vi.fn()
const mockInvalidateConversationVarValues = vi.fn()
const mockUpdateConversationVariables = vi.fn().mockResolvedValue(undefined)
const mockFindUsedVarNodes = vi.fn<(selector: string[], nodes: Node[]) => Node[]>()
const mockUpdateNodeVars = vi.fn<(node: Node, current: string[], next: string[]) => Node>()

let mockConversationVariables: ConversationVariable[] = []
let mockFlowNodes: Node[] = []
const mockSetNodes = vi.fn<(nodes: Node[]) => void>()

const createConversationVariable = (
  overrides: Partial<ConversationVariable> = {},
): ConversationVariable => ({
  id: 'var-1',
  name: 'conversation_var',
  value_type: ChatVarType.String,
  value: '',
  description: 'Conversation variable',
  ...overrides,
})

const createNode = (id: string): Node => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    title: id,
    desc: '',
    type: 'llm' as Node['data']['type'],
  },
})

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: (): MockFlowStore => ({
      getNodes: () => mockFlowNodes,
      setNodes: mockSetNodes,
    }),
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(selector: (state: MockWorkflowStoreState) => T) => selector({
    setShowChatVariablePanel: mockSetShowChatVariablePanel,
    appId: 'app-1',
    conversationVariables: mockConversationVariables,
    setConversationVariables: mockSetConversationVariables,
    setControlPromptEditorRerenderKey: mockSetControlPromptEditorRerenderKey,
  }),
}))

vi.mock('@/service/workflow', () => ({
  updateConversationVariables: (...args: unknown[]) => mockUpdateConversationVariables(...args),
}))

vi.mock('../../../hooks/use-inspect-vars-crud', () => ({
  default: () => ({
    invalidateConversationVarValues: mockInvalidateConversationVarValues,
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/utils', () => ({
  findUsedVarNodes: (...args: Parameters<typeof mockFindUsedVarNodes>) => mockFindUsedVarNodes(...args),
  updateNodeVars: (...args: Parameters<typeof mockUpdateNodeVars>) => mockUpdateNodeVars(...args),
}))

vi.mock('@/app/components/workflow/panel/chat-variable-panel/components/variable-item', () => ({
  default: ({
    item,
    onEdit,
    onDelete,
  }: {
    item: ConversationVariable
    onEdit: (item: ConversationVariable) => void
    onDelete: (item: ConversationVariable) => void
  }) => (
    <div>
      <span>{item.name}</span>
      <button type="button" onClick={() => onEdit(item)}>{`edit-${item.name}`}</button>
      <button type="button" onClick={() => onDelete(item)}>{`delete-${item.name}`}</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/panel/chat-variable-panel/components/variable-modal-trigger', () => ({
  default: ({
    open,
    showTip,
    chatVar,
    onSave,
    onClose,
  }: {
    open: boolean
    showTip: boolean
    chatVar?: ConversationVariable
    onSave: (chatVar: ConversationVariable) => void
    onClose: () => void
  }) => (
    <div data-testid="variable-modal-trigger">
      <span>{open ? 'open' : 'closed'}</span>
      <span>{showTip ? 'tip-on' : 'tip-off'}</span>
      <span>{chatVar?.name || 'new-variable'}</span>
      <button
        type="button"
        onClick={() => onSave({
          id: 'var-added',
          name: 'fresh_var',
          value_type: ChatVarType.String,
          value: '',
          description: 'Added variable',
        })}
      >
        save-add
      </button>
      {chatVar && (
        <button
          type="button"
          onClick={() => onSave({
            ...chatVar,
            name: `${chatVar.name}_next`,
          })}
        >
          save-edit
        </button>
      )}
      <button type="button" onClick={onClose}>close-trigger</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/remove-effect-var-confirm', () => ({
  default: ({
    isShow,
    onConfirm,
    onCancel,
  }: {
    isShow: boolean
    onConfirm: () => void
    onCancel: () => void
  }) => {
    if (!isShow)
      return null

    return (
      <div data-testid="remove-effect-var-confirm">
        <button type="button" onClick={onConfirm}>confirm-remove</button>
        <button type="button" onClick={onCancel}>cancel-remove</button>
      </div>
    )
  },
}))

describe('ChatVariablePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConversationVariables = [createConversationVariable()]
    mockFlowNodes = [createNode('node-1'), createNode('node-2')]
    mockUpdateConversationVariables.mockResolvedValue(undefined)
    mockFindUsedVarNodes.mockReturnValue([])
    mockUpdateNodeVars.mockImplementation((node: Node) => node)
  })

  it('should toggle the tips area and close the panel', async () => {
    const user = userEvent.setup()
    const { container } = render(<ChatVariablePanel />)

    expect(screen.getByText('workflow.chatVariable.panelDescription')).toBeInTheDocument()

    const toggleTipButton = screen.getAllByRole('button')[0]!
    await user.click(toggleTipButton)
    expect(screen.queryByText('workflow.chatVariable.panelDescription')).not.toBeInTheDocument()

    const closeButton = container.querySelector('.flex.h-6.w-6.cursor-pointer.items-center.justify-center') as HTMLElement
    await user.click(closeButton)

    expect(mockSetShowChatVariablePanel).toHaveBeenCalledWith(false)
  })

  it('should prepend newly added variables and sync the workflow draft', async () => {
    const user = userEvent.setup()

    render(<ChatVariablePanel />)

    await user.click(screen.getByRole('button', { name: 'save-add' }))

    await waitFor(() => {
      expect(mockSetConversationVariables).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'var-added', name: 'fresh_var' }),
        createConversationVariable(),
      ])
      expect(mockUpdateConversationVariables).toHaveBeenCalledWith({
        appId: 'app-1',
        conversationVariables: [
          expect.objectContaining({ id: 'var-added', name: 'fresh_var' }),
          createConversationVariable(),
        ],
      })
      expect(mockInvalidateConversationVarValues).toHaveBeenCalledTimes(1)
    })
  })

  it('should rename existing variables and update affected node references', async () => {
    const user = userEvent.setup()
    const effectedNode = createNode('node-1')
    const updatedNode = createNode('node-1-updated')

    mockFindUsedVarNodes.mockReturnValue([effectedNode])
    mockUpdateNodeVars.mockReturnValue(updatedNode)

    render(<ChatVariablePanel />)

    await user.click(screen.getByRole('button', { name: 'edit-conversation_var' }))
    await user.click(screen.getByRole('button', { name: 'save-edit' }))

    expect(mockSetConversationVariables).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'var-1', name: 'conversation_var_next' }),
    ])
    expect(mockUpdateNodeVars).toHaveBeenCalledWith(
      effectedNode,
      ['conversation', 'conversation_var'],
      ['conversation', 'conversation_var_next'],
    )
    expect(mockSetNodes).toHaveBeenCalledWith([updatedNode, createNode('node-2')])
    expect(mockSetControlPromptEditorRerenderKey).toHaveBeenCalled()
  })

  it('should require confirmation before deleting variables referenced by workflow nodes', async () => {
    const user = userEvent.setup()
    const effectedNode = createNode('node-1')
    const prunedNode = createNode('node-1-pruned')

    mockFindUsedVarNodes.mockReturnValue([effectedNode])
    mockUpdateNodeVars.mockReturnValue(prunedNode)

    render(<ChatVariablePanel />)

    await user.click(screen.getByRole('button', { name: 'delete-conversation_var' }))
    expect(screen.getByTestId('remove-effect-var-confirm')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'confirm-remove' }))

    expect(mockUpdateNodeVars).toHaveBeenCalledWith(
      effectedNode,
      ['conversation', 'conversation_var'],
      [],
    )
    expect(mockSetNodes).toHaveBeenCalledWith([prunedNode, createNode('node-2')])
    expect(mockSetConversationVariables).toHaveBeenCalledWith([])
  })
})
