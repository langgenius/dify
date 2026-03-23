import type { InputVar } from '../types'
import type { PromptVariable } from '@/models/debug'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import Features from '../features'
import { InputVarType } from '../types'
import { createStartNode } from './fixtures'
import { renderWorkflowFlowComponent } from './workflow-test-env'

const mockHandleSyncWorkflowDraft = vi.fn()
const mockHandleAddVariable = vi.fn()

let mockIsChatMode = true
let mockNodesReadOnly = false

vi.mock('../hooks', async () => {
  const actual = await vi.importActual<typeof import('../hooks')>('../hooks')
  return {
    ...actual,
    useIsChatMode: () => mockIsChatMode,
    useNodesReadOnly: () => ({
      nodesReadOnly: mockNodesReadOnly,
    }),
    useNodesSyncDraft: () => ({
      handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
    }),
  }
})

vi.mock('../nodes/start/use-config', () => ({
  default: () => ({
    handleAddVariable: mockHandleAddVariable,
  }),
}))

vi.mock('@/app/components/base/features/new-feature-panel', () => ({
  default: ({
    show,
    isChatMode,
    disabled,
    onChange,
    onClose,
    onAutoAddPromptVariable,
    workflowVariables,
  }: {
    show: boolean
    isChatMode: boolean
    disabled: boolean
    onChange: () => void
    onClose: () => void
    onAutoAddPromptVariable: (variables: PromptVariable[]) => void
    workflowVariables: InputVar[]
  }) => {
    if (!show)
      return null

    return (
      <section aria-label="new feature panel">
        <div>{isChatMode ? 'chat mode' : 'completion mode'}</div>
        <div>{disabled ? 'panel disabled' : 'panel enabled'}</div>
        <ul aria-label="workflow variables">
          {workflowVariables.map(variable => (
            <li key={variable.variable}>
              {`${variable.label}:${variable.variable}`}
            </li>
          ))}
        </ul>
        <button type="button" onClick={onChange}>open features</button>
        <button type="button" onClick={onClose}>close features</button>
        <button
          type="button"
          onClick={() => onAutoAddPromptVariable([{
            key: 'opening_statement',
            name: 'Opening Statement',
            type: 'string',
            max_length: 200,
            required: true,
          }])}
        >
          add required variable
        </button>
        <button
          type="button"
          onClick={() => onAutoAddPromptVariable([{
            key: 'optional_statement',
            name: 'Optional Statement',
            type: 'string',
            max_length: 120,
          }])}
        >
          add optional variable
        </button>
      </section>
    )
  },
}))

const startNode = createStartNode({
  id: 'start-node',
  data: {
    variables: [{ variable: 'existing_variable', label: 'Existing Variable' }],
  },
})

const DelayedFeatures = () => {
  const nodes = useNodes()

  if (!nodes.length)
    return null

  return <Features />
}

const renderFeatures = (options?: Omit<Parameters<typeof renderWorkflowFlowComponent>[1], 'nodes' | 'edges'>) =>
  renderWorkflowFlowComponent(
    <DelayedFeatures />,
    {
      nodes: [startNode],
      edges: [],
      ...options,
    },
  )

describe('Features', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsChatMode = true
    mockNodesReadOnly = false
  })

  describe('Rendering', () => {
    it('should pass workflow context to the feature panel', () => {
      renderFeatures()

      expect(screen.getByText('chat mode')).toBeInTheDocument()
      expect(screen.getByText('panel enabled')).toBeInTheDocument()
      expect(screen.getByRole('list', { name: 'workflow variables' })).toHaveTextContent('Existing Variable:existing_variable')
    })
  })

  describe('User Interactions', () => {
    it('should sync the draft and open the workflow feature panel when users change features', async () => {
      const user = userEvent.setup()
      const { store } = renderFeatures()

      await user.click(screen.getByRole('button', { name: 'open features' }))

      expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledTimes(1)
      expect(store.getState().showFeaturesPanel).toBe(true)
    })

    it('should close the workflow feature panel and transform required prompt variables', async () => {
      const user = userEvent.setup()
      const { store } = renderFeatures({
        initialStoreState: {
          showFeaturesPanel: true,
        },
      })

      await user.click(screen.getByRole('button', { name: 'close features' }))
      expect(store.getState().showFeaturesPanel).toBe(false)

      await user.click(screen.getByRole('button', { name: 'add required variable' }))
      expect(mockHandleAddVariable).toHaveBeenCalledWith({
        variable: 'opening_statement',
        label: 'Opening Statement',
        type: InputVarType.textInput,
        max_length: 200,
        required: true,
        options: [],
      })
    })

    it('should default prompt variables to optional when required is omitted', async () => {
      const user = userEvent.setup()

      renderFeatures()

      await user.click(screen.getByRole('button', { name: 'add optional variable' }))
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
})
