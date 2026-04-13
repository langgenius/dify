import type { CommonNodeType } from '../../../../types'
import { fireEvent, screen } from '@testing-library/react'
import { renderWorkflowComponent } from '../../../../__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus } from '../../../../types'
import NodeControl from '../node-control'

const {
  mockHandleNodeSelect,
  mockCanRunBySingle,
} = vi.hoisted(() => ({
  mockHandleNodeSelect: vi.fn(),
  mockCanRunBySingle: vi.fn(() => true),
}))

let mockPluginInstallLocked = false

vi.mock('../../../../hooks', async () => {
  const actual = await vi.importActual<typeof import('../../../../hooks')>('../../../../hooks')
  return {
    ...actual,
    useNodesInteractions: () => ({
      handleNodeSelect: mockHandleNodeSelect,
    }),
  }
})

vi.mock('../../../../utils', async () => {
  const actual = await vi.importActual<typeof import('../../../../utils')>('../../../../utils')
  return {
    ...actual,
    canRunBySingle: mockCanRunBySingle,
  }
})

vi.mock('../panel-operator', () => ({
  default: ({ onOpenChange }: { onOpenChange: (open: boolean) => void }) => (
    <>
      <button type="button" onClick={() => onOpenChange(true)}>open panel</button>
      <button type="button" onClick={() => onOpenChange(false)}>close panel</button>
    </>
  ),
}))

function NodeControlHarness({ id, data }: { id: string, data: CommonNodeType, selected?: boolean }) {
  return (
    <NodeControl
      id={id}
      data={data}
      pluginInstallLocked={mockPluginInstallLocked}
    />
  )
}

const makeData = (overrides: Partial<CommonNodeType> = {}): CommonNodeType => ({
  type: BlockEnum.Code,
  title: 'Node',
  desc: '',
  selected: false,
  _singleRunningStatus: undefined,
  isInIteration: false,
  isInLoop: false,
  ...overrides,
})

describe('NodeControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPluginInstallLocked = false
    mockCanRunBySingle.mockReturnValue(true)
  })

  // Run/stop behavior should be driven by the workflow store, not CSS classes.
  describe('Single Run Actions', () => {
    it('should trigger a single run through the workflow store', () => {
      const { store } = renderWorkflowComponent(
        <NodeControlHarness id="node-1" data={makeData()} />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'workflow.panel.runThisStep' }))

      expect(store.getState().initShowLastRunTab).toBe(true)
      expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'node-1', action: 'run' })
      expect(mockHandleNodeSelect).toHaveBeenCalledWith('node-1')
    })

    it('should trigger stop when the node is already single-running', () => {
      const { store } = renderWorkflowComponent(
        <NodeControlHarness
          id="node-2"
          data={makeData({
            selected: true,
            _singleRunningStatus: NodeRunningStatus.Running,
          })}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'workflow.debug.variableInspect.trigger.stop' }))

      expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'node-2', action: 'stop' })
      expect(mockHandleNodeSelect).toHaveBeenCalledWith('node-2')
    })
  })

  // Capability gating should hide the run control while leaving panel actions available.
  describe('Availability', () => {
    it('should keep the panel operator available when the plugin is install-locked', () => {
      mockPluginInstallLocked = true

      renderWorkflowComponent(
        <NodeControlHarness
          id="node-3"
          data={makeData({
            selected: true,
          })}
        />,
      )

      expect(screen.getByRole('button', { name: 'open panel' })).toBeInTheDocument()
    })

    it('should hide the run control when single-node execution is not supported', () => {
      mockCanRunBySingle.mockReturnValue(false)

      renderWorkflowComponent(
        <NodeControlHarness
          id="node-4"
          data={makeData()}
        />,
      )

      expect(screen.queryByRole('button', { name: 'workflow.panel.runThisStep' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'open panel' })).toBeInTheDocument()
    })
  })
})
