import type {
  AgentConfigSnapshotSummaryResponse,
  AgentReferencingWorkflowResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { ComponentProps } from 'react'
import type { Mock } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import {
  agentComposerDraftAtom,
  agentComposerOriginalDraftAtom,
  agentComposerPublishedDraftAtom,
} from '@/features/agent-v2/agent-composer/store'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import { AgentConfigurePublishBar } from '../publish-bar'

type PublishHandler = NonNullable<ComponentProps<typeof AgentConfigurePublishBar>['onPublish']>
type PublishMock = Mock<PublishHandler>

const hotkeyRegistrations = vi.hoisted(
  () =>
    new Map<
      string,
      {
        callback: (event: { preventDefault: () => void }) => void
        options?: { enabled?: boolean; ignoreInputs?: boolean }
      }
    >(),
)

const mockFormatForDisplay = vi.hoisted(() => vi.fn((hotkey: string) => `display:${hotkey}`))
const mockFormatTimeFromNow = vi.hoisted(() => vi.fn(() => 'just now'))
const mockFormatTime = vi.hoisted(() => vi.fn((timestamp: number) => `formatted:${timestamp}`))
const restoreVersionMutation = vi.hoisted(() =>
  vi.fn(async (_input: unknown) => ({
    active_config_snapshot_id: 'snapshot-2',
    result: 'success',
  })),
)
const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))
const workflowReferences = vi.hoisted(() => ({
  fetchCount: 0,
  data: [] as AgentReferencingWorkflowResponse[],
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMock,
}))

vi.mock('@tanstack/react-hotkeys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-hotkeys')>()
  return {
    ...actual,
    formatForDisplay: mockFormatForDisplay,
    useHotkey: (
      hotkey: string,
      callback: (event: { preventDefault: () => void }) => void,
      options?: { enabled?: boolean; ignoreInputs?: boolean },
    ) => {
      hotkeyRegistrations.set(hotkey, { callback, options })
    },
  }
})

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: mockFormatTimeFromNow,
  }),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: mockFormatTime,
  }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        get: {
          queryKey: ({ input }: { input: { params: { agent_id: string } } }) => ['agent', input],
        },
        composer: {
          get: {
            queryKey: ({ input }: { input: { params: { agent_id: string } } }) => [
              'agent-composer',
              input,
            ],
          },
        },
        referencingWorkflows: {
          get: {
            queryOptions: ({
              enabled = true,
              input,
            }: {
              enabled?: boolean
              input: { params: { agent_id: string } }
            }) => ({
              queryKey: ['agent-referencing-workflows', input],
              enabled,
              queryFn: async () => ({
                data: (workflowReferences.fetchCount++, workflowReferences.data),
              }),
            }),
          },
        },
        versions: {
          byVersionId: {
            restore: {
              post: {
                mutationOptions: () => ({ mutationFn: restoreVersionMutation }),
              },
            },
          },
          get: {
            key: () => ['agent-versions'],
          },
        },
      },
    },
  },
}))

const activeConfigSnapshot: AgentConfigSnapshotSummaryResponse = {
  id: 'snapshot-1',
  agent_id: 'agent-1',
  version: 1,
  created_at: 1710000000,
}

const originalDraftWithFile = {
  ...defaultAgentSoulConfigFormState,
  tools: [
    {
      id: 'cli-1',
      kind: 'cli',
      name: 'Run tests',
      installCommand: 'pnpm test',
    },
  ],
} satisfies typeof defaultAgentSoulConfigFormState

const publishedReferences: AgentReferencingWorkflowResponse[] = [
  {
    app_id: 'app-python',
    app_updated_at: 1710000100,
    app_mode: 'workflow',
    app_name: 'Python bug fixer',
    workflow_id: 'workflow-python',
    workflow_version: '1',
    node_ids: ['node-python'],
  },
  {
    app_id: 'app-translation',
    app_icon: 'T',
    app_icon_background: '#E0F2FE',
    app_icon_type: 'emoji',
    app_mode: 'workflow',
    app_name: 'Translation Workflow',
    app_updated_at: 1710000200,
    workflow_id: 'workflow-translation',
    workflow_version: '1',
    node_ids: ['node-translation'],
  },
]

