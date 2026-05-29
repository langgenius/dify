import type { PropsWithChildren } from 'react'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import BasePanel from '../index'

const mockHandleNodeSelect = vi.fn()
const mockHandleNodeDataUpdate = vi.fn()
const mockHandleNodeDataUpdateWithSyncDraft = vi.fn()
const mockSaveStateToHistory = vi.fn()
const mockSetDetail = vi.fn()
const mockSetShowAccountSettingModal = vi.fn()
const mockHandleSingleRun = vi.fn()
const mockHandleStop = vi.fn()
const mockHandleRunWithParams = vi.fn()
let mockShowMessageLogModal = false
let mockBuiltInTools = [{
  id: 'provider/tool',
  name: 'Tool',
  type: 'builtin',
  allow_delete: true,
}]
let mockTriggerPlugins: Array<Record<string, unknown>> = []

const mockLogsState = {
  showSpecialResultPanel: false,
}

const mockLastRunState = {
  isShowSingleRun: false,
  hideSingleRun: vi.fn(),
  runningStatus: NodeRunningStatus.Succeeded,
  runInputData: {},
  runInputDataRef: { current: {} },
  runResult: {},
  setRunResult: vi.fn(),
  getInputVars: vi.fn(),
  toVarInputs: vi.fn(),
  tabType: 'settings',
  isRunAfterSingleRun: false,
  setIsRunAfterSingleRun: vi.fn(),
  setTabType: vi.fn(),
  handleAfterCustomSingleRun: vi.fn(),
  singleRunParams: {
    forms: [],
    onStop: vi.fn(),
    runningStatus: NodeRunningStatus.Succeeded,
    existVarValuesInForms: [],
    filteredExistVarForms: [],
  },
  nodeInfo: { id: 'node-1' },
  setRunInputData: vi.fn(),
  handleStop: () => mockHandleStop(),
  handleSingleRun: () => mockHandleSingleRun(),
  handleRunWithParams: (...args: unknown[]) => mockHandleRunWithParams(...args),
  getExistVarValuesInForms: vi.fn(() => []),
  getFilteredExistVarForms: vi.fn(() => []),
}

const createDataSourceCollection = (overrides: Partial<ToolWithProvider> = {}): ToolWithProvider => ({
  id: 'source-1',
  name: 'Source',
  author: 'Author',
  description: { en_US: 'Source description', zh_Hans: 'Source description' },
  icon: 'source-icon',
  label: { en_US: 'Source', zh_Hans: 'Source' },
  type: 'datasource',
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
  plugin_id: 'source-1',
  tools: [],
  meta: {} as ToolWithProvider['meta'],
  ...overrides,
}) as ToolWithProvider

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { showMessageLogModal: boolean, appDetail: { id: string } }) => unknown) => selector({
    showMessageLogModal: mockShowMessageLogModal,
    appDetail: { id: 'app-1' },
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/store', () => ({
  usePluginStore: () => ({
    setDetail: mockSetDetail,
  }),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useAvailableBlocks: () => ({ availableNextBlocks: [] }),
  useEdgesInteractions: () => ({
    handleEdgeDeleteByDeleteBranch: vi.fn(),
  }),
  useNodeDataUpdate: () => ({
    handleNodeDataUpdate: mockHandleNodeDataUpdate,
    handleNodeDataUpdateWithSyncDraft: mockHandleNodeDataUpdateWithSyncDraft,
  }),
  useNodesInteractions: () => ({
    handleNodeSelect: mockHandleNodeSelect,
  }),
  useNodesMetaData: () => ({
    nodesMap: {
      [BlockEnum.Tool]: { defaultRunInputData: {}, metaData: { helpLinkUri: '' } },
      [BlockEnum.DataSource]: { defaultRunInputData: {}, metaData: { helpLinkUri: '' } },
    },
  }),
  useNodesReadOnly: () => ({
    nodesReadOnly: false,
  }),
  useToolIcon: () => undefined,
  useWorkflowHistory: () => ({
    saveStateToHistory: mockSaveStateToHistory,
  }),
  WorkflowHistoryEvent: {
    NodeTitleChange: 'NodeTitleChange',
    NodeDescriptionChange: 'NodeDescriptionChange',
  },
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: (selector: (state: { configsMap: { flowId: string, flowType: string } }) => unknown) => selector({
    configsMap: {
      flowId: 'flow-1',
      flowType: 'app',
    },
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-inspect-vars-crud', () => ({
  default: () => ({
    appendNodeInspectVars: vi.fn(),
  }),
}))

vi.mock('@/app/components/workflow/run/hooks', () => ({
  useLogs: () => mockLogsState,
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({
    data: mockBuiltInTools,
  }),
}))

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: () => ({
    data: mockTriggerPlugins,
  }),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowAccountSettingModal: mockSetShowAccountSettingModal,
  }),
}))

