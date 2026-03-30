import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { BlockEnum } from '@/app/components/workflow/types'
import WorkflowChildren from '../workflow-children'

type WorkflowStoreState = {
  showFeaturesPanel: boolean
  showImportDSLModal: boolean
  setShowImportDSLModal: (show: boolean) => void
  showOnboarding: boolean
  setShowOnboarding: (show: boolean) => void
  setHasSelectedStartNode: (selected: boolean) => void
  setShouldAutoOpenStartNodeSelector: (open: boolean) => void
}

type TriggerPluginConfig = {
  plugin_id: string
  provider_name: string
  provider_type: string
  event_name: string
  event_label: string
  event_description: string
  output_schema: Record<string, unknown>
  paramSchemas: Array<Record<string, unknown>>
  params: Record<string, unknown>
  subscription_id: string
  plugin_unique_identifier: string
  is_team_authorization: boolean
  meta?: Record<string, unknown>
}

const mockSetShowImportDSLModal = vi.fn()
const mockSetShowOnboarding = vi.fn()
const mockSetHasSelectedStartNode = vi.fn()
const mockSetShouldAutoOpenStartNodeSelector = vi.fn()
const mockSetNodes = vi.fn()
const mockSetEdges = vi.fn()
const mockHandleSyncWorkflowDraft = vi.fn()
const mockHandleOnboardingClose = vi.fn()
const mockHandlePaneContextmenuCancel = vi.fn()
const mockHandleExportDSL = vi.fn()
const mockExportCheck = vi.fn()
const mockAutoGenerateWebhookUrl = vi.fn()

let workflowStoreState: WorkflowStoreState
let eventSubscription: ((value: { type: string, payload: { data: Array<Record<string, unknown>> } }) => void) | null = null
let lastGenerateNodeInput: Record<string, unknown> | null = null

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      setNodes: mockSetNodes,
      setEdges: mockSetEdges,
    }),
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(selector: (state: WorkflowStoreState) => T) => selector(workflowStoreState),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      useSubscription: (callback: typeof eventSubscription) => {
        eventSubscription = callback
      },
    },
  }),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useAutoGenerateWebhookUrl: () => mockAutoGenerateWebhookUrl,
  useDSL: () => ({
    exportCheck: mockExportCheck,
    handleExportDSL: mockHandleExportDSL,
  }),
  usePanelInteractions: () => ({
    handlePaneContextmenuCancel: mockHandlePaneContextmenuCancel,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
  }),
}))

vi.mock('@/app/components/workflow/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/utils')>()
  return {
    ...actual,
    generateNewNode: (args: Record<string, unknown>) => {
      lastGenerateNodeInput = args
      return {
        newNode: {
          id: 'new-node-id',
          position: args.position,
          data: args.data,
        },
      }
    },
  }
})

vi.mock('@/app/components/workflow-app/hooks', () => ({
  useAvailableNodesMetaData: () => ({
    nodesMap: {
      [BlockEnum.Start]: {
        defaultValue: {
          title: 'Start Title',
          desc: 'Start description',
          config: {
            image: false,
          },
        },
      },
      [BlockEnum.TriggerPlugin]: {
        defaultValue: {
          title: 'Plugin title',
          desc: 'Plugin description',
          config: {
            baseConfig: 'base',
          },
        },
      },
    },
  }),
}))

vi.mock('@/app/components/workflow-app/hooks/use-auto-onboarding', () => ({
  useAutoOnboarding: () => ({
    handleOnboardingClose: mockHandleOnboardingClose,
  }),
}))

vi.mock('@/app/components/workflow/plugin-dependency', () => ({
  default: () => <div data-testid="plugin-dependency">plugin-dependency</div>,
}))

vi.mock('@/app/components/workflow-app/components/workflow-header', () => ({
  default: () => <div data-testid="workflow-header">workflow-header</div>,
}))

vi.mock('@/app/components/workflow-app/components/workflow-panel', () => ({
  default: () => <div data-testid="workflow-panel">workflow-panel</div>,
}))

vi.mock('@/next/dynamic', async () => {
  const ReactModule = await import('react')

  return {
    default: (
      loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>,
    ) => {
      const DynamicComponent = (props: Record<string, unknown>) => {
        const [Loaded, setLoaded] = ReactModule.useState<React.ComponentType<Record<string, unknown>> | null>(null)

        ReactModule.useEffect(() => {
          let mounted = true
          loader().then((mod) => {
            if (mounted)
              setLoaded(() => mod.default)
          })
          return () => {
            mounted = false
          }
        }, [])

        return Loaded ? <Loaded {...props} /> : null
      }

      return DynamicComponent
    },
  }
})

vi.mock('@/app/components/workflow/features', () => ({
  default: () => <div data-testid="workflow-features">features</div>,
}))

