import type { InjectWorkflowStoreSliceFn, Shape } from '@/app/components/workflow/store'
import type { EventEmitterValue } from '@/context/event-emitter'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { createTestWorkflowStore } from '@/app/components/workflow/__tests__/workflow-test-env'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { WorkflowContext } from '@/app/components/workflow/context'
import { renderEditor } from '@/app/components/workflow/editor-resource/__tests__/render'
import {
  createHooksStore,
  fullWorkflowAccessControl,
  HooksStoreContext,
} from '@/app/components/workflow/hooks-store'
import { BlockEnum } from '@/app/components/workflow/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { createWorkflowSlice } from '../../store/workflow/workflow-slice'
import WorkflowChildren from '../workflow-children'

type WorkflowStoreState = Partial<Shape>

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

const mockSetNodes = vi.fn()
const mockSetEdges = vi.fn()
const mockHandleSyncWorkflowDraft = vi.fn()
const mockHandleOnboardingClose = vi.fn()
const mockHandlePaneContextmenuCancel = vi.fn()
const mockHandleExportDSL = vi.fn()
const mockExportCheck = vi.fn()
const mockAutoGenerateWebhookUrl = vi.fn()

let workflowStoreState: WorkflowStoreState
let mockCanEdit = true
let workflowStore: ReturnType<typeof createTestWorkflowStore>
let emitWorkflowEvent: (event: EventEmitterValue) => void
function EventSource({ children }: { children: React.ReactNode }) {
  const { eventEmitter } = useEventEmitterContextContext()
  emitWorkflowEvent = (event) => eventEmitter?.emit(event)
  return children
}
const render: typeof renderEditor = (ui, options = {}) => {
  workflowStore = createTestWorkflowStore(
    workflowStoreState,
    createWorkflowSlice as InjectWorkflowStoreSliceFn,
  )
  const hooksStore = createHooksStore({
    accessControl: { ...fullWorkflowAccessControl, canEdit: mockCanEdit },
  })
  return renderEditor(ui, {
    ...options,
    wrapper: ({ children }) => (
      <WorkflowContext value={workflowStore}>
        <HooksStoreContext value={hooksStore}>
          <EventEmitterContextProvider>
            <EventSource>{children}</EventSource>
          </EventEmitterContextProvider>
        </HooksStoreContext>
      </WorkflowContext>
    ),
  })
}

