import type { ReactNode } from 'react'
import type { PromptEditorProps } from '@/app/components/base/prompt-editor'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store'
import { AgentPromptEditor } from '../orchestrate/prompt-editor'

const mockPromptEditor = vi.hoisted(() => vi.fn())

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

const renderAgentPromptEditor = (value: string) => {
  const store = createStore()
  store.set(agentComposerPromptAtom, value)

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
