import type { AgentConfigSnapshotSummaryResponse } from '@dify/contracts/api/console/agents/types.gen'
import type { ComponentProps } from 'react'
import type { Mock } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { agentComposerDraftAtom, agentComposerOriginalDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { agentConfigurePromptAtom } from '../../../atoms'
import { defaultAgentConfigureDraft } from '../../../draft'
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

const activeConfigSnapshot: AgentConfigSnapshotSummaryResponse = {
  id: 'snapshot-1',
  agent_id: 'agent-1',
  version: 1,
  created_at: 1710000000,
}

function renderPublishBar({
  activeConfigSnapshot,
  isPublishing,
  onPublish = vi.fn<PublishHandler>(),
  prompt = '',
  setupStore,
}: {
  activeConfigSnapshot?: AgentConfigSnapshotSummaryResponse | null
  isPublishing?: boolean
  onPublish?: PublishMock
  prompt?: string
  setupStore?: (store: ReturnType<typeof createStore>) => void
} = {}) {
  const store = createStore()
  store.set(agentConfigurePromptAtom, prompt)
  setupStore?.(store)

  render(
    <JotaiProvider store={store}>
      <AgentConfigurePublishBar
        agentId="agent-1"
        activeConfigSnapshot={activeConfigSnapshot}
        isPublishing={isPublishing}
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
      expect.objectContaining({ enabled: true, ignoreInputs: true }),
    )
  })

  it('should render published state from the active snapshot and disable publish logic', () => {
    const { onPublish } = renderPublishBar({ activeConfigSnapshot })

    expect(screen.getByText('agentV2.agentDetail.configure.publishBar.upToDate')).toBeInTheDocument()
    expect(screen.getByText(/agentV2\.agentDetail\.configure\.publishBar\.publishedAt/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.publishBar.published' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByText('display:Mod')).not.toBeInTheDocument()
    expect(mockFormatTimeFromNow).toHaveBeenCalledWith(1710000000 * 1000)
    expect(hotkeyRegistrations.get('Mod+Shift+P')?.options).toEqual(
      expect.objectContaining({ enabled: false, ignoreInputs: true }),
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
        store.set(agentComposerOriginalDraftAtom, defaultAgentConfigureDraft)
        store.set(agentComposerDraftAtom, {
          ...defaultAgentConfigureDraft,
          files: [],
        })
      },
    })

    expect(screen.getByText('agentV2.agentDetail.configure.publishBar.unpublishedChanges')).toBeInTheDocument()
  })

  it('should render publishing as a single disabled action state', () => {
    renderPublishBar({ isPublishing: true, prompt: 'Updated system prompt' })

    expect(screen.getByText('agentV2.agentDetail.configure.publishBar.publishing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.publishBar.publishing' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByText('display:Mod')).not.toBeInTheDocument()
    expect(hotkeyRegistrations.get('Mod+Shift+P')?.options).toEqual(
      expect.objectContaining({ enabled: false, ignoreInputs: true }),
    )
  })
})
