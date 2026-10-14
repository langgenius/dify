import type React from 'react'
import type { CommonNodeType, ToolWithProvider } from '../../../../types'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { CollectionType } from '@/app/components/tools/types'
import { renderWorkflowComponent } from '../../../../__tests__/workflow-test-env'
import { fullWorkflowAccessControl } from '../../../../hooks-store'
import { BlockEnum, NodeRunningStatus } from '../../../../types'
import NodeControl from '../node-control'

const { mockHandleNodeSelect, mockCanRunBySingle, mockUseNodesReadOnly, mockUseAllBuiltInTools } =
  vi.hoisted(() => ({
    mockHandleNodeSelect: vi.fn(),
    mockCanRunBySingle: vi.fn(() => true),
    mockUseNodesReadOnly: vi.fn(() => ({ nodesReadOnly: false })),
    mockUseAllBuiltInTools: vi.fn(),
  }))

let mockPluginInstallLocked = false

vi.mock('../../../../hooks/use-nodes-interactions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-nodes-interactions')>()
  return {
    ...actual,
    useNodesInteractions: () => ({
      handleNodeSelect: mockHandleNodeSelect,
    }),
  }
})

vi.mock('../../../../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-workflow')>()
  return {
    ...actual,
    useNodesReadOnly: mockUseNodesReadOnly,
  }
})

vi.mock('../../../../utils', async () => {
  const actual = await vi.importActual<typeof import('../../../../utils')>('../../../../utils')
  return {
    ...actual,
    canRunBySingle: mockCanRunBySingle,
  }
})

vi.mock('@/service/use-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/use-tools')>()
  return {
    ...actual,
    useAllBuiltInTools: mockUseAllBuiltInTools,
  }
})

vi.mock('@/app/components/workflow/node-actions-menu', () => ({
  NodeActionsDropdown: ({ onOpenChange }: { onOpenChange: (open: boolean) => void }) => (
    <>
      <button type="button" onClick={() => onOpenChange(true)}>
        open panel
      </button>
      <button type="button" onClick={() => onOpenChange(false)}>
        close panel
      </button>
    </>
  ),
}))

function NodeControlHarness({
  id,
  data,
}: {
  id: string
  data: CommonNodeType
  selected?: boolean
}) {
  return <NodeControl id={id} data={data} pluginInstallLocked={mockPluginInstallLocked} />
}

