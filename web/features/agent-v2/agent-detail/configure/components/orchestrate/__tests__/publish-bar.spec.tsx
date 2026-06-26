import type { AgentConfigSnapshotSummaryResponse, AgentReferencingWorkflowResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { ComponentProps } from 'react'
import type { Mock } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { agentComposerDraftAtom, agentComposerOriginalDraftAtom, agentComposerPublishedDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import { AgentConfigurePublishBar } from '../publish-bar'

type PublishHandler = NonNullable<ComponentProps<typeof AgentConfigurePublishBar>['onPublish']>
type PublishMock = Mock<PublishHandler>

const hotkeyRegistrations = vi.hoisted(() => new Map<string, {
  callback: (event: { preventDefault: () => void }) => void
  options?: { enabled?: boolean, ignoreInputs?: boolean }
}>())

const mockFormatForDisplay = vi.hoisted(() => vi.fn((hotkey: string) => `display:${hotkey}`))
const mockFormatTimeFromNow = vi.hoisted(() => vi.fn(() => 'just now'))
const workflowReferences = vi.hoisted(() => ({
  data: [] as AgentReferencingWorkflowResponse[],
}))

vi.mock('@tanstack/react-hotkeys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-hotkeys')>()
  return {
    ...actual,
    formatForDisplay: mockFormatForDisplay,
    useHotkey: (hotkey: string, callback: (event: { preventDefault: () => void }) => void, options?: { enabled?: boolean, ignoreInputs?: boolean }) => {
      hotkeyRegistrations.set(hotkey, { callback, options })
    },
  }
})

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: mockFormatTimeFromNow,
  }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        referencingWorkflows: {
          get: {
            queryOptions: ({ input }: { input: { params: { agent_id: string } } }) => ({
              queryKey: ['agent-referencing-workflows', input],
              queryFn: async () => ({
                data: workflowReferences.data,
              }),
            }),
          },
        },
      },
    },
  },
}))

vi.mock('@langgenius/dify-ui/popover', async () => {
  const React = await import('react')
  const ReactDOM = await import('react-dom')
  const PopoverContext = React.createContext<{
    open: boolean
    onOpenChange?: (open: boolean) => void
  }>({
    open: false,
  })

  return {
    Popover: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) => (
      <PopoverContext value={{ open: !!open, onOpenChange }}>
        {children}
      </PopoverContext>
    ),
    PopoverContent: ({
      children,
    }: {
      children: React.ReactNode
    }) => {
      const context = React.use(PopoverContext)
      if (!context.open)
        return null

      return ReactDOM.createPortal(<div data-testid="publish-impact-popover">{children}</div>, document.body)
    },
    PopoverTrigger: ({
      render: trigger,
    }: {
      render: React.ReactElement
    }) => trigger,
  }
})

const activeConfigSnapshot: AgentConfigSnapshotSummaryResponse = {
  id: 'snapshot-1',
  agent_id: 'agent-1',
  version: 1,
  created_at: 1710000000,
}

const originalDraftWithFile = {
  ...defaultAgentSoulConfigFormState,
  files: [
    {
      id: 'preview-image',
      name: 'agent-roster-skill-detail-dialog-preview-image.png',
      icon: 'image',
    },
  ],
} satisfies typeof defaultAgentSoulConfigFormState

const publishedReferences: AgentReferencingWorkflowResponse[] = [
  {
    app_id: 'app-python',
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
    workflow_id: 'workflow-translation',
    workflow_version: '1',
    node_ids: ['node-translation'],
  },
]

