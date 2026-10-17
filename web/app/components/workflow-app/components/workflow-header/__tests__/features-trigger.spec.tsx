import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { ReactElement, ReactNode } from 'react'
import type { AppPublisherProps } from '@/app/components/app/app-publisher/types'
import type { Shape } from '@/app/components/workflow/store'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createTestWorkflowStore } from '@/app/components/workflow/__tests__/workflow-test-env'
import { WorkflowContext } from '@/app/components/workflow/context'
import { renderEditor as render } from '@/app/components/workflow/editor-resource/__tests__/render'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper, seedFeatures } from '@/test/console/query-data'
import FeaturesTrigger from '../features-trigger'

const mockUseIsChatMode = vi.fn()
const mockUseTheme = vi.fn()
const mockUseNodesReadOnly = vi.fn()
const mockUseChecklist = vi.fn()
const mockUseChecklistBeforePublish = vi.fn()
const mockUseNodesSyncDraft = vi.fn()
const mockUseFeatures = vi.fn()
const mockUseNodes = vi.fn()
const mockUseEdges = vi.fn()

const toastMocks = vi.hoisted(() => ({
  call: vi.fn(),
  dismiss: vi.fn(),
  update: vi.fn(),
  promise: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: Object.assign(toastMocks.call, {
    success: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'success', message, ...options }),
    ),
    error: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'error', message, ...options }),
    ),
    warning: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'warning', message, ...options }),
    ),
    info: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'info', message, ...options }),
    ),
    dismiss: toastMocks.dismiss,
    update: toastMocks.update,
    promise: toastMocks.promise,
  }),
}))
const mockHandleCheckBeforePublish = vi.fn()
const mockHandleSyncWorkflowDraft = vi.fn()
const mockPublishWorkflow = vi.fn()
const mockUpdatePublishedWorkflow = vi.fn()
const mockResetWorkflowVersionHistory = vi.fn()
const mockInvalidateQueries = vi.fn()
let workflowStoreState: Partial<Shape>
let workflowStore: ReturnType<typeof createTestWorkflowStore>

vi.mock('@/app/components/workflow/hooks/use-workflow', () => ({
  useNodesReadOnly: () => mockUseNodesReadOnly(),
}))

vi.mock('@/app/components/workflow/hooks/use-checklist', () => ({
  useChecklist: (...args: unknown[]) => mockUseChecklist(...args),
  useChecklistBeforePublish: () => mockUseChecklistBeforePublish(),
}))

vi.mock('@/app/components/workflow/hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => mockUseNodesSyncDraft(),
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: <T,>(
    selector: (state: { accessControl: { canReleaseAndVersion: boolean } }) => T,
  ): T =>
    selector({
      accessControl: {
        canReleaseAndVersion: true,
      },
    }),
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (state: Record<string, unknown>) => unknown) => mockUseFeatures(selector),
}))

vi.mock('@/app/components/workflow/store/workflow/use-nodes', () => ({
  default: () => mockUseNodes(),
}))

vi.mock('reactflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('reactflow')>()),
  useEdges: () => mockUseEdges(),
}))

vi.mock('@/app/components/app/app-publisher', () => ({
  AppPublisher: (props: AppPublisherProps) => {
    const inputs = props.inputs ?? []
    return (
      <div
        data-testid="app-publisher"
        data-disabled={String(Boolean(props.disabled))}
        data-publish-disabled={String(Boolean(props.publishDisabled))}
        data-start-node-limit-exceeded={String(Boolean(props.startNodeLimitExceeded))}
        data-has-trigger-node={String(Boolean(props.hasTriggerNode))}
        data-inputs={JSON.stringify(inputs)}
        data-outputs={JSON.stringify(props.outputs ?? [])}
      >
        <button
          type="button"
          onClick={() => {
            props.onRefreshData?.()
          }}
        >
          publisher-refresh
        </button>
        <button
          type="button"
          onClick={() => {
            props.onToggle?.(true)
          }}
        >
          publisher-toggle-on
        </button>
        <button
          type="button"
          onClick={() => {
            props.onToggle?.(false)
          }}
        >
          publisher-toggle-off
        </button>
        <button
          type="button"
          onClick={() => {
            Promise.resolve(props.onPublish?.()).catch(() => undefined)
          }}
        >
          publisher-publish
        </button>
        <button
          type="button"
          onClick={() => {
            Promise.resolve(
              (
                props.onPublish as
                  | ((
                      params?: unknown,
                      options?: { showSuccessToast?: boolean },
                    ) => Promise<unknown> | unknown)
                  | undefined
              )?.(undefined, { showSuccessToast: false }),
            ).catch(() => undefined)
          }}
        >
          publisher-publish-silently
        </button>
        <button
          type="button"
          onClick={() => {
            Promise.resolve(
              props.onPublish?.({
                url: '/apps/app-id/workflows/publish/custom',
                title: 'Custom title',
                releaseNotes: 'Custom notes',
              }),
            ).catch(() => undefined)
          }}
        >
          publisher-publish-custom
        </button>
      </div>
    )
  },
}))