function renderNodeControl(ui: React.ReactElement, accessControl = fullWorkflowAccessControl) {
  return renderWorkflowComponent(ui, {
    hooksStoreProps: {
      accessControl,
    },
  })
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

const toolProvider: ToolWithProvider = {
  id: 'provider-id',
  name: 'test-provider',
  author: 'Dify',
  description: { en_US: 'Test provider', zh_Hans: '测试提供商' },
  label: { en_US: 'Test provider', zh_Hans: '测试提供商' },
  icon: '',
  type: CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: true,
  labels: [],
  tools: [],
}

const makeToolData = (overrides: Partial<ToolNodeType> = {}): ToolNodeType => ({
  ...makeData({ type: BlockEnum.Tool }),
  provider_id: toolProvider.id,
  provider_name: toolProvider.name,
  provider_type: CollectionType.builtIn,
  tool_name: 'test-tool',
  tool_label: 'Test tool',
  tool_parameters: {},
  tool_configurations: {},
  ...overrides,
})

describe('NodeControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPluginInstallLocked = false
    mockCanRunBySingle.mockReturnValue(true)
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false })
    mockUseAllBuiltInTools.mockReturnValue({ data: [] })
  })

  // Run/stop behavior should be driven by the workflow store, not CSS classes.
  describe('Single Run Actions', () => {
    it('should trigger a single run through the workflow store', () => {
      const { store } = renderNodeControl(<NodeControlHarness id="node-1" data={makeData()} />)

      fireEvent.click(screen.getByRole('button', { name: 'workflow.panel.runThisStep' }))

      expect(store.getState().initShowLastRunTab).toBe(true)
      expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'node-1', action: 'run' })
      expect(mockHandleNodeSelect).toHaveBeenCalledWith('node-1')
    })

    it('should trigger stop when the node is already single-running', () => {
      const { store } = renderNodeControl(
        <NodeControlHarness
          id="node-2"
          data={makeData({
            selected: true,
            _singleRunningStatus: NodeRunningStatus.Running,
          })}
        />,
      )

      fireEvent.click(
        screen.getByRole('button', { name: 'workflowDebug.debug.variableInspect.trigger.stop' }),
      )

      expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'node-2', action: 'stop' })
      expect(mockHandleNodeSelect).toHaveBeenCalledWith('node-2')
    })

    it('blocks an unconfigured App user test run and enables it after adding a connection', async () => {
      const user = userEvent.setup()
      mockUseAllBuiltInTools.mockReturnValue({ data: [toolProvider] })
      const { store } = renderNodeControl(
        <NodeControlHarness id="tool-node" data={makeToolData()} />,
      )
      const draft = {
        oauthEnabled: false,
        apiKeyEnabled: true,
        description: 'Connect app users',
        testConnection: { connections: [] },
      }
      act(() => {
        store
          .getState()
          .setNodeAppUserAuthDraft('tool-node', toolProvider.name, toolProvider.id, draft)
        store
          .getState()
          .setNodeAuthorizationTab('tool-node', toolProvider.name, toolProvider.id, 'app-user-auth')
      })
      const run = screen.getByRole('button', { name: 'workflow.panel.runThisStep' })

      expect(run).toHaveAttribute('aria-disabled', 'true')
      await user.click(run)

      expect(store.getState().pendingSingleRun).toBeUndefined()
      expect(store.getState().initShowLastRunTab).toBe(false)
      expect(mockHandleNodeSelect).not.toHaveBeenCalled()

      act(() =>
        store.getState().setNodeAppUserAuthDraft('tool-node', toolProvider.name, toolProvider.id, {
          ...draft,
          testConnection: {
            connections: [
              {
                id: 'test-api-key',
                name: 'API key test connection',
                method: CredentialTypeEnum.API_KEY,
                subtitle: '•••• 1234',
              },
            ],
            selectedId: 'test-api-key',
          },
        }),
      )

      const configuredRun = screen.getByRole('button', { name: 'workflow.panel.runThisStep' })
      expect(configuredRun).not.toHaveAttribute('aria-disabled', 'true')
      await user.click(configuredRun)
      expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'tool-node', action: 'run' })
      expect(mockHandleNodeSelect).toHaveBeenCalledExactlyOnceWith('tool-node')
    })

    it('keeps stop available when an App user test connection has been removed', async () => {
      const user = userEvent.setup()
      mockUseAllBuiltInTools.mockReturnValue({ data: [toolProvider] })
      const { store } = renderNodeControl(
        <NodeControlHarness
          id="running-tool"
          data={makeToolData({ _singleRunningStatus: NodeRunningStatus.Running })}
        />,
      )
      act(() => {
        store
          .getState()
          .setNodeAppUserAuthDraft('running-tool', toolProvider.name, toolProvider.id, {
            oauthEnabled: false,
            apiKeyEnabled: true,
            description: 'Connect app users',
            testConnection: { connections: [] },
          })
        store
          .getState()
          .setNodeAuthorizationTab(
            'running-tool',
            toolProvider.name,
            toolProvider.id,
            'app-user-auth',
          )
      })
      const stop = screen.getByRole('button', {
        name: 'workflowDebug.debug.variableInspect.trigger.stop',
      })

      expect(stop).not.toHaveAttribute('aria-disabled', 'true')
      await user.click(stop)

      expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'running-tool', action: 'stop' })
      expect(mockHandleNodeSelect).toHaveBeenCalledExactlyOnceWith('running-tool')
    })
  })

  // Capability gating should hide the run control while leaving panel actions available.
  describe('Availability', () => {
    it('should keep the panel operator available when the plugin is install-locked', () => {
      mockPluginInstallLocked = true

      renderNodeControl(
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

      renderNodeControl(<NodeControlHarness id="node-4" data={makeData()} />)

      expect(
        screen.queryByRole('button', { name: 'workflow.panel.runThisStep' }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'open panel' })).toBeInTheDocument()
    })

    it('should hide the run control when workflow run permission is missing', () => {
      renderNodeControl(<NodeControlHarness id="node-5" data={makeData()} />, {
        canEdit: false,
        canRun: false,
        canImportExportDSL: false,
        canReleaseAndVersion: false,
      })

      expect(
        screen.queryByRole('button', { name: 'workflow.panel.runThisStep' }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'open panel' })).toBeInTheDocument()
    })

    it('should hide the run control when nodes are read-only', () => {
      mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: true })

      renderNodeControl(<NodeControlHarness id="node-6" data={makeData()} />)

      expect(
        screen.queryByRole('button', { name: 'workflow.panel.runThisStep' }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'open panel' })).toBeInTheDocument()
    })
  })
})