function createDeferredPromise() {
  let resolve!: () => void
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

function renderPublishBar({
  activeConfigIsPublished,
  activeConfigSnapshot,
  draftSavedAt,
  isPublishing,
  onPublish = vi.fn<PublishHandler>(),
  onExitVersions = vi.fn(),
  onVersionRestored = vi.fn(),
  prompt = '',
  selectedVersionSnapshot,
  setupStore,
  usedByAppReferences = [],
  workflowReferencesEnabled,
}: {
  activeConfigIsPublished?: boolean
  activeConfigSnapshot?: AgentConfigSnapshotSummaryResponse | null
  draftSavedAt?: number
  isPublishing?: boolean
  onPublish?: PublishMock
  onExitVersions?: Mock<() => void>
  onVersionRestored?: Mock<() => void | Promise<void>>
  prompt?: string
  selectedVersionSnapshot?: AgentConfigSnapshotSummaryResponse | null
  setupStore?: (store: ReturnType<typeof createStore>) => void
  usedByAppReferences?: AgentReferencingWorkflowResponse[]
  workflowReferencesEnabled?: boolean
} = {}) {
  workflowReferences.data = usedByAppReferences
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const store = createStore()
  store.set(agentComposerPromptAtom, prompt)
  setupStore?.(store)

  const renderPublishBarTree = (nextProps?: {
    activeConfigIsPublished?: boolean
    activeConfigSnapshot?: AgentConfigSnapshotSummaryResponse | null
    isPublishing?: boolean
  }) => (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <AgentConfigurePublishBar
          agentId="agent-1"
          activeConfigIsPublished={
            nextProps && 'activeConfigIsPublished' in nextProps
              ? nextProps.activeConfigIsPublished
              : activeConfigIsPublished
          }
          activeConfigSnapshot={
            nextProps && 'activeConfigSnapshot' in nextProps
              ? nextProps.activeConfigSnapshot
              : activeConfigSnapshot
          }
          draftSavedAt={draftSavedAt}
          agentName="Iris"
          isPublishing={nextProps?.isPublishing ?? isPublishing}
          selectedVersionSnapshot={selectedVersionSnapshot}
          workflowReferencesEnabled={workflowReferencesEnabled}
          onPublish={onPublish}
          onExitVersions={onExitVersions}
          onOpenVersions={vi.fn()}
          onVersionRestored={onVersionRestored}
        />
      </JotaiProvider>
    </QueryClientProvider>
  )
  const view = render(renderPublishBarTree())

  return {
    ...view,
    queryClient,
    onExitVersions,
    onPublish,
    onVersionRestored,
    rerenderPublishBar: renderPublishBarTree,
  }
}

describe('AgentConfigurePublishBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hotkeyRegistrations.clear()
    restoreVersionMutation.mockResolvedValue({
      active_config_snapshot_id: 'snapshot-2',
      result: 'success',
    })
    workflowReferences.data = []
    workflowReferences.fetchCount = 0
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should render draft state with a formatted publish shortcut', () => {
    renderPublishBar()

    expect(screen.getByText('agentV2.agentDetail.configure.publishBar.draft')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.configure.publishBar.saved')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /agentV2\.agentDetail\.publish/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('display:Mod')).toBeInTheDocument()
    expect(screen.getByText('display:Shift')).toBeInTheDocument()
    expect(screen.getByText('display:P')).toBeInTheDocument()
    expect(mockFormatForDisplay).toHaveBeenCalledWith('Mod')
    expect(hotkeyRegistrations.get('Mod+Shift+P')?.options).toEqual(
      expect.objectContaining({ enabled: true, ignoreInputs: false }),
    )
  })

  it('should allow publish request when knowledge retrieval validation fails', async () => {
    const { onPublish } = renderPublishBar({
      setupStore: (store) => {
        store.set(agentComposerDraftAtom, {
          ...defaultAgentSoulConfigFormState,
          knowledgeRetrievals: [
            {
              id: 'retrieval-1',
              name: 'Docs Search',
              datasetRefs: [],
            },
          ],
        })
      },
    })

    expect(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/,
      }),
    ).toBeEnabled()
    expect(
      screen.queryByText(
        'common.errorMsg.fieldRequired:{"field":"agentV2.agentDetail.configure.knowledgeRetrieval.dialog.knowledge.label"}',
      ),
    ).not.toBeInTheDocument()
    expect(hotkeyRegistrations.get('Mod+Shift+P')?.options).toEqual(
      expect.objectContaining({ enabled: true, ignoreInputs: false }),
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/,
      }),
    )

    await waitFor(() => {
      expect(onPublish).toHaveBeenCalledTimes(1)
    })
  })

  it('should restore the selected version from view-only mode', async () => {
    const selectedVersionSnapshot = {
      ...activeConfigSnapshot,
      id: 'snapshot-2',
      version: 2,
      version_note: 'Stable version',
      created_by: 'Alice',
    }

    const onVersionRestored = vi.fn().mockResolvedValue(undefined)
    const { onExitVersions } = renderPublishBar({
      onVersionRestored,
      selectedVersionSnapshot,
    })

    expect(screen.getByText('Stable version')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.versionHistory.viewOnly')).toBeInTheDocument()
    expect(screen.getByText('formatted:1710000000 · Alice')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'agentV2.agentDetail.versionHistory.restore' }),
    )

    await waitFor(() => {
      expect(restoreVersionMutation).toHaveBeenCalled()
    })
    expect(restoreVersionMutation.mock.calls[0]?.[0]).toEqual({
      params: {
        agent_id: 'agent-1',
        version_id: 'snapshot-2',
      },
    })
    await waitFor(() => expect(onVersionRestored).toHaveBeenCalled())
    expect(onVersionRestored.mock.invocationCallOrder[0]).toBeLessThan(
      onExitVersions.mock.invocationCallOrder[0]!,
    )
    expect(toastMock.success).toHaveBeenCalledWith('common.api.actionSuccess')
  })

  it('should render saved time from the latest draft save timestamp', () => {
    renderPublishBar({ draftSavedAt: 1710000100000 })

    expect(
      screen.getByText(/agentV2\.agentDetail\.configure\.publishBar\.savedAt/),
    ).toBeInTheDocument()
    expect(mockFormatTimeFromNow).toHaveBeenCalledWith(1710000100000)
  })

  it('should render published state from the active snapshot and disable publish logic', () => {
    const { onPublish } = renderPublishBar({
      activeConfigIsPublished: true,
      activeConfigSnapshot,
    })

    expect(
      screen.getByText('agentV2.agentDetail.configure.publishBar.upToDate'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/agentV2\.agentDetail\.configure\.publishBar\.publishedAt/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'agentV2.agentDetail.configure.publishBar.published' }),
    ).toBeDisabled()
    expect(screen.queryByText('display:Mod')).not.toBeInTheDocument()
    expect(mockFormatTimeFromNow).toHaveBeenCalledWith(1710000000 * 1000)
    expect(hotkeyRegistrations.get('Mod+Shift+P')?.options).toEqual(
      expect.objectContaining({ enabled: false, ignoreInputs: false }),
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'agentV2.agentDetail.configure.publishBar.published' }),
    )

    expect(onPublish).not.toHaveBeenCalled()
  })

  it('should keep published state when the published detail updates before the active snapshot is refreshed', () => {
    const { rerender, rerenderPublishBar } = renderPublishBar({
      activeConfigIsPublished: true,
      activeConfigSnapshot: null,
    })

    rerender(
      rerenderPublishBar({
        activeConfigIsPublished: undefined,
        activeConfigSnapshot: undefined,
      }),
    )

    expect(
      screen.getByText('agentV2.agentDetail.configure.publishBar.upToDate'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'agentV2.agentDetail.configure.publishBar.published' }),
    ).toBeDisabled()
    expect(hotkeyRegistrations.get('Mod+Shift+P')?.options).toEqual(
      expect.objectContaining({ enabled: false, ignoreInputs: false }),
    )
  })

  it('should show unpublished state from local draft changes even when active config is published', () => {
    renderPublishBar({
      activeConfigIsPublished: true,
      activeConfigSnapshot: null,
      prompt: 'Updated system prompt',
    })

    expect(
      screen.getByText('agentV2.agentDetail.configure.publishBar.unpublishedChanges'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/,
      }),
    ).toBeInTheDocument()
    expect(hotkeyRegistrations.get('Mod+Shift+P')?.options).toEqual(
      expect.objectContaining({ enabled: true, ignoreInputs: false }),
    )
  })

  it('should initialize unpublished state when active config is not published', async () => {
    const { onPublish } = renderPublishBar({
      activeConfigIsPublished: false,
      activeConfigSnapshot,
    })

    expect(
      screen.getByText('agentV2.agentDetail.configure.publishBar.unpublishedChanges'),
    ).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.configure.publishBar.saved')).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/,
      }),
    ).toBeInTheDocument()
    expect(hotkeyRegistrations.get('Mod+Shift+P')?.options).toEqual(
      expect.objectContaining({ enabled: true, ignoreInputs: false }),
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/,
      }),
    )

    await waitFor(() => {
      expect(onPublish).toHaveBeenCalledTimes(1)
    })
    expect(
      screen.queryByRole('region', {
        name: /agentV2\.agentDetail\.configure\.publishImpact\.title/,
      }),
    ).not.toBeInTheDocument()
  })

  it('should publish the current draft payload from the unpublished changes state', async () => {
    const { onPublish } = renderPublishBar({
      activeConfigSnapshot,
      prompt: 'Updated system prompt',
    })

    expect(
      screen.getByText('agentV2.agentDetail.configure.publishBar.unpublishedChanges'),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/,
      }),
    )

    await waitFor(() => {
      expect(onPublish).toHaveBeenCalledTimes(1)
    })
  })

  it('should publish without loading workflow references when references are disabled', async () => {
    const { onPublish } = renderPublishBar({
      activeConfigSnapshot,
      prompt: 'Updated system prompt',
      usedByAppReferences: publishedReferences,
      workflowReferencesEnabled: false,
    })

    await waitFor(() => {
      expect(workflowReferences.fetchCount).toBe(0)
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/,
      }),
    )

    await waitFor(() => {
      expect(onPublish).toHaveBeenCalledTimes(1)
    })
    expect(workflowReferences.fetchCount).toBe(0)
    expect(
      screen.queryByRole('region', {
        name: /agentV2\.agentDetail\.configure\.publishImpact\.title/,
      }),
    ).not.toBeInTheDocument()
  })

  it('should mark non-prompt draft changes as unpublished', () => {
    renderPublishBar({
      activeConfigSnapshot,
      setupStore: (store) => {
        store.set(agentComposerPublishedDraftAtom, originalDraftWithFile)
        store.set(agentComposerOriginalDraftAtom, originalDraftWithFile)
        store.set(agentComposerDraftAtom, {
          ...originalDraftWithFile,
          tools: [],
        })
      },
    })

    expect(
      screen.getByText('agentV2.agentDetail.configure.publishBar.unpublishedChanges'),
    ).toBeInTheDocument()
  })

  it('should keep unpublished state after draft autosave updates the saved draft baseline', () => {
    const publishedDraft = {
      ...defaultAgentSoulConfigFormState,
      prompt: 'Published prompt',
    }
    const savedDraft = {
      ...defaultAgentSoulConfigFormState,
      prompt: 'Autosaved draft prompt',
    }

    renderPublishBar({
      activeConfigSnapshot,
      setupStore: (store) => {
        store.set(agentComposerPublishedDraftAtom, publishedDraft)
        store.set(agentComposerOriginalDraftAtom, savedDraft)
        store.set(agentComposerDraftAtom, savedDraft)
      },
    })

    expect(
      screen.getByText('agentV2.agentDetail.configure.publishBar.unpublishedChanges'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/,
      }),
    ).toBeInTheDocument()
  })

  it('should trust backend published state after autosave confirms the draft matches the active snapshot', () => {
    const stalePublishedDraftBaseline = {
      ...defaultAgentSoulConfigFormState,
      prompt: 'Old unpublished normal draft',
    }
    const savedDraftMatchingActiveSnapshot = {
      ...defaultAgentSoulConfigFormState,
      prompt: 'Published prompt',
    }

    renderPublishBar({
      activeConfigIsPublished: true,
      activeConfigSnapshot,
      setupStore: (store) => {
        store.set(agentComposerPublishedDraftAtom, stalePublishedDraftBaseline)
        store.set(agentComposerOriginalDraftAtom, savedDraftMatchingActiveSnapshot)
        store.set(agentComposerDraftAtom, savedDraftMatchingActiveSnapshot)
      },
    })

    expect(
      screen.getByText('agentV2.agentDetail.configure.publishBar.upToDate'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'agentV2.agentDetail.configure.publishBar.published' }),
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', {
        name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/,
      }),
    ).not.toBeInTheDocument()
  })

  it('should render publishing as a single disabled action state', () => {
    renderPublishBar({ isPublishing: true, prompt: 'Updated system prompt' })

    expect(
      screen.getByText('agentV2.agentDetail.configure.publishBar.publishing'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'agentV2.agentDetail.configure.publishBar.publishing' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('button', { name: 'agentV2.agentDetail.configure.publishBar.publishing' }),
    ).not.toHaveAttribute('aria-busy')
    expect(screen.queryByText('display:Mod')).not.toBeInTheDocument()
    expect(hotkeyRegistrations.get('Mod+Shift+P')?.options).toEqual(
      expect.objectContaining({ enabled: false, ignoreInputs: false }),
    )
  })

  it('should expand affected workflow details above the publish toolbar when clicking a publishable agent in use', async () => {
    const { onPublish } = renderPublishBar({
      activeConfigSnapshot,
      prompt: 'Updated system prompt',
      usedByAppReferences: publishedReferences,
    })

    expect(
      screen.queryByRole('region', {
        name: /agentV2\.agentDetail\.configure\.publishImpact\.title/,
      }),
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(workflowReferences.fetchCount).toBe(1)
    })

    const publishButton = screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/,
    })
    fireEvent.click(publishButton)

    expect(onPublish).not.toHaveBeenCalled()
    expect(publishButton).not.toHaveAttribute('aria-busy')
    const impactDetails = await screen.findByRole('region', {
      name: /agentV2\.agentDetail\.configure\.publishImpact\.title/,
    })
    expect(impactDetails).toBeInTheDocument()
    expect(workflowReferences.fetchCount).toBe(1)
    expect(
      screen.getAllByRole('button', {
        name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/,
      }),
    ).toHaveLength(1)
    expect(
      screen.getByRole('button', { name: 'agentV2.agentDetail.configure.publishImpact.cancel' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.publishBar.versionHistory',
      }),
    ).toHaveClass('group-data-open/publish-bar:hidden')
    expect(
      screen.getByText(/agentV2\.agentDetail\.configure\.publishImpact\.title/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/agentV2\.agentDetail\.configure\.publishImpact\.descriptionPrefix/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/agentV2\.agentDetail\.configure\.publishImpact\.workflowCount/),
    ).toBeInTheDocument()
    expect(screen.getByText('Python bug fixer')).toBeInTheDocument()
    expect(screen.getByText('Translation Workflow')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Python bug fixer/ })).toHaveAttribute(
      'target',
      '_blank',
    )
    expect(screen.getByRole('link', { name: /Python bug fixer/ })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    )
    expect(within(impactDetails).getAllByText('just now')).toHaveLength(2)
    expect(screen.getByText('display:Mod')).toBeInTheDocument()
    expect(screen.getByText('display:Shift')).toBeInTheDocument()
    expect(screen.getByText('display:P')).toBeInTheDocument()
  })

  it('should publish from the fixed toolbar action after affected workflow details expand', async () => {
    const publishDeferred = createDeferredPromise()
    const onPublish = vi.fn<PublishHandler>(() => publishDeferred.promise)
    const { rerender, rerenderPublishBar } = renderPublishBar({
      activeConfigSnapshot,
      onPublish,
      prompt: 'Updated system prompt',
      usedByAppReferences: publishedReferences,
    })

    fireEvent.click(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/,
      }),
    )
    expect(
      await screen.findByRole('region', {
        name: /agentV2\.agentDetail\.configure\.publishImpact\.title/,
      }),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/,
      }),
    )

    expect(onPublish).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('region', {
        name: /agentV2\.agentDetail\.configure\.publishImpact\.title/,
      }),
    ).toBeInTheDocument()
    rerender(rerenderPublishBar({ isPublishing: true }))
    expect(
      await screen.findByRole('button', {
        name: 'agentV2.agentDetail.configure.publishBar.publishing',
      }),
    ).not.toHaveAttribute('aria-busy')

    await act(async () => {
      publishDeferred.resolve()
      await publishDeferred.promise
    })

    await waitFor(() => {
      expect(
        screen.queryByRole('region', {
          name: /agentV2\.agentDetail\.configure\.publishImpact\.title/,
        }),
      ).not.toBeInTheDocument()
    })
  })

  it('should collapse affected workflow details from the expanded footer cancel action', async () => {
    const { onPublish } = renderPublishBar({
      activeConfigSnapshot,
      prompt: 'Updated system prompt',
      usedByAppReferences: publishedReferences,
    })

    fireEvent.click(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/,
      }),
    )
    expect(
      await screen.findByRole('region', {
        name: /agentV2\.agentDetail\.configure\.publishImpact\.title/,
      }),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'agentV2.agentDetail.configure.publishImpact.cancel' }),
    )

    await waitFor(() => {
      expect(
        screen.queryByRole('region', {
          name: /agentV2\.agentDetail\.configure\.publishImpact\.title/,
        }),
      ).not.toBeInTheDocument()
    })
    expect(onPublish).not.toHaveBeenCalled()
  })

  it('should show affected workflow details from the publish shortcut before publishing', async () => {
    const { onPublish } = renderPublishBar({
      activeConfigSnapshot,
      prompt: 'Updated system prompt',
      usedByAppReferences: publishedReferences,
    })
    const publishShortcut = hotkeyRegistrations.get('Mod+Shift+P')

    await act(async () => {
      await publishShortcut?.callback({ preventDefault: vi.fn() })
    })

    expect(onPublish).not.toHaveBeenCalled()
    expect(
      await screen.findByRole('region', {
        name: /agentV2\.agentDetail\.configure\.publishImpact\.title/,
      }),
    ).toBeInTheDocument()

    await act(async () => {
      await hotkeyRegistrations.get('Mod+Shift+P')?.callback({ preventDefault: vi.fn() })
    })

    expect(onPublish).toHaveBeenCalledTimes(1)
  })

  it('should publish directly from the publish shortcut when no workflows reference the agent', async () => {
    const { onPublish } = renderPublishBar({
      activeConfigSnapshot,
      prompt: 'Updated system prompt',
    })
    const publishShortcut = hotkeyRegistrations.get('Mod+Shift+P')

    await act(async () => {
      await publishShortcut?.callback({ preventDefault: vi.fn() })
    })

    expect(
      screen.queryByRole('region', {
        name: /agentV2\.agentDetail\.configure\.publishImpact\.title/,
      }),
    ).not.toBeInTheDocument()
    expect(onPublish).toHaveBeenCalledTimes(1)
  })
})