vi.mock('@/app/components/workflow/update-dsl-modal', () => ({
  default: ({
    onCancel,
    onBackup,
    onImport,
  }: {
    onCancel: () => void
    onBackup: () => void
    onImport: () => void
  }) => (
    <div data-testid="update-dsl-modal">
      <button type="button" onClick={onCancel}>cancel-import-dsl</button>
      <button type="button" onClick={onBackup}>backup-dsl</button>
      <button type="button" onClick={onImport}>import-dsl</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/dsl-export-confirm-modal', () => ({
  default: ({
    envList,
    onConfirm,
    onClose,
  }: {
    envList: Array<Record<string, unknown>>
    onConfirm: () => void
    onClose: () => void
  }) => (
    <div data-testid="dsl-export-confirm-modal" data-env-count={String(envList.length)}>
      <button type="button" onClick={onConfirm}>confirm-export-dsl</button>
      <button type="button" onClick={onClose}>close-export-dsl</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow-app/components/workflow-onboarding-modal', () => ({
  default: ({
    onClose,
    onSelectStartNode,
  }: {
    isShow: boolean
    onClose: () => void
    onSelectStartNode: (nodeType: BlockEnum, config?: TriggerPluginConfig) => void
  }) => (
    <div data-testid="workflow-onboarding-modal">
      <button type="button" onClick={onClose}>close-onboarding</button>
      <button type="button" onClick={() => onSelectStartNode(BlockEnum.Start)}>select-start-node</button>
      <button
        type="button"
        onClick={() => onSelectStartNode(BlockEnum.Start, {
          title: 'Configured Start Title',
          desc: 'Configured Start Description',
          config: { image: true, custom: 'config' },
          extra: 'field',
        } as never)}
      >
        select-start-node-with-config
      </button>
      <button
        type="button"
        onClick={() => onSelectStartNode(BlockEnum.TriggerPlugin, {
          plugin_id: 'plugin-id',
          provider_name: 'provider-name',
          provider_type: 'tool',
          event_name: 'event-name',
          event_label: 'Event Label',
          event_description: 'Event Description',
          output_schema: { output: true },
          paramSchemas: [{ name: 'api_key' }],
          params: { token: 'abc' },
          subscription_id: 'subscription-id',
          plugin_unique_identifier: 'plugin-unique',
          is_team_authorization: true,
          meta: { source: 'plugin' },
        })}
      >
        select-trigger-plugin
      </button>
      <button
        type="button"
        onClick={() => onSelectStartNode(BlockEnum.TriggerPlugin, {
          plugin_id: 'plugin-id-2',
          provider_name: 'provider-name-2',
          provider_type: 'tool',
          event_name: 'event-name-2',
          event_label: '',
          event_description: '',
          output_schema: {},
          paramSchemas: undefined,
          params: {},
          subscription_id: 'subscription-id-2',
          plugin_unique_identifier: 'plugin-unique-2',
          is_team_authorization: false,
        } as never)}
      >
        select-trigger-plugin-fallback
      </button>
    </div>
  ),
}))

describe('WorkflowChildren', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowStoreState = {
      showFeaturesPanel: false,
      showImportDSLModal: false,
      setShowImportDSLModal: mockSetShowImportDSLModal,
      showOnboarding: false,
      setShowOnboarding: mockSetShowOnboarding,
      setHasSelectedStartNode: mockSetHasSelectedStartNode,
      setShouldAutoOpenStartNodeSelector: mockSetShouldAutoOpenStartNodeSelector,
    }
    eventSubscription = null
    lastGenerateNodeInput = null
    mockHandleSyncWorkflowDraft.mockImplementation((_force?: boolean, _notRefresh?: boolean, callback?: { onSuccess?: () => void }) => {
      callback?.onSuccess?.()
    })
  })

  it('should render feature panel, import modal actions, and default workflow chrome', async () => {
    const user = userEvent.setup()
    workflowStoreState = {
      ...workflowStoreState,
      showFeaturesPanel: true,
      showImportDSLModal: true,
    }

    render(<WorkflowChildren />)

    expect(screen.getByTestId('plugin-dependency')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-header')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-panel')).toBeInTheDocument()
    expect(await screen.findByTestId('workflow-features')).toBeInTheDocument()
    expect(screen.getByTestId('update-dsl-modal')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /cancel-import-dsl/i }))
    await user.click(screen.getByRole('button', { name: /backup-dsl/i }))
    await user.click(screen.getByRole('button', { name: /^import-dsl$/i }))

    expect(mockSetShowImportDSLModal).toHaveBeenCalledWith(false)
    expect(mockExportCheck).toHaveBeenCalled()
    expect(mockHandlePaneContextmenuCancel).toHaveBeenCalled()
  })

  it('should react to DSL export check events by showing the confirm modal and closing it', async () => {
    const user = userEvent.setup()

    render(<WorkflowChildren />)

    await act(async () => {
      eventSubscription?.({
        type: DSL_EXPORT_CHECK,
        payload: {
          data: [{ id: 'env-1' }, { id: 'env-2' }],
        },
      })
    })

    expect(await screen.findByTestId('dsl-export-confirm-modal')).toHaveAttribute('data-env-count', '2')

    await user.click(screen.getByRole('button', { name: /confirm-export-dsl/i }))
    await user.click(screen.getByRole('button', { name: /close-export-dsl/i }))

    expect(mockHandleExportDSL).toHaveBeenCalled()
    expect(screen.queryByTestId('dsl-export-confirm-modal')).not.toBeInTheDocument()
  })

  it('should ignore unrelated workflow events when listening for DSL export checks', async () => {
    render(<WorkflowChildren />)

    await act(async () => {
      eventSubscription?.({
        type: 'UNRELATED_EVENT',
        payload: {
          data: [{ id: 'env-1' }],
        },
      })
    })

    expect(screen.queryByTestId('dsl-export-confirm-modal')).not.toBeInTheDocument()
  })

  it('should close onboarding through the onboarding hook callback', async () => {
    const user = userEvent.setup()
    workflowStoreState = {
      ...workflowStoreState,
      showOnboarding: true,
    }

    render(<WorkflowChildren />)

    expect(await screen.findByTestId('workflow-onboarding-modal')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /close-onboarding/i }))

    expect(mockHandleOnboardingClose).toHaveBeenCalled()
  })

  it('should create a start node, sync draft, and auto-generate webhook url after selecting a start node', async () => {
    const user = userEvent.setup()
    workflowStoreState = {
      ...workflowStoreState,
      showOnboarding: true,
    }

    render(<WorkflowChildren />)

    await user.click(await screen.findByRole('button', { name: /^select-start-node$/i }))

    expect(lastGenerateNodeInput).toMatchObject({
      data: {
        title: 'Start Title',
        desc: 'Start description',
        config: {
          image: false,
        },
      },
    })
    expect(mockSetNodes).toHaveBeenCalledWith([expect.objectContaining({ id: 'new-node-id' })])
    expect(mockSetEdges).toHaveBeenCalledWith([])
    expect(mockSetShowOnboarding).toHaveBeenCalledWith(false)
    expect(mockSetHasSelectedStartNode).toHaveBeenCalledWith(true)
    expect(mockSetShouldAutoOpenStartNodeSelector).toHaveBeenCalledWith(true)
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledWith(true, false, expect.any(Object))
    expect(mockAutoGenerateWebhookUrl).toHaveBeenCalledWith('new-node-id')
  })

  it('should merge non-trigger start node config directly into the default node data', async () => {
    const user = userEvent.setup()
    workflowStoreState = {
      ...workflowStoreState,
      showOnboarding: true,
    }

    render(<WorkflowChildren />)

    await user.click(await screen.findByRole('button', { name: /select-start-node-with-config/i }))

    expect(lastGenerateNodeInput).toMatchObject({
      data: {
        title: 'Configured Start Title',
        desc: 'Configured Start Description',
        config: {
          image: true,
          custom: 'config',
        },
        extra: 'field',
      },
    })
  })

  it('should merge trigger plugin defaults and config before creating the node', async () => {
    const user = userEvent.setup()
    workflowStoreState = {
      ...workflowStoreState,
      showOnboarding: true,
    }

    render(<WorkflowChildren />)

    await user.click(await screen.findByRole('button', { name: /^select-trigger-plugin$/i }))

    expect(lastGenerateNodeInput).toMatchObject({
      data: {
        plugin_id: 'plugin-id',
        provider_id: 'provider-name',
        provider_name: 'provider-name',
        provider_type: 'tool',
        event_name: 'event-name',
        event_label: 'Event Label',
        event_description: 'Event Description',
        title: 'Event Label',
        desc: 'Event Description',
        output_schema: { output: true },
        parameters_schema: [{ name: 'api_key' }],
        config: {
          baseConfig: 'base',
          token: 'abc',
        },
        subscription_id: 'subscription-id',
        plugin_unique_identifier: 'plugin-unique',
        is_team_authorization: true,
        meta: { source: 'plugin' },
      },
    })
  })

  it('should fall back to plugin default title and description when trigger labels are missing', async () => {
    const user = userEvent.setup()
    workflowStoreState = {
      ...workflowStoreState,
      showOnboarding: true,
    }

    render(<WorkflowChildren />)

    await user.click(await screen.findByRole('button', { name: /select-trigger-plugin-fallback/i }))

    expect(lastGenerateNodeInput).toMatchObject({
      data: {
        title: 'Plugin title',
        desc: 'Plugin description',
        parameters_schema: [],
        config: {
          baseConfig: 'base',
        },
      },
    })
  })
})