vi.mock('@/service/use-workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-workflow')>()),
  useInvalidateAppWorkflow: () => mockUpdatePublishedWorkflow,
  useResetWorkflowVersionHistory: () => mockResetWorkflowVersionHistory,
}))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-id' }),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => mockUseTheme(),
}))

const renderWithToast = (
  ui: ReactElement,
  { edition = 'CLOUD', plan = 'sandbox' }: { edition?: DeploymentEdition; plan?: CloudPlan } = {},
) => {
  workflowStore = createTestWorkflowStore(workflowStoreState)
  const { queryClient, wrapper: QueryWrapper } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: edition },
  })
  seedFeatures(queryClient, { billing: { subscription: { plan } } })
  vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(mockInvalidateQueries)
  return {
    ...render(ui, {
      resource: {
        kind: 'app',
        appId: 'app-id',
        mode: mockUseIsChatMode() ? 'advanced-chat' : 'workflow',
      },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryWrapper>
          <WorkflowContext value={workflowStore}>{children}</WorkflowContext>
        </QueryWrapper>
      ),
      queryClient,
    }),
  }
}

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  post: (...args: unknown[]) => mockPublishWorkflow(...args),
}))

describe('FeaturesTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowStoreState = {
      showFeaturesPanel: false,
      isRestoring: false,
    }

    mockUseIsChatMode.mockReturnValue(false)
    mockUseTheme.mockReturnValue({ theme: 'light' })
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false, getNodesReadOnly: () => false })
    mockUseChecklist.mockReturnValue([])
    mockUseChecklistBeforePublish.mockReturnValue({
      handleCheckBeforePublish: mockHandleCheckBeforePublish,
    })
    mockHandleCheckBeforePublish.mockResolvedValue(true)
    mockUseNodesSyncDraft.mockReturnValue({ handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft })
    mockHandleSyncWorkflowDraft.mockResolvedValue({ hash: 'draft-hash', updatedAt: 1 })
    mockUseFeatures.mockImplementation((selector: (state: Record<string, unknown>) => unknown) =>
      selector({ features: { file: {} } }),
    )
    mockUseNodes.mockReturnValue([])
    mockUseEdges.mockReturnValue([])
    mockInvalidateQueries.mockResolvedValue(undefined)
    mockPublishWorkflow.mockResolvedValue({ created_at: 1704067200 })
  })

  // Verifies the feature toggle button only appears in chatflow mode.
  describe('Rendering', () => {
    it('should not render the features button when not in chat mode', () => {
      mockUseIsChatMode.mockReturnValue(false)

      renderWithToast(<FeaturesTrigger />)

      expect(
        screen.queryByRole('button', { name: /workflow\.common\.features/i }),
      ).not.toBeInTheDocument()
    })
  })

  // Verifies user clicks toggle the features panel visibility.
  describe('User Interactions', () => {
    it('should toggle features panel when clicked and nodes are editable', async () => {
      const user = userEvent.setup()
      mockUseIsChatMode.mockReturnValue(true)
      mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false, getNodesReadOnly: () => false })

      renderWithToast(<FeaturesTrigger />)

      await user.click(screen.getByRole('button', { name: /workflow\.common\.features/i }))

      expect(workflowStore.getState().showFeaturesPanel).toBe(true)
      await user.click(screen.getByRole('button', { name: /workflow\.common\.features/i }))
      expect(workflowStore.getState().showFeaturesPanel).toBe(false)
    })
  })

  // Covers read-only gating that prevents toggling unless restoring.
  describe('Edge Cases', () => {
    it('should not toggle features panel when nodes are read-only and not restoring', async () => {
      const user = userEvent.setup()
      mockUseIsChatMode.mockReturnValue(true)
      mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: true, getNodesReadOnly: () => true })
      workflowStoreState = {
        ...workflowStoreState,
        isRestoring: false,
      }

      renderWithToast(<FeaturesTrigger />)

      await user.click(screen.getByRole('button', { name: /workflow\.common\.features/i }))

      expect(workflowStore.getState().showFeaturesPanel).toBe(false)
    })
  })

  // Verifies the publisher reflects the presence of workflow nodes.
  describe('Props', () => {
    it('should disable AppPublisher when there are no workflow nodes', () => {
      mockUseIsChatMode.mockReturnValue(false)
      mockUseNodes.mockReturnValue([])

      renderWithToast(<FeaturesTrigger />)

      expect(screen.getByTestId('app-publisher')).toHaveAttribute('data-disabled', 'true')
    })
  })

  // Verifies derived props passed into AppPublisher (variables, limits, and triggers).
  describe('Computed Props', () => {
    it('should pass outputs from every end node to AppPublisher', () => {
      const aaa = {
        variable: 'aaa',
        value_type: 'string',
        value_selector: ['source-1', 'value'],
      }
      const bbb = {
        variable: 'bbb',
        value_type: 'number',
        value_selector: ['source-2', 'value'],
      }
      mockUseNodes.mockReturnValue([
        { id: 'end-1', data: { type: BlockEnum.End, title: 'Success End', outputs: [aaa] } },
        { id: 'end-2', data: { type: BlockEnum.End, title: 'Fallback End', outputs: [bbb] } },
      ])

      renderWithToast(<FeaturesTrigger />)

      const outputs = JSON.parse(
        screen.getByTestId('app-publisher').getAttribute('data-outputs') ?? '[]',
      )
      expect(outputs).toEqual([
        {
          ...aaa,
          source: { nodeId: 'end-1', nodeTitle: 'Success End', outputIndex: 0 },
        },
        {
          ...bbb,
          source: { nodeId: 'end-2', nodeTitle: 'Fallback End', outputIndex: 0 },
        },
      ])
    })

    it('should append image input when file image upload is enabled', () => {
      mockUseFeatures.mockImplementation((selector: (state: Record<string, unknown>) => unknown) =>
        selector({
          features: { file: { image: { enabled: true } } },
        }),
      )
      mockUseNodes.mockReturnValue([{ id: 'start', data: { type: BlockEnum.Start } }])

      renderWithToast(<FeaturesTrigger />)

      const inputs = JSON.parse(
        screen.getByTestId('app-publisher').getAttribute('data-inputs') ?? '[]',
      ) as Array<{
        type?: string
        variable?: string
        required?: boolean
        label?: string
      }>
      expect(inputs).toContainEqual({
        type: InputVarType.files,
        variable: '__image',
        required: false,
        label: 'files',
      })
    })

    it.each([
      { edition: 'CLOUD', plan: 'sandbox', restricted: true },
      { edition: 'CLOUD', plan: 'professional', restricted: false },
      { edition: 'COMMUNITY', plan: 'sandbox', restricted: false },
      { edition: 'ENTERPRISE', plan: 'sandbox', restricted: false },
    ] as const)(
      'should apply the entry limit for $edition / $plan',
      ({ edition, plan, restricted }) => {
        mockUseNodes.mockReturnValue([
          { id: 'start', data: { type: BlockEnum.Start } },
          { id: 'trigger-1', data: { type: BlockEnum.TriggerWebhook } },
          { id: 'trigger-2', data: { type: BlockEnum.TriggerSchedule } },
          { id: 'end', data: { type: BlockEnum.End } },
        ])

        renderWithToast(<FeaturesTrigger />, { edition, plan })

        const publisher = screen.getByTestId('app-publisher')
        expect(publisher).toHaveAttribute('data-start-node-limit-exceeded', String(restricted))
        expect(publisher).toHaveAttribute('data-publish-disabled', String(restricted))
        expect(publisher).toHaveAttribute('data-has-trigger-node', 'true')
      },
    )
  })

  // Verifies callbacks wired from AppPublisher to stores and draft syncing.
  describe('Callbacks', () => {
    it('should set toolPublished when AppPublisher refreshes data', async () => {
      const user = userEvent.setup()
      renderWithToast(<FeaturesTrigger />)

      await user.click(screen.getByRole('button', { name: 'publisher-refresh' }))

      expect(workflowStore.getState().toolPublished).toBe(true)
    })

    it('should sync workflow draft when AppPublisher toggles on', async () => {
      const user = userEvent.setup()
      renderWithToast(<FeaturesTrigger />)

      await user.click(screen.getByRole('button', { name: 'publisher-toggle-on' }))

      expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledWith(true)
    })

    it('should not sync workflow draft when AppPublisher toggles off', async () => {
      const user = userEvent.setup()
      renderWithToast(<FeaturesTrigger />)

      await user.click(screen.getByRole('button', { name: 'publisher-toggle-off' }))

      expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
    })
  })

  // Verifies publishing behavior across warnings, validation, and success.
  describe('Publishing', () => {
    it('should wait for the draft save barrier before publishing', async () => {
      const user = userEvent.setup()
      let resolveDraftSync: ((value: { hash: string; updatedAt: number }) => void) | undefined
      mockHandleSyncWorkflowDraft.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveDraftSync = resolve
        }),
      )
      renderWithToast(<FeaturesTrigger />)

      await user.click(screen.getByRole('button', { name: 'publisher-publish' }))

      await waitFor(() => {
        expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledWith(true)
      })
      expect(mockPublishWorkflow).not.toHaveBeenCalled()

      resolveDraftSync?.({ hash: 'saved-hash', updatedAt: 2 })

      await waitFor(() => {
        expect(mockPublishWorkflow).toHaveBeenCalled()
      })
    })

    it('should not publish when the draft save barrier fails', async () => {
      const user = userEvent.setup()
      mockHandleSyncWorkflowDraft.mockResolvedValueOnce(null)
      renderWithToast(<FeaturesTrigger />)

      await user.click(screen.getByRole('button', { name: 'publisher-publish' }))

      await waitFor(() => {
        expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledWith(true)
      })
      expect(mockPublishWorkflow).not.toHaveBeenCalled()
    })

    it('should notify error and reject publish when checklist has warning nodes', async () => {
      const user = userEvent.setup()
      mockUseChecklist.mockReturnValue([{ id: 'warning' }])
      renderWithToast(<FeaturesTrigger />)

      await user.click(screen.getByRole('button', { name: 'publisher-publish' }))

      await waitFor(() => {
        expect(toastMocks.call).toHaveBeenCalledWith({
          type: 'error',
          message: 'workflow.panel.checklistTip',
        })
      })
      expect(mockPublishWorkflow).not.toHaveBeenCalled()
    })

    it('should reject publish when checklist before publish fails', async () => {
      const user = userEvent.setup()
      mockHandleCheckBeforePublish.mockResolvedValue(false)
      renderWithToast(<FeaturesTrigger />)

      await user.click(screen.getByRole('button', { name: 'publisher-publish' }))

      await waitFor(() => {
        expect(mockHandleCheckBeforePublish).toHaveBeenCalled()
      })
      expect(mockPublishWorkflow).not.toHaveBeenCalled()
    })

    it('should show an advisory warning when publish reports a skipped branch reference', async () => {
      const user = userEvent.setup()
      mockPublishWorkflow.mockResolvedValueOnce({
        created_at: 1704067200,
        warning: '"Answer" ← "Producer"',
      })
      mockUseNodes.mockReturnValue([{ id: 'start', data: { type: BlockEnum.Start } }])
      mockUseEdges.mockReturnValue([{ source: 'start' }])
      renderWithToast(<FeaturesTrigger />)

      await user.click(screen.getByRole('button', { name: 'publisher-publish' }))

      await waitFor(() => {
        expect(toastMocks.call).toHaveBeenCalledWith({
          type: 'warning',
          message: '"Answer" ← "Producer"',
        })
      })
      // The warning replaces the success message; one publish shows one toast.
      expect(toastMocks.call).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
    })

    it('should publish workflow and update related stores when validation passes', async () => {
      const user = userEvent.setup()
      mockUseNodes.mockReturnValue([{ id: 'start', data: { type: BlockEnum.Start } }])
      mockUseEdges.mockReturnValue([{ source: 'start' }])
      renderWithToast(<FeaturesTrigger />)

      await user.click(screen.getByRole('button', { name: 'publisher-publish' }))

      await waitFor(() => {
        expect(mockPublishWorkflow).toHaveBeenCalledWith('/apps/app-id/workflows/publish', {
          body: { marked_name: '', marked_comment: '' },
        })
        expect(mockUpdatePublishedWorkflow).toHaveBeenCalledWith('app-id')
        expect(mockInvalidateQueries).toHaveBeenCalledWith({
          queryKey: consoleQuery.apps.byAppId.triggers.get.queryKey({
            input: { params: { app_id: 'app-id' } },
          }),
        })
        expect(workflowStore.getState().publishedAt).toBe(1704067200000)
        expect(workflowStore.getState().lastPublishedHasUserInput).toBe(true)
        expect(mockResetWorkflowVersionHistory).toHaveBeenCalled()
        expect(toastMocks.call).toHaveBeenCalledWith({
          type: 'success',
          message: 'common.api.actionSuccess',
        })
        expect(mockInvalidateQueries).toHaveBeenCalledWith({
          queryKey: consoleQuery.apps.byAppId.get.queryKey({
            input: { params: { app_id: 'app-id' } },
          }),
        })
      })
    })

    it('should not show a success toast when the publisher requests a silent publish', async () => {
      const user = userEvent.setup()
      renderWithToast(<FeaturesTrigger />)

      await user.click(screen.getByRole('button', { name: 'publisher-publish-silently' }))

      await waitFor(() => {
        expect(mockPublishWorkflow).toHaveBeenCalled()
      })
      expect(toastMocks.call).not.toHaveBeenCalledWith({
        type: 'success',
        message: 'common.api.actionSuccess',
      })
    })

    it('should invalidate roster list after publishing a workflow with a roster Agent v2 node', async () => {
      const user = userEvent.setup()
      mockUseNodes.mockReturnValue([
        { id: 'start', data: { type: BlockEnum.Start } },
        {
          id: 'agent-v2',
          data: {
            type: BlockEnum.AgentV2,
            version: '2',
            agent_node_kind: 'dify_agent',
            agent_binding: {
              binding_type: 'roster_agent',
              agent_id: 'agent-1',
            },
          },
        },
      ])
      renderWithToast(<FeaturesTrigger />)

      await user.click(screen.getByRole('button', { name: 'publisher-publish' }))

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalledWith({
          queryKey: consoleQuery.agent.get.key(),
        })
        expect(mockInvalidateQueries).toHaveBeenCalledWith({
          queryKey: consoleQuery.agent.byAgentId.referencingWorkflows.get.queryOptions({
            input: {
              params: {
                agent_id: 'agent-1',
              },
            },
          }).queryKey,
        })
      })
    })

    it('should keep roster list cache stable after publishing a workflow without roster Agent v2 nodes', async () => {
      const user = userEvent.setup()
      mockUseNodes.mockReturnValue([
        { id: 'start', data: { type: BlockEnum.Start } },
        {
          id: 'inline-agent-v2',
          data: {
            type: BlockEnum.AgentV2,
            version: '2',
            agent_node_kind: 'dify_agent',
            agent_binding: {
              binding_type: 'inline_agent',
              agent_id: 'agent-1',
              current_snapshot_id: 'snapshot-1',
            },
          },
        },
      ])
      renderWithToast(<FeaturesTrigger />)

      await user.click(screen.getByRole('button', { name: 'publisher-publish' }))

      await waitFor(() => {
        expect(mockPublishWorkflow).toHaveBeenCalled()
      })
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({
        queryKey: consoleQuery.agent.get.key(),
      })
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({
        queryKey: consoleQuery.agent.byAgentId.referencingWorkflows.get.queryOptions({
          input: {
            params: {
              agent_id: 'agent-1',
            },
          },
        }).queryKey,
      })
    })

    it('should respect the publish url passed by the publisher', async () => {
      const user = userEvent.setup()
      renderWithToast(<FeaturesTrigger />)

      await user.click(screen.getByRole('button', { name: 'publisher-publish-custom' }))

      await waitFor(() => {
        expect(mockPublishWorkflow).toHaveBeenCalledWith('/apps/app-id/workflows/publish/custom', {
          body: { marked_name: 'Custom title', marked_comment: 'Custom notes' },
        })
      })
    })

    it('should skip success side effects when publish mutation returns no workflow version', async () => {
      const user = userEvent.setup()
      mockPublishWorkflow.mockResolvedValue(null)
      renderWithToast(<FeaturesTrigger />)

      await user.click(screen.getByRole('button', { name: 'publisher-publish' }))

      await waitFor(() => {
        expect(mockPublishWorkflow).toHaveBeenCalled()
      })
      expect(toastMocks.call).not.toHaveBeenCalledWith({
        type: 'success',
        message: 'common.api.actionSuccess',
      })
      expect(mockUpdatePublishedWorkflow).not.toHaveBeenCalled()
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({
        queryKey: consoleQuery.apps.byAppId.triggers.get.queryKey({
          input: { params: { app_id: 'app-id' } },
        }),
      })
      expect(workflowStore.getState().publishedAt).toBe(0)
      expect(workflowStore.getState().lastPublishedHasUserInput).toBe(false)
      expect(mockResetWorkflowVersionHistory).not.toHaveBeenCalled()
    })
  })
})
