import type { ReactElement, ReactNode } from 'react'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { ConversationVariable, Node } from '@/app/components/workflow/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useStoreApi } from 'reactflow'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { HooksStoreContext } from '@/app/components/workflow/hooks-store/provider'
import { createHooksStore } from '@/app/components/workflow/hooks-store/store'
import {
  useConversationVarValues,
  useInvalidateConversationVarValues,
} from '@/service/use-workflow'
import ChatVariablePanel from '../index'
import { ChatVarType } from '../type'

const mockUpdateConversationVariables = vi.fn().mockResolvedValue(undefined)

let mockConversationVariables: ConversationVariable[] = []
let mockFlowNodes: Node<CodeNodeType>[] = []
let flowStore: ReturnType<typeof useStoreApi>
function InspectVariables({ children }: { children: ReactNode }) {
  flowStore = useStoreApi()
  const invalidateConversationVarValues = useInvalidateConversationVarValues({
    kind: 'app',
    appId: 'app-1',
    mode: 'advanced-chat',
  })
  const [hooks] = useState(() => createHooksStore({ invalidateConversationVarValues }))
  const { data } = useConversationVarValues({ kind: 'app', appId: 'app-1', mode: 'advanced-chat' })
  return (
    <HooksStoreContext value={hooks}>
      {children}
      <output aria-label="Inspected conversation variables">{JSON.stringify(data)}</output>
    </HooksStoreContext>
  )
}
const render = (ui: ReactElement) =>
  renderWorkflowFlowComponent(<InspectVariables>{ui}</InspectVariables>, {
    nodes: mockFlowNodes,
    initialStoreState: {
      conversationVariables: mockConversationVariables,
      showChatVariablePanel: true,
    },
  })

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

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.draft.conversationVariables.get': () =>
        Promise.resolve({
          items: [
            {
              id: 'var-added',
              name: 'fresh_var',
              value: 'server value',
              value_type: 'string',
              selector: ['conversation', 'fresh_var'],
            },
          ],
        }),
    }),
  }
})

// VariableItem exposes only unnamed SVG edit/delete targets; keep this minimal action boundary.
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

describe('ChatVariablePanel', () => {
  beforeEach(() => {
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

  it('should prepend new variables, persist them and refresh inspector values', async () => {
    const user = userEvent.setup()

    const { store } = render(<ChatVariablePanel />)

    await user.click(screen.getByRole('button', { name: 'workflow.chatVariable.button' }))
    await user.type(
      screen.getByPlaceholderText('workflow.chatVariable.modal.namePlaceholder'),
      'fresh_var',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => {
      expect(store.getState().conversationVariables).toEqual([
        expect.objectContaining({ id: expect.any(String), name: 'fresh_var' }),
        createConversationVariable(),
      ])
      expect(mockUpdateConversationVariables).toHaveBeenCalledWith({
        appId: 'app-1',
        conversationVariables: [
          expect.objectContaining({ id: expect.any(String), name: 'fresh_var' }),
          createConversationVariable(),
        ],
      })
      expect(screen.getByLabelText('Inspected conversation variables')).toHaveTextContent(
        'server value',
      )
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
    const name = screen.getByPlaceholderText('workflow.chatVariable.modal.namePlaceholder')
    await user.clear(name)
    await user.type(name, 'conversation_var_next')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

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
