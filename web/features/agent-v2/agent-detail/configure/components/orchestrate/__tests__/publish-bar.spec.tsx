import type { AgentConfigSnapshotSummaryResponse, AgentPublishedReferenceResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { ComponentProps } from 'react'
import type { Mock } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
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

vi.mock('@langgenius/dify-ui/popover', async () => {
  const React = await import('react')
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

      return <div data-testid="publish-impact-popover">{children}</div>
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

const publishedReferences: AgentPublishedReferenceResponse[] = [
  {
    app_id: 'app-python',
    app_mode: 'workflow',
    app_name: 'Python bug fixer',
    workflow_id: 'workflow-python',
    workflow_version: '1',
  },
  {
    app_id: 'app-translation',
    app_mode: 'workflow',
    app_name: 'Translation Workflow',
    workflow_id: 'workflow-translation',
    workflow_version: '1',
  },
]

function renderPublishBar({
  activeConfigSnapshot,
  draftSavedAt,
  isPublishing,
  onPublish = vi.fn<PublishHandler>(),
  prompt = '',
  publishedReferenceCount,
  publishedReferences,
  setupStore,
}: {
  activeConfigSnapshot?: AgentConfigSnapshotSummaryResponse | null
  draftSavedAt?: number
  isPublishing?: boolean
  onPublish?: PublishMock
  prompt?: string
  publishedReferenceCount?: number
  publishedReferences?: AgentPublishedReferenceResponse[]
  setupStore?: (store: ReturnType<typeof createStore>) => void
} = {}) {
  const store = createStore()
  store.set(agentComposerPromptAtom, prompt)
  setupStore?.(store)

  render(
    <JotaiProvider store={store}>
      <AgentConfigurePublishBar
        agentId="agent-1"
        activeConfigSnapshot={activeConfigSnapshot}
        draftSavedAt={draftSavedAt}
        agentName="Iris"
        isPublishing={isPublishing}
        publishedReferenceCount={publishedReferenceCount}
        publishedReferences={publishedReferences}
        onPublish={onPublish}
        onOpenVersions={vi.fn()}
      />
    </JotaiProvider>,
  )

  return {
    onPublish,
  }
}

describe('AgentConfigurePublishBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hotkeyRegistrations.clear()
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
    const { onPublish } = renderPublishBar({ activeConfigSnapshot })

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

  it('should publish the current draft payload from the unpublished changes state', () => {
    const { onPublish } = renderPublishBar({
      activeConfigSnapshot,
      prompt: 'Updated system prompt',
    })

    expect(screen.getByText('agentV2.agentDetail.configure.publishBar.unpublishedChanges')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/ }))

    expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
      agent_id: 'agent-1',
      config_snapshot: expect.objectContaining({
        prompt: expect.objectContaining({
          system_prompt: 'Updated system prompt',
        }),
      }),
    }))
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

  it('should show affected workflow references when clicking a publishable agent in use', () => {
    const { onPublish } = renderPublishBar({
      activeConfigSnapshot,
      prompt: 'Updated system prompt',
      publishedReferenceCount: 2,
      publishedReferences,
    })

    expect(screen.queryByTestId('publish-impact-popover')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/ }))

    expect(onPublish).not.toHaveBeenCalled()
    expect(screen.getByTestId('publish-impact-popover')).toBeInTheDocument()
    expect(screen.getByText(/agentV2\.agentDetail\.configure\.publishImpact\.title/)).toBeInTheDocument()
    expect(screen.getByText(/agentV2\.agentDetail\.configure\.publishImpact\.descriptionPrefix/)).toBeInTheDocument()
    expect(screen.getByText(/agentV2\.agentDetail\.configure\.publishImpact\.workflowCount/)).toBeInTheDocument()
    expect(screen.getByText('Python bug fixer')).toBeInTheDocument()
    expect(screen.getByText('Translation Workflow')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Python bug fixer' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Python bug fixer' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('should publish from the affected workflow popover action', () => {
    const { onPublish } = renderPublishBar({
      activeConfigSnapshot,
      prompt: 'Updated system prompt',
      publishedReferenceCount: 2,
      publishedReferences,
    })

    fireEvent.click(screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/ }))
    fireEvent.click(within(screen.getByTestId('publish-impact-popover')).getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.publishBar\.publishUpdate/,
    }))

    expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
      agent_id: 'agent-1',
    }))
  })
})