vi.mock('@/app/components/workflow/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/utils')>()
  return {
    ...actual,
    canRunBySingle: () => true,
    hasErrorHandleNode: () => false,
    hasRetryNode: () => false,
    isSupportCustomRunForm: (type: string) => type === BlockEnum.DataSource,
  }
})

vi.mock('../hooks/use-resize-panel', () => ({
  useResizePanel: () => ({
    triggerRef: { current: null },
    containerRef: { current: null },
  }),
}))

vi.mock('../last-run/use-last-run', () => ({
  default: () => mockLastRunState,
}))

vi.mock('@/app/components/plugins/plugin-auth', () => ({
  PluginAuth: ({ children }: PropsWithChildren) => <div>{children}</div>,
  AuthorizedInNode: ({ onAuthorizationItemClick }: { onAuthorizationItemClick?: (credentialId: string) => void }) => (
    <button onClick={() => onAuthorizationItemClick?.('credential-1')}>authorized-in-node</button>
  ),
  PluginAuthInDataSourceNode: ({ children, onJumpToDataSourcePage }: PropsWithChildren<{ onJumpToDataSourcePage?: () => void }>) => (
    <div>
      <button onClick={onJumpToDataSourcePage}>jump-to-datasource</button>
      {children}
    </div>
  ),
  AuthorizedInDataSourceNode: ({ onJumpToDataSourcePage }: { onJumpToDataSourcePage?: () => void }) => (
    <button onClick={onJumpToDataSourcePage}>authorized-in-datasource-node</button>
  ),
  AuthCategory: { tool: 'tool' },
}))

vi.mock('@/app/components/plugins/readme-panel/entrance', () => ({
  ReadmeEntrance: () => <div>readme-entrance</div>,
}))

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: () => <div>block-icon</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/split', () => ({
  default: () => <div>split</div>,
}))

vi.mock('@/app/components/workflow/nodes/data-source/before-run-form', () => ({
  default: () => <div>data-source-before-run-form</div>,
}))

vi.mock('@/app/components/workflow/run/special-result-panel', () => ({
  default: () => <div>special-result-panel</div>,
}))

vi.mock('../before-run-form', () => ({
  default: () => <div>before-run-form</div>,
}))

vi.mock('../before-run-form/panel-wrap', () => ({
  default: ({ children }: PropsWithChildren<{ nodeName: string, onHide: () => void }>) => <div>{children}</div>,
}))

vi.mock('../error-handle/error-handle-on-panel', () => ({
  default: () => <div>error-handle-panel</div>,
}))

vi.mock('../help-link', () => ({
  default: () => <div>help-link</div>,
}))

vi.mock('../next-step', () => ({
  default: () => <div>next-step</div>,
}))

vi.mock('@/app/components/workflow/node-actions-menu', () => ({
  NodeActionsDropdown: () => <div>node-actions-menu</div>,
}))

vi.mock('../retry/retry-on-panel', () => ({
  default: () => <div>retry-panel</div>,
}))

vi.mock('../title-description-input', () => ({
  TitleInput: ({ value, onBlur }: { value: string, onBlur: (value: string) => void }) => (
    <input aria-label="title-input" defaultValue={value} onBlur={event => onBlur(event.target.value)} />
  ),
  DescriptionInput: ({ value, onChange }: { value: string, onChange: (value: string) => void }) => (
    <textarea aria-label="description-input" defaultValue={value} onChange={event => onChange(event.target.value)} />
  ),
}))

vi.mock('../last-run', () => ({
  default: ({
    isPaused,
    updateNodeRunningStatus,
  }: {
    isPaused?: boolean
    updateNodeRunningStatus?: (status: NodeRunningStatus) => void
  }) => (
    <div>
      <div>{isPaused ? 'paused' : 'active'}</div>
      <button onClick={() => updateNodeRunningStatus?.(NodeRunningStatus.Running)}>last-run-update-status</button>
      <div>last-run-panel</div>
    </div>
  ),
}))

vi.mock('../tab', () => ({
  __esModule: true,
  TabType: { settings: 'settings', lastRun: 'lastRun' },
  default: ({ value, onChange }: { value: string, onChange: (value: string) => void }) => (
    <div>
      <button onClick={() => onChange('settings')}>settings-tab</button>
      <button onClick={() => onChange('lastRun')}>last-run-tab</button>
      <span>{value}</span>
    </div>
  ),
}))

vi.mock('../trigger-subscription', () => ({
  TriggerSubscription: ({ children, onSubscriptionChange }: PropsWithChildren<{ onSubscriptionChange?: (value: { id: string }, callback?: () => void) => void }>) => (
    <div>
      <button onClick={() => onSubscriptionChange?.({ id: 'subscription-1' }, vi.fn())}>change-subscription</button>
      {children}
    </div>
  ),
}))

