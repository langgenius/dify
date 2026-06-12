import type { ReactNode } from 'react'
import type { PromptEditorProps } from '@/app/components/base/prompt-editor'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { agentComposerDraftAtom, agentComposerPromptAtom, defaultAgentComposerDraft } from '@/features/agent-v2/agent-composer/store'
import { AgentPromptEditor } from '../orchestrate/prompt-editor'

const mockPromptEditor = vi.hoisted(() => vi.fn())
const mockCopy = vi.hoisted(() => vi.fn())
const mockReset = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/base/prompt-editor', () => ({
  __esModule: true,
  default: (props: PromptEditorProps) => {
    mockPromptEditor(props)

    return (
      <div>
        <div role="textbox" aria-label={String(props.placeholder)} />
      </div>
    )
  },
}))

vi.mock('@/app/components/base/infotip', () => ({
  Infotip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

vi.mock('foxact/use-clipboard', () => ({
  useClipboard: () => ({
    copied: false,
    copy: mockCopy,
    reset: mockReset,
  }),
}))

const promptEditorDraft = {
  ...defaultAgentComposerDraft,
  skills: [
    {
      id: 'playwright',
      name: 'Playwright',
    },
  ],
  tools: [
    {
      id: 'duckduckgo',
      name: 'DuckDuckGo',
      kind: 'provider',
      iconClassName: 'i-simple-icons-duckduckgo',
      credentialKey: 'agentDetail.configure.tools.credential.authOne',
      credentialVariant: 'authorized',
      actions: [
        {
          id: 'duckduckgo-search',
          name: 'DuckDuckGo Search',
          toolName: 'ddg_search',
          description: 'Search the web.',
        },
      ],
    },
  ],
} satisfies typeof defaultAgentComposerDraft

const renderAgentPromptEditor = (value: string) => {
  const store = createStore()
  store.set(agentComposerDraftAtom, {
    ...promptEditorDraft,
    prompt: value,
  })

  const view = render(
    <JotaiProvider store={store}>
      <AgentPromptEditor />
    </JotaiProvider>,
  )

  return {
    store,
    ...view,
    rerenderWithValue: (nextValue: string) => {
      store.set(agentComposerPromptAtom, nextValue)
      view.rerender(
        <JotaiProvider store={store}>
          <AgentPromptEditor />
        </JotaiProvider>,
      )
    },
  }
}

describe('AgentPromptEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Prompt actions should expose the designed copy control and copy the current draft prompt.
  describe('Prompt Actions', () => {
    it('should copy the current prompt when the copy button is clicked', () => {
      renderAgentPromptEditor('Review these tenders')

      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.prompt\.copy/i }))

      expect(mockCopy).toHaveBeenCalledWith('Review these tenders')
    })
  })

  // Prompt slash commands should use the Agent Roster category menu and replace it with submenus.
  describe('Slash Commands', () => {
    it('should open category menu, show skill submenu, and append the selected reference', async () => {
      const { store, rerenderWithValue } = renderAgentPromptEditor('Review these tenders')

      expect(mockPromptEditor).toHaveBeenCalledWith(expect.objectContaining({
        disableBracePicker: true,
        disableSlashPicker: true,
        rosterReferenceBlock: {
          show: true,
        },
      }))

      expect(fireEvent.keyDown(screen.getByRole('textbox'), { key: '/' })).toBe(true)
      rerenderWithValue('Review these tenders/')
      expect(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i }))
      expect(screen.queryByRole('button', { name: /agentDetail\.configure\.files\.label/i })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /Playwright/i }))

      expect(store.get(agentComposerPromptAtom)).toBe('Review these tenders [§skill:playwright:Playwright§]')
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /Playwright/i })).not.toBeInTheDocument()
      })
    })

    it('should append provider tool references with provider and action names', () => {
      const { store, rerenderWithValue } = renderAgentPromptEditor('Research/')

      fireEvent.keyDown(screen.getByRole('textbox'), { key: '/' })
      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.tools\.label/i }))
      fireEvent.click(screen.getByRole('button', { name: /DuckDuckGo Search/i }))

      expect(store.get(agentComposerPromptAtom)).toBe('Research [§tool:duckduckgo/ddg_search:DuckDuckGo Search§]')

      rerenderWithValue('Research/')
      fireEvent.keyDown(screen.getByRole('textbox'), { key: '/' })
      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.tools\.label/i }))
      fireEvent.click(screen.getByRole('button', { name: /DuckDuckGo.*agentDetail\.configure\.tools\.pluginType/i }))

      expect(store.get(agentComposerPromptAtom)).toBe('Research [§tool:duckduckgo/*:DuckDuckGo§]')
    })

    it('should close slash menu when slash is deleted or the user clicks outside', async () => {
      const { rerenderWithValue } = renderAgentPromptEditor('Review/')

      fireEvent.keyDown(screen.getByRole('textbox'), { key: '/' })
      expect(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).toBeInTheDocument()

      rerenderWithValue('Review')
      fireEvent.keyUp(screen.getByRole('textbox'), { key: 'Backspace' })

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).not.toBeInTheDocument()
      })

      rerenderWithValue('Review/')
      fireEvent.keyDown(screen.getByRole('textbox'), { key: '/' })
      expect(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).toBeInTheDocument()

      fireEvent.pointerDown(document.body)

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).not.toBeInTheDocument()
      })
    })

    it('should reopen slash menu when the cursor is positioned after slash', async () => {
      renderAgentPromptEditor('Review/')

      fireEvent.keyUp(screen.getByRole('textbox'), { key: 'ArrowRight' })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).toBeInTheDocument()
      })
    })
  })
})
