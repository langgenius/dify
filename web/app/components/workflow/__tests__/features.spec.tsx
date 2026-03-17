import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Features from '../features'
import { InputVarType } from '../types'
import { createStartNode } from './fixtures'
import { resetReactFlowMockState, rfState } from './reactflow-mock-state'
import { renderWorkflowComponent } from './workflow-test-env'

const mockHandleSyncWorkflowDraft = vi.fn()
const mockHandleAddVariable = vi.fn()
const mockUseIsChatMode = vi.fn()
const mockUseNodesReadOnly = vi.fn()

vi.mock('reactflow', async () =>
  (await import('./reactflow-mock-state')).createReactFlowModuleMock())

vi.mock('../hooks', () => ({
  useIsChatMode: () => mockUseIsChatMode(),
  useNodesReadOnly: () => mockUseNodesReadOnly(),
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
  }),
}))

vi.mock('../nodes/start/use-config', () => ({
  default: () => ({
    handleAddVariable: mockHandleAddVariable,
  }),
}))

vi.mock('@/app/components/base/features/new-feature-panel', () => ({
  default: ({
    isChatMode,
    disabled,
    onChange,
    onClose,
    onAutoAddPromptVariable,
    workflowVariables,
  }: {
    isChatMode: boolean
    disabled: boolean
    onChange: () => void
    onClose: () => void
    onAutoAddPromptVariable: (variables: Array<Record<string, unknown>>) => void
    workflowVariables: Array<Record<string, unknown>>
  }) => (
    <div>
      <div data-testid="features-props">
        {JSON.stringify({
          isChatMode,
          disabled,
          workflowVariables,
        })}
      </div>
      <button type="button" onClick={onChange}>change</button>
      <button type="button" onClick={onClose}>close</button>
      <button
        type="button"
        onClick={() => onAutoAddPromptVariable([{
          key: 'opening_statement',
          name: 'Opening Statement',
          max_length: 200,
          required: true,
        }])}
      >
        add-variable
      </button>
      <button
        type="button"
        onClick={() => onAutoAddPromptVariable([{
          key: 'optional_statement',
          name: 'Optional Statement',
          max_length: 120,
        }])}
      >
        add-variable-optional
      </button>
    </div>
  ),
}))

describe('Features', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetReactFlowMockState()
    mockUseIsChatMode.mockReturnValue(true)
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false })
    rfState.nodes = [
      createStartNode({
        id: 'start-node',
        data: {
          variables: [{ variable: 'existing_variable', label: 'Existing Variable' }],
        },
      }),
    ]
  })

  it('should pass chat mode, disabled state, and workflow variables to NewFeaturePanel', () => {
    renderWorkflowComponent(<Features />)

    expect(screen.getByTestId('features-props')).toHaveTextContent('"isChatMode":true')
    expect(screen.getByTestId('features-props')).toHaveTextContent('"disabled":false')
    expect(screen.getByTestId('features-props')).toHaveTextContent('"variable":"existing_variable"')
  })

  it('should sync draft and open the features panel when the panel changes', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<Features />)

    await user.click(screen.getByRole('button', { name: 'change' }))

    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    expect(store.getState().showFeaturesPanel).toBe(true)
  })

  it('should close the features panel through the workflow store and transform prompt variables', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<Features />, {
      initialStoreState: {
        showFeaturesPanel: true,
      },
    })

    await user.click(screen.getByRole('button', { name: 'close' }))
    expect(store.getState().showFeaturesPanel).toBe(false)

    await user.click(screen.getByRole('button', { name: 'add-variable' }))
    expect(mockHandleAddVariable).toHaveBeenCalledWith({
      variable: 'opening_statement',
      label: 'Opening Statement',
      type: InputVarType.textInput,
      max_length: 200,
      required: true,
      options: [],
    })
  })

  it('should default required to false when the prompt variable does not provide it', async () => {
    const user = userEvent.setup()

    renderWorkflowComponent(<Features />)

    await user.click(screen.getByRole('button', { name: 'add-variable-optional' }))
    expect(mockHandleAddVariable).toHaveBeenCalledWith({
      variable: 'optional_statement',
      label: 'Optional Statement',
      type: InputVarType.textInput,
      max_length: 120,
      required: false,
      options: [],
    })
  })
})
