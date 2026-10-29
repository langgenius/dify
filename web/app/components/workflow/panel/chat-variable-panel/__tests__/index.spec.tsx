import type { ReactElement, ReactNode } from 'react'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { ConversationVariable, Node } from '@/app/components/workflow/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLayoutEffect } from 'react'
import { ReactFlowProvider, useStoreApi } from 'reactflow'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import ChatVariablePanel from '../index'
import { ChatVarType } from '../type'

const mockInvalidateConversationVarValues = vi.fn()
const mockUpdateConversationVariables = vi.fn().mockResolvedValue(undefined)

let mockConversationVariables: ConversationVariable[] = []
let mockFlowNodes: Node<CodeNodeType>[] = []
let flowStore: ReturnType<typeof useStoreApi>
function FlowFixture({ children }: { children: ReactNode }) {
  const store = useStoreApi()
  useLayoutEffect(() => {
    flowStore = store
    store.getState().setNodes(mockFlowNodes)
  }, [store])
  return children
}
const render = (ui: ReactElement) =>
  renderWorkflowComponent(
    <ReactFlowProvider>
      <FlowFixture>{ui}</FlowFixture>
    </ReactFlowProvider>,
    {
      initialStoreState: {
        conversationVariables: mockConversationVariables,
        showChatVariablePanel: true,
      },
    },
  )

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

const createNode = (id: string): Node<CodeNodeType> => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    title: id,
    desc: '',
    type: 'code',
    code_language: 'python3',
    code: '',
    outputs: {},
    variables: [],
  },
})

vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  updateConversationVariables: (...args: unknown[]) => mockUpdateConversationVariables(...args),
}))

vi.mock('../../../hooks/use-inspect-vars-crud', () => ({
  default: () => ({
    invalidateConversationVarValues: mockInvalidateConversationVarValues,
  }),
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

vi.mock(
  '@/app/components/workflow/panel/chat-variable-panel/components/variable-modal-trigger',
  () => ({
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
          onClick={() =>
            onSave({
              id: 'var-added',
              name: 'fresh_var',
              value_type: ChatVarType.String,
              value: '',
              description: 'Added variable',
            })
          }
        >
          save-add
        </button>
        {chatVar && (
          <button
            type="button"
            onClick={() =>
              onSave({
                ...chatVar,
                name: `${chatVar.name}_next`,
              })
            }
          >
            save-edit
          </button>
        )}
        <button type="button" onClick={onClose}>
          close-trigger
        </button>
      </div>
    ),
  }),
)

describe('ChatVariablePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConversationVariables = [createConversationVariable()]
    mockFlowNodes = [createNode('node-1'), createNode('node-2')]
    mockUpdateConversationVariables.mockResolvedValue(undefined)
  })

  it('should toggle the tips area and close the panel', async () => {
    const user = userEvent.setup()
    const { store } = render(<ChatVariablePanel />)

    expect(screen.getByText('workflow.chatVariable.panelDescription')).toBeInTheDocument()

    const toggleTipButton = screen.getByRole('button', {
      name: 'workflow.chatVariable.tips',
      expanded: true,
    })
    await user.click(toggleTipButton)
    expect(screen.queryByText('workflow.chatVariable.panelDescription')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'workflow.chatVariable.tips',
        expanded: false,
      }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(store.getState().showChatVariablePanel).toBe(false)
  })

  it('should prepend newly added variables and sync the workflow draft', async () => {
    const user = userEvent.setup()

    const { store } = render(<ChatVariablePanel />)

    await user.click(screen.getByRole('button', { name: 'save-add' }))

    await waitFor(() => {
      expect(store.getState().conversationVariables).toEqual([
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
    mockFlowNodes[0]!.data.variables = [
      { variable: 'topic', value_selector: ['conversation', 'conversation_var'] },
    ]
    const updatedNode = {
      ...createNode('node-1'),
      data: {
        ...createNode('node-1').data,
        variables: [
          { variable: 'topic', value_selector: ['conversation', 'conversation_var_next'] },
        ],
      },
    }

    const { store } = render(<ChatVariablePanel />)

    await user.click(screen.getByRole('button', { name: 'edit-conversation_var' }))
    await user.click(screen.getByRole('button', { name: 'save-edit' }))

    expect(store.getState().conversationVariables).toEqual([
      expect.objectContaining({ id: 'var-1', name: 'conversation_var_next' }),
    ])
    expect(flowStore.getState().getNodes()).toEqual([
      expect.objectContaining(updatedNode),
      expect.objectContaining(createNode('node-2')),
    ])
    expect(store.getState().controlPromptEditorRerenderKey).toBeGreaterThan(0)
  })

  it('should require confirmation before deleting variables referenced by workflow nodes', async () => {
    const user = userEvent.setup()
    mockFlowNodes[0]!.data.variables = [
      { variable: 'topic', value_selector: ['conversation', 'conversation_var'] },
    ]
    const prunedNode = {
      ...createNode('node-1'),
      data: {
        ...createNode('node-1').data,
        variables: [{ variable: 'topic', value_selector: [] }],
      },
    }

    const { store } = render(<ChatVariablePanel />)

    await user.click(screen.getByRole('button', { name: 'delete-conversation_var' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(mockUpdateConversationVariables).not.toHaveBeenCalled()
    expect(store.getState().conversationVariables).toEqual(mockConversationVariables)
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(store.getState().conversationVariables).toEqual(mockConversationVariables)
    expect(flowStore.getState().getNodes()[0]!.data.variables).toEqual(
      mockFlowNodes[0]!.data.variables,
    )
    await user.click(screen.getByRole('button', { name: 'delete-conversation_var' }))

    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(flowStore.getState().getNodes()).toEqual([
      expect.objectContaining(prunedNode),
      expect.objectContaining(createNode('node-2')),
    ])
    expect(store.getState().conversationVariables).toEqual([])
  })
})