vi.mock('reactflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('reactflow')>()),
  useStoreApi: () => ({
    getState: () => ({
      setNodes: mockSetNodes,
      setEdges: mockSetEdges,
    }),
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-DSL', () => ({
  useAutoGenerateWebhookUrl: () => mockAutoGenerateWebhookUrl,
  useDSL: () => ({
    exportCheck: mockExportCheck,
    handleExportDSL: mockHandleExportDSL,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-panel-interactions', () => ({
  usePanelInteractions: () => ({
    handlePaneContextmenuCancel: mockHandlePaneContextmenuCancel,
    handlePaneContextMenu: vi.fn(),
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-auto-generate-webhook-url', () => ({
  useAutoGenerateWebhookUrl: () => mockAutoGenerateWebhookUrl,
}))

vi.mock('@/app/components/workflow/node-catalog', () => ({
  useWorkflowNodeCatalog: () => ({
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

vi.mock('../../hooks/use-auto-onboarding', () => ({
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

vi.mock('next/dynamic', async () => {
  const ReactModule = await import('react')

  return {
    default: (loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) => {
      const DynamicComponent = (props: Record<string, unknown>) => {
        const [Loaded, setLoaded] = ReactModule.useState<React.ComponentType<
          Record<string, unknown>
        > | null>(null)

        ReactModule.useEffect(() => {
          let mounted = true
          loader().then((mod) => {
            if (mounted) setLoaded(() => mod.default)
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
    onOpenChange,
    onBackup,
    onImport,
  }: {
    onOpenChange: (open: boolean) => void
    onBackup: () => void
    onImport: () => void
  }) => (
    <div data-testid="update-dsl-modal">
      <button type="button" onClick={() => onOpenChange(false)}>
        cancel-import-dsl
      </button>
      <button type="button" onClick={onBackup}>
        backup-dsl
      </button>
      <button type="button" onClick={onImport}>
        import-dsl
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/app/export-confirm-modal', () => ({
  default: ({
    envList,
    onConfirm,
    onClose,
  }: {
    envList: Array<Record<string, unknown>>
    onConfirm: (includeSecret: boolean) => void
    onClose: () => void
  }) => (
    <div data-testid="dsl-export-confirm-modal" data-env-count={String(envList.length)}>
      <button type="button" onClick={() => onConfirm(true)}>
        confirm-export-dsl
      </button>
      <button type="button" onClick={onClose}>
        close-export-dsl
      </button>
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
      <button type="button" onClick={onClose}>
        close-onboarding
      </button>
      <button type="button" onClick={() => onSelectStartNode(BlockEnum.Start)}>
        select-start-node
      </button>
      <button
        type="button"
        onClick={() =>
          onSelectStartNode(BlockEnum.Start, {
            title: 'Configured Start Title',
            desc: 'Configured Start Description',
            config: { image: true, custom: 'config' },
            extra: 'field',
          } as never)
        }
      >
        select-start-node-with-config
      </button>
      <button
        type="button"
        onClick={() =>
          onSelectStartNode(BlockEnum.TriggerPlugin, {
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
          })
        }
      >
        select-trigger-plugin
      </button>
      <button
        type="button"
        onClick={() =>
          onSelectStartNode(BlockEnum.TriggerPlugin, {
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
          } as never)
        }
      >
        select-trigger-plugin-fallback
      </button>
    </div>
  ),
}))

describe('WorkflowChildren', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    workflowStoreState = {
      showFeaturesPanel: false,
      showImportDSLModal: false,
      showOnboarding: false,
    }

    mockCanEdit = true
    mockHandleSyncWorkflowDraft.mockImplementation(
      (_force?: boolean, _notRefresh?: boolean, callback?: { onSuccess?: () => void }) => {
        callback?.onSuccess?.()
      },
    )
  })

  it('backs up and imports DSL, then closes the import dialog', async () => {
    const user = userEvent.setup()
    workflowStoreState = {
      ...workflowStoreState,
      showFeaturesPanel: true,
      showImportDSLModal: true,
    }

    render(<WorkflowChildren />, { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } })

    expect(await screen.findByTestId('workflow-features')).toBeInTheDocument()
    expect(screen.getByTestId('update-dsl-modal')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /backup-dsl/i }))
    await user.click(screen.getByRole('button', { name: /^import-dsl$/i }))
    await user.click(screen.getByRole('button', { name: /cancel-import-dsl/i }))
    expect(screen.queryByTestId('update-dsl-modal')).not.toBeInTheDocument()

    expect(workflowStore.getState().showImportDSLModal).toEqual(false)
    expect(mockExportCheck).toHaveBeenCalled()
    expect(mockHandlePaneContextmenuCancel).toHaveBeenCalled()
  })

  it('should react to DSL export check events by showing the confirm modal and closing it', async () => {
    const user = userEvent.setup()

    render(<WorkflowChildren />, { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } })

    act(() =>
      emitWorkflowEvent({
        type: 'UNRELATED_EVENT',
        payload: { data: [{ name: 'IGNORED', value: 'secret' }] },
      }),
    )
    expect(screen.queryByTestId('dsl-export-confirm-modal')).not.toBeInTheDocument()

    await act(async () => {
      emitWorkflowEvent({
        type: DSL_EXPORT_CHECK,
        payload: {
          data: [
            { name: 'API_KEY', value: 'secret' },
            { name: 'TOKEN', value: 'other-secret' },
          ],
        },
      })
    })

    expect(await screen.findByTestId('dsl-export-confirm-modal')).toHaveAttribute(
      'data-env-count',
      '2',
    )

    await user.click(screen.getByRole('button', { name: /confirm-export-dsl/i }))
    await user.click(screen.getByRole('button', { name: /close-export-dsl/i }))

    expect(mockHandleExportDSL).toHaveBeenCalledWith(true)
    expect(screen.queryByTestId('dsl-export-confirm-modal')).not.toBeInTheDocument()
  })

  it('should close onboarding through the onboarding hook callback', async () => {
    const user = userEvent.setup()
    workflowStoreState = {
      ...workflowStoreState,
      showOnboarding: true,
    }

    render(<WorkflowChildren />, { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } })

    expect(await screen.findByTestId('workflow-onboarding-modal')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /close-onboarding/i }))

    expect(mockHandleOnboardingClose).toHaveBeenCalled()
  })

  it('should hide onboarding actions when workflow is readonly', () => {
    mockCanEdit = false
    workflowStoreState = {
      ...workflowStoreState,
      showOnboarding: true,
    }

    render(<WorkflowChildren />, { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } })

    expect(screen.queryByTestId('workflow-onboarding-modal')).not.toBeInTheDocument()
    expect(mockSetNodes).not.toHaveBeenCalled()
    expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('should create a start node, sync draft, and auto-generate webhook url after selecting a start node', async () => {
    const user = userEvent.setup()
    workflowStoreState = {
      ...workflowStoreState,
      showOnboarding: true,
    }

    render(<WorkflowChildren />, { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } })

    await user.click(await screen.findByRole('button', { name: /^select-start-node$/i }))

    expect(mockSetNodes.mock.lastCall?.[0][0]).toMatchObject({
      data: {
        title: 'Start Title',
        desc: 'Start description',
        config: {
          image: false,
        },
      },
    })
    expect(mockSetNodes).toHaveBeenCalledWith([expect.objectContaining({ id: expect.any(String) })])
    expect(mockSetEdges).toHaveBeenCalledWith([])
    expect(workflowStore.getState().showOnboarding).toEqual(false)
    expect(workflowStore.getState().hasSelectedStartNode).toEqual(true)
    expect(workflowStore.getState().shouldAutoOpenStartNodeSelector).toEqual(true)
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledWith(true, false, expect.any(Object))
    expect(mockAutoGenerateWebhookUrl).toHaveBeenCalledWith(mockSetNodes.mock.lastCall?.[0][0].id)
  })

  it('should merge non-trigger start node config directly into the default node data', async () => {
    const user = userEvent.setup()
    workflowStoreState = {
      ...workflowStoreState,
      showOnboarding: true,
    }

    render(<WorkflowChildren />, { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } })

    await user.click(await screen.findByRole('button', { name: /select-start-node-with-config/i }))

    expect(mockSetNodes.mock.lastCall?.[0][0]).toMatchObject({
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

    render(<WorkflowChildren />, { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } })

    await user.click(await screen.findByRole('button', { name: /^select-trigger-plugin$/i }))

    expect(mockSetNodes.mock.lastCall?.[0][0]).toMatchObject({
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

    render(<WorkflowChildren />, { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } })

    await user.click(await screen.findByRole('button', { name: /select-trigger-plugin-fallback/i }))

    expect(mockSetNodes.mock.lastCall?.[0][0]).toMatchObject({
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
