import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VarInInspectType } from '@/types/workflow'
import { BlockEnum, VarType } from '../../types'
import Group from '../group'

const mockUseToolIcon = vi.fn(() => '')

vi.mock('../../hooks/use-tool-icon', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-tool-icon')>()
  return {
    ...actual,
    useToolIcon: () => mockUseToolIcon(),
  }
})

const createVar = (overrides: Partial<VarInInspect> = {}): VarInInspect => ({
  id: 'var-1',
  type: VarInInspectType.node,
  name: 'message',
  description: '',
  selector: ['node-1', 'message'],
  value_type: VarType.string,
  value: 'hello',
  edited: false,
  visible: true,
  is_truncated: false,
  full_content: {
    size_bytes: 0,
    download_url: '',
  },
  ...overrides,
})

const createNodeData = (overrides: Partial<NodeWithVar> = {}): NodeWithVar => ({
  nodeId: 'node-1',
  nodePayload: {
    type: BlockEnum.Code,
    title: 'Code',
    desc: '',
  },
  nodeType: BlockEnum.Code,
  title: 'Code',
  vars: [],
  ...overrides,
})

describe('VariableInspect Group', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should mask secret environment variables before selecting them', async () => {
    const handleSelect = vi.fn()

    render(
      <Group
        varType={VarInInspectType.environment}
        varList={[
          createVar({
            id: 'env-secret',
            type: VarInInspectType.environment,
            name: 'API_KEY',
            value_type: VarType.secret,
            value: 'plain-secret',
          }),
        ]}
        handleSelect={handleSelect}
      />,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: /API_KEY/ }))

    expect(screen.getByText('workflowDebug.debug.variableInspect.envNode')).toBeInTheDocument()
    expect(handleSelect).toHaveBeenCalledWith({
      nodeId: VarInInspectType.environment,
      nodeType: VarInInspectType.environment,
      title: VarInInspectType.environment,
      var: expect.objectContaining({
        id: 'env-secret',
        type: VarInInspectType.environment,
        value: '******************',
      }),
    })
  })

  it('keeps invisible variables hidden when collapsing and reopening the group', async () => {
    render(
      <Group
        nodeData={createNodeData()}
        varType={VarInInspectType.node}
        varList={[
          createVar({ id: 'visible-var', name: 'visible_var' }),
          createVar({ id: 'hidden-var', name: 'hidden_var', visible: false }),
        ]}
        handleSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('visible_var')).toBeInTheDocument()
    expect(screen.queryByText('hidden_var')).not.toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Code' }))

    expect(screen.queryByText('visible_var')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Code' }))
    expect(screen.getByText('visible_var')).toBeInTheDocument()
    expect(screen.queryByText('hidden_var')).not.toBeInTheDocument()
  })

  it('should expose node view and clear actions for node groups', async () => {
    const handleView = vi.fn()
    const handleClear = vi.fn()

    render(
      <Group
        nodeData={createNodeData()}
        varType={VarInInspectType.node}
        varList={[createVar()]}
        handleSelect={vi.fn()}
        handleView={handleView}
        handleClear={handleClear}
      />,
    )

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'workflowDebug.debug.variableInspect.view' }))
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'workflowDebug.debug.variableInspect.clearNode' }))

    expect(handleView).toHaveBeenCalledTimes(1)
    expect(handleClear).toHaveBeenCalledTimes(1)
  })
})