function renderPublishBar({
  activeConfigIsPublished,
  activeConfigSnapshot,
  draftSavedAt,
  isPublishing,
  onPublish = vi.fn<PublishHandler>(),
  prompt = '',
  setupStore,
  usedByAppReferences = [],
}: {
  activeConfigIsPublished?: boolean
  activeConfigSnapshot?: AgentConfigSnapshotSummaryResponse | null
  draftSavedAt?: number
  isPublishing?: boolean
  onPublish?: PublishMock
  prompt?: string
  setupStore?: (store: ReturnType<typeof createStore>) => void
  usedByAppReferences?: AgentReferencingWorkflowResponse[]
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

  render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <AgentConfigurePublishBar
          agentId="agent-1"
          activeConfigIsPublished={activeConfigIsPublished}
          activeConfigSnapshot={activeConfigSnapshot}
          draftSavedAt={draftSavedAt}
          agentName="Iris"
          isPublishing={isPublishing}
          onPublish={onPublish}
          onOpenVersions={vi.fn()}
        />
      </JotaiProvider>
    </QueryClientProvider>,
  )

  return {
    onPublish,
  }
}

describe('AgentConfigurePublishBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hotkeyRegistrations.clear()
    workflowReferences.data = []
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should render draft state with a formatted publish shortcut', () => {
    renderPublishBar()

    expect(screen.getByText('agentV2.agentDetail.configure.publishBar.draft')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.configure.publishBar.saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /agentV2\.agentDetail\.publish/ })).toBeInTheDocument()
    expect(screen.getByText('display:Mod')).toBeInTheDocument()
    expect(screen.getByText('display:Shift')).toBeInTheDocument()
    expect(screen.getByText('display:P')).toBeInTheDocument()
    expect(mockFormatForDisplay).toHaveBeenCalledWith('Mod')
    expect(hotkeyRegistrations.get('Mod+Shift+P')?.options).toEqual(
      expect.objectContaining({ enabled: true, ignoreInputs: false }),
    )
  })

  it('should render saved time from the latest draft save timestamp', () => {
    renderPublishBar({ draftSavedAt: 1710000100000 })

    expect(screen.getByText(/agentV2\.agentDetail\.configure\.publishBar\.savedAt/)).toBeInTheDocument()
    expect(mockFormatTimeFromNow).toHaveBeenCalledWith(1710000100000)
  })

  it('should render published state from the active snapshot and disable publish logic', () => {
    const { onPublish } = renderPublishBar({
      activeConfigIsPublished: true,
      activeConfigSnapshot,
    })

    expect(screen.getByText('agentV2.agentDetail.configure.publishBar.upToDate')).toBeInTheDocument()
    expect(screen.getByText(/agentV2\.agentDetail\.configure\.publishBar\.publishedAt/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.publishBar.published' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByText('display:Mod')).not.toBeInTheDocument()
    expect(mockFormatTimeFromNow).toHaveBeenCalledWith(1710000000 * 1000)
    expect(hotkeyRegistrations.get('Mod+Shift+P')?.options).toEqual(
      expect.objectContaining({ enabled: false, ignoreInputs: false }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.publishBar.published' }))

    expect(onPublish).not.toHaveBeenCalled()
  })

  it('should initialize unpublished state when active config is not published', async () => {
    const { onPublish } = renderPublishBar({
      activeConfigIsPublished: false,
      activeConfigSnapshot,
    })

    expect(screen.getByText('agentV2.agentDetail.configure.publishBar.unpublishedChanges')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/ })).toBeInTheDocument()
    expect(hotkeyRegistrations.get('Mod+Shift+P')?.options).toEqual(
      expect.objectContaining({ enabled: true, ignoreInputs: false }),
    )

    fireEvent.click(screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/ }))

    await waitFor(() => {
      expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
        agent_id: 'agent-1',
      }))
    })
  })

  it('should publish the current draft payload from the unpublished changes state', async () => {
    const { onPublish } = renderPublishBar({
      activeConfigSnapshot,
      prompt: 'Updated system prompt',
    })

    expect(screen.getByText('agentV2.agentDetail.configure.publishBar.unpublishedChanges')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/ }))

    await waitFor(() => {
      expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
        agent_id: 'agent-1',
        config_snapshot: expect.objectContaining({
          prompt: expect.objectContaining({
            system_prompt: 'Updated system prompt',
          }),
        }),
      }))
    })
  })

  it('should mark non-prompt draft changes as unpublished', () => {
    renderPublishBar({
      activeConfigSnapshot,
      setupStore: (store) => {
        store.set(agentComposerPublishedDraftAtom, originalDraftWithFile)
        store.set(agentComposerOriginalDraftAtom, originalDraftWithFile)
        store.set(agentComposerDraftAtom, {
          ...originalDraftWithFile,
          files: [],
        })
      },
    })

    expect(screen.getByText('agentV2.agentDetail.configure.publishBar.unpublishedChanges')).toBeInTheDocument()
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

    expect(screen.getByText('agentV2.agentDetail.configure.publishBar.unpublishedChanges')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/ })).toBeInTheDocument()
  })

  it('should render publishing as a single disabled action state', () => {
    renderPublishBar({ isPublishing: true, prompt: 'Updated system prompt' })

    expect(screen.getByText('agentV2.agentDetail.configure.publishBar.publishing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.publishBar.publishing' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByText('display:Mod')).not.toBeInTheDocument()
    expect(hotkeyRegistrations.get('Mod+Shift+P')?.options).toEqual(
      expect.objectContaining({ enabled: false, ignoreInputs: false }),
    )
  })

  it('should show affected workflow references when clicking a publishable agent in use', async () => {
    const { onPublish } = renderPublishBar({
      activeConfigSnapshot,
      prompt: 'Updated system prompt',
      usedByAppReferences: publishedReferences,
    })

    expect(screen.queryByTestId('publish-impact-popover')).not.toBeInTheDocument()
    const publishBar = screen.getByText('agentV2.agentDetail.configure.publishBar.unpublishedChanges').closest('[aria-hidden]')
    expect(publishBar).toHaveAttribute('aria-hidden', 'false')

    fireEvent.click(screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/ }))

    expect(onPublish).not.toHaveBeenCalled()
    const impactPopover = await screen.findByTestId('publish-impact-popover')
    expect(impactPopover).toBeInTheDocument()
    expect(publishBar).toHaveAttribute('aria-hidden', 'false')
    await waitFor(() => {
      expect(publishBar).toHaveAttribute('aria-hidden', 'true')
      expect(publishBar).toHaveClass('opacity-0')
    })
    expect(screen.getByText(/agentV2\.agentDetail\.configure\.publishImpact\.title/)).toBeInTheDocument()
    expect(screen.getByText(/agentV2\.agentDetail\.configure\.publishImpact\.descriptionPrefix/)).toBeInTheDocument()
    expect(screen.getByText(/agentV2\.agentDetail\.configure\.publishImpact\.workflowCount/)).toBeInTheDocument()
    expect(screen.getByText('Python bug fixer')).toBeInTheDocument()
    expect(screen.getByText('Translation Workflow')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Python bug fixer' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Python bug fixer' })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(impactPopover).getByText('display:Mod')).toBeInTheDocument()
    expect(within(impactPopover).getByText('display:Shift')).toBeInTheDocument()
    expect(within(impactPopover).getByText('display:P')).toBeInTheDocument()
  })

  it('should publish from the affected workflow popover action', async () => {
    const { onPublish } = renderPublishBar({
      activeConfigSnapshot,
      prompt: 'Updated system prompt',
      usedByAppReferences: publishedReferences,
    })

    fireEvent.click(screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/ }))
    fireEvent.click(within(await screen.findByTestId('publish-impact-popover')).getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/,
    }))

    expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
      agent_id: 'agent-1',
    }))
  })

  it('should open the affected workflow popover from the publish shortcut before publishing', async () => {
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
    expect(await screen.findByTestId('publish-impact-popover')).toBeInTheDocument()

    await act(async () => {
      await hotkeyRegistrations.get('Mod+Shift+P')?.callback({ preventDefault: vi.fn() })
    })

    expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
      agent_id: 'agent-1',
    }))
  })
})