const createData = (overrides: Record<string, unknown> = {}) => ({
  title: 'Tool Node',
  desc: 'Node description',
  type: BlockEnum.Tool,
  provider_id: 'provider/tool',
  _singleRunningStatus: undefined,
  ...overrides,
})

describe('workflow-panel index', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockShowMessageLogModal = false
    mockBuiltInTools = [{
      id: 'provider/tool',
      name: 'Tool',
      type: 'builtin',
      allow_delete: true,
    }]
    mockTriggerPlugins = []
    mockLogsState.showSpecialResultPanel = false
    mockLastRunState.isShowSingleRun = false
    mockLastRunState.tabType = 'settings'
  })

  it('should render the settings panel and wire title, description, run, and close actions', async () => {
    const { container } = renderWorkflowComponent(
      <BasePanel id="node-1" data={createData() as never}>
        <div>panel-child</div>
      </BasePanel>,
      {
        initialStoreState: {
          showSingleRunPanel: false,
          workflowCanvasWidth: 1200,
          nodePanelWidth: 480,
          otherPanelWidth: 200,
          buildInTools: [],
          dataSourceList: [],
        },
      },
    )

    expect(screen.getByText('panel-child')).toBeInTheDocument()
    expect(screen.getByText('authorized-in-node')).toBeInTheDocument()

    fireEvent.blur(screen.getByDisplayValue('Tool Node'), { target: { value: 'Updated title' } })
    fireEvent.change(screen.getByDisplayValue('Node description'), { target: { value: 'Updated description' } })

    await waitFor(() => {
      expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalled()
    })
    expect(mockSaveStateToHistory).toHaveBeenCalled()
    fireEvent.click(screen.getByText('authorized-in-node'))

    fireEvent.click(screen.getByRole('button', { name: 'workflow.panel.runThisStep' }))

    const clickableItems = container.querySelectorAll('.cursor-pointer')
    fireEvent.click(clickableItems[clickableItems.length - 1] as HTMLElement)

    expect(mockHandleSingleRun).toHaveBeenCalledTimes(1)
    expect(mockHandleNodeSelect).toHaveBeenCalledWith('node-1', true)
    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ credential_id: 'credential-1' }),
    }))
  })

  it('should render the special result panel when logs request it', () => {
    mockLogsState.showSpecialResultPanel = true

    renderWorkflowComponent(
      <BasePanel id="node-1" data={createData() as never}>
        <div>panel-child</div>
      </BasePanel>,
      {
        initialStoreState: {
          nodePanelWidth: 480,
          otherPanelWidth: 200,
        },
      },
    )

    expect(screen.getByText('special-result-panel')).toBeInTheDocument()
  })

  it('should render last-run content when the tab switches', () => {
    mockLastRunState.tabType = 'lastRun'

    renderWorkflowComponent(
      <BasePanel id="node-1" data={createData() as never}>
        <div>panel-child</div>
      </BasePanel>,
      {
        initialStoreState: {
          nodePanelWidth: 480,
          otherPanelWidth: 200,
        },
      },
    )

    expect(screen.getByText('last-run-panel')).toBeInTheDocument()
  })

  it('should render the plain tab layout and allow last-run status updates', async () => {
    mockLastRunState.tabType = 'lastRun'

    renderWorkflowComponent(
      <BasePanel id="node-plain" data={createData({ type: 'custom' }) as never}>
        <div>panel-child</div>
      </BasePanel>,
      {
        initialStoreState: {
          nodePanelWidth: 480,
          otherPanelWidth: 200,
        },
      },
    )

    expect(screen.queryByText('authorized-in-node')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('last-run-update-status'))

    await waitFor(() => {
      expect(mockHandleNodeDataUpdate).toHaveBeenCalledWith(expect.objectContaining({
        id: 'node-plain',
        data: expect.objectContaining({
          _singleRunningStatus: NodeRunningStatus.Running,
        }),
      }))
    })
  })

  it('should mark the last run as paused after a running single-run completes', async () => {
    mockLastRunState.tabType = 'lastRun'

    const { rerender } = renderWorkflowComponent(
      <BasePanel id="node-pause" data={createData({ _singleRunningStatus: NodeRunningStatus.Running }) as never}>
        <div>panel-child</div>
      </BasePanel>,
      {
        initialStoreState: {
          nodePanelWidth: 480,
          otherPanelWidth: 200,
        },
      },
    )

    expect(screen.getByText('active')).toBeInTheDocument()

    rerender(
      <BasePanel id="node-pause" data={createData({ _isSingleRun: true, _singleRunningStatus: undefined }) as never}>
        <div>panel-child</div>
      </BasePanel>,
    )

    await waitFor(() => {
      expect(screen.getByText('paused')).toBeInTheDocument()
    })
  })

  it('should render custom data source single run form for supported nodes', () => {
    mockLastRunState.isShowSingleRun = true

    renderWorkflowComponent(
      <BasePanel id="node-1" data={createData({ type: BlockEnum.DataSource }) as never}>
        <div>panel-child</div>
      </BasePanel>,
      {
        initialStoreState: {
          nodePanelWidth: 480,
          otherPanelWidth: 200,
        },
      },
    )

    expect(screen.getByText('data-source-before-run-form')).toBeInTheDocument()
  })

  it('should render data source authorization controls and jump to the settings modal', () => {
    renderWorkflowComponent(
      <BasePanel id="node-1" data={createData({ type: BlockEnum.DataSource, plugin_id: 'source-1', provider_type: 'remote' }) as never}>
        <div>panel-child</div>
      </BasePanel>,
      {
        initialStoreState: {
          nodePanelWidth: 480,
          otherPanelWidth: 200,
          dataSourceList: [createDataSourceCollection({ is_authorized: false })],
        },
      },
    )

    fireEvent.click(screen.getByText('authorized-in-datasource-node'))

    expect(mockSetShowAccountSettingModal).toHaveBeenCalled()
  })

  it('should react to pending single run actions', () => {
    renderWorkflowComponent(
      <BasePanel id="node-1" data={createData() as never}>
        <div>panel-child</div>
      </BasePanel>,
      {
        initialStoreState: {
          nodePanelWidth: 480,
          otherPanelWidth: 200,
          pendingSingleRun: {
            nodeId: 'node-1',
            action: 'run',
          },
        },
      },
    )

    expect(mockHandleSingleRun).toHaveBeenCalledTimes(1)

    renderWorkflowComponent(
      <BasePanel id="node-1" data={createData() as never}>
        <div>panel-child</div>
      </BasePanel>,
      {
        initialStoreState: {
          nodePanelWidth: 480,
          otherPanelWidth: 200,
          pendingSingleRun: {
            nodeId: 'node-1',
            action: 'stop',
          },
        },
      },
    )

    expect(mockHandleStop).toHaveBeenCalledTimes(1)
  })

  it('should load trigger plugin details when the selected node is a trigger plugin', async () => {
    mockTriggerPlugins = [{
      id: 'trigger-1',
      name: 'trigger-name',
      plugin_id: 'plugin-id',
      plugin_unique_identifier: 'plugin-uid',
      label: {
        en_US: 'Trigger Name',
      },
      declaration: {},
      subscription_schema: [],
      subscription_constructor: {},
    }]

    renderWorkflowComponent(
      <BasePanel id="node-1" data={createData({ type: BlockEnum.TriggerPlugin, plugin_id: 'plugin-id' }) as never}>
        <div>panel-child</div>
      </BasePanel>,
      {
        initialStoreState: {
          nodePanelWidth: 480,
          otherPanelWidth: 200,
        },
      },
    )

    await waitFor(() => {
      expect(mockSetDetail).toHaveBeenCalledWith(expect.objectContaining({
        id: 'trigger-1',
        name: 'Trigger Name',
      }))
    })

    fireEvent.click(screen.getByText('change-subscription'))
    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(
      { id: 'node-1', data: { subscription_id: 'subscription-1' } },
      expect.objectContaining({ sync: true }),
    )
  })

  it('should stop a running node and offset when the log modal is visible', () => {
    mockShowMessageLogModal = true

    const { container } = renderWorkflowComponent(
      <BasePanel id="node-1" data={createData({ _singleRunningStatus: NodeRunningStatus.Running }) as never}>
        <div>panel-child</div>
      </BasePanel>,
      {
        initialStoreState: {
          nodePanelWidth: 480,
          otherPanelWidth: 240,
        },
      },
    )

    const root = container.firstElementChild as HTMLElement
    expect(root.style.right).toBe('240px')
    expect(root.className).toContain('absolute')

    fireEvent.click(screen.getByRole('button', { name: 'workflow.debug.variableInspect.trigger.stop' }))

    expect(mockHandleStop).toHaveBeenCalledTimes(1)
  })

  it('should persist user resize changes and compress oversized panel widths', async () => {
    const { container } = renderWorkflowComponent(
      <BasePanel id="node-resize" data={createData() as never}>
        <div>panel-child</div>
      </BasePanel>,
      {
        initialStoreState: {
          workflowCanvasWidth: 800,
          nodePanelWidth: 600,
          otherPanelWidth: 200,
        },
      },
    )

    await waitFor(() => {
      const panel = container.querySelector('[style*="width"]') as HTMLElement
      expect(panel.style.width).toBe('400px')
    })
  })
})
