import type { currentVarType } from '../panel'
import type { VarInInspect } from '@/types/workflow'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VarInInspectType } from '@/types/workflow'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum, VarType } from '../../types'
import Right from '../right'

const { mockResetConversationVar, mockResetToLastRunVar } = vi.hoisted(() => ({
  mockResetConversationVar: vi.fn(),
  mockResetToLastRunVar: vi.fn(),
}))

vi.mock('../../hooks/use-inspect-vars-crud', () => ({
  default: () => ({
    editInspectVarValue: vi.fn(),
    resetConversationVar: mockResetConversationVar,
    resetToLastRunVar: mockResetToLastRunVar,
  }),
}))

vi.mock('../../hooks/use-nodes-interactions', () => ({
  useNodesInteractions: () => ({
    handleNodeSelect: vi.fn(),
  }),
}))

vi.mock('../../hooks/use-tool-icon', () => ({
  useToolIcon: () => '',
}))

vi.mock('../../hooks-store', () => ({
  useHooksStore: <T,>(selector: (state: { configsMap?: { flowId: string } }) => T) =>
    selector({ configsMap: { flowId: 'flow-1' } }),
}))

vi.mock('../../nodes/_base/hooks/use-node-crud', () => ({
  default: () => ({ setInputs: vi.fn() }),
}))

vi.mock('../../nodes/_base/hooks/use-node-info', () => ({
  default: () => ({ node: undefined }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({ eventEmitter: undefined }),
}))

vi.mock('../value-content', () => ({
  default: () => <div>Value</div>,
}))

const createVariable = (overrides: Partial<VarInInspect> = {}): VarInInspect => ({
  id: 'var-1',
  type: VarInInspectType.node,
  name: 'result',
  description: '',
  selector: ['node-1', 'result'],
  value_type: VarType.string,
  value: 'value',
  edited: false,
  visible: true,
  is_truncated: false,
  full_content: {
    size_bytes: 0,
    download_url: '',
  },
  ...overrides,
})

const createCurrentNodeVar = (overrides: Partial<VarInInspect> = {}): currentVarType => ({
  nodeId: 'node-1',
  nodeType: BlockEnum.Code,
  title: 'Code',
  nodeData: {
    type: BlockEnum.Code,
    title: 'Code',
    desc: '',
  },
  var: createVariable(overrides),
})

const renderRight = (
  currentNodeVar: currentVarType,
  options: { bottomPanelWidth?: number; handleOpenMenu?: () => void } = {},
) => {
  const handleOpenMenu = options.handleOpenMenu ?? vi.fn()
  const result = renderWorkflowFlowComponent(
    <Right nodeId="node-1" currentNodeVar={currentNodeVar} handleOpenMenu={handleOpenMenu} />,
    {
      nodes: [],
      edges: [],
      initialStoreState: {
        bottomPanelWidth: options.bottomPanelWidth ?? 560,
      },
    },
  )

  return { ...result, handleOpenMenu }
}

describe('VariableInspect Right', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the variable menu from the named narrow-panel command', async () => {
    const user = userEvent.setup()
    const { handleOpenMenu } = renderRight(createCurrentNodeVar(), { bottomPanelWidth: 400 })

    await user.click(screen.getByRole('button', { name: 'workflow.debug.variableInspect.title' }))

    expect(handleOpenMenu).toHaveBeenCalledTimes(1)
  })

  it('exposes the full-content download as a named link', () => {
    renderRight(
      createCurrentNodeVar({
        is_truncated: true,
        full_content: {
          size_bytes: 1024,
          download_url: 'https://example.com/result.txt',
        },
      }),
    )

    expect(
      screen.getByRole('link', { name: 'workflow.debug.variableInspect.exportToolTip' }),
    ).toHaveAttribute('href', 'https://example.com/result.txt')
  })

  it('resets an edited node variable from its named command', async () => {
    const user = userEvent.setup()

    renderRight(createCurrentNodeVar({ edited: true }))

    await user.click(screen.getByRole('button', { name: 'workflow.debug.variableInspect.reset' }))

    expect(mockResetToLastRunVar).toHaveBeenCalledWith('node-1', 'var-1')
  })

  it('resets an edited conversation variable from its named command', async () => {
    const user = userEvent.setup()

    renderRight(
      createCurrentNodeVar({
        type: VarInInspectType.conversation,
        edited: true,
      }),
    )

    await user.click(
      screen.getByRole('button', {
        name: 'workflow.debug.variableInspect.resetConversationVar',
      }),
    )

    expect(mockResetConversationVar).toHaveBeenCalledWith('var-1')
  })
})
