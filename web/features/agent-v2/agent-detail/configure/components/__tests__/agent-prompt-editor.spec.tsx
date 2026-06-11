import type { ReactNode } from 'react'
import type { PromptEditorProps } from '@/app/components/base/prompt-editor'
import { fireEvent, render, screen } from '@testing-library/react'
import { AgentPromptEditor } from '../agent-prompt-editor'

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

describe('AgentPromptEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Prompt slash commands should use the Agent Roster category menu and replace it with submenus.
  describe('Slash Commands', () => {
    it('should open category menu, show skill submenu, and append the selected reference', () => {
      const onChange = vi.fn()

      const { rerender } = render(
        <AgentPromptEditor
          value="Review these tenders"
          onChange={onChange}
        />,
      )

      expect(mockPromptEditor).toHaveBeenCalledWith(expect.objectContaining({
        disableBracePicker: true,
        disableSlashPicker: true,
      }))

      expect(fireEvent.keyDown(screen.getByRole('textbox'), { key: '/' })).toBe(true)
      rerender(
        <AgentPromptEditor
          value="Review these tenders/"
          onChange={onChange}
        />,
      )
      expect(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i }))
      expect(screen.queryByRole('button', { name: /agentDetail\.configure\.files\.label/i })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /Playwright/i }))

      expect(onChange).toHaveBeenCalledWith('Review these tenders [§skill:playwright:Playwright§]')
      expect(screen.queryByRole('button', { name: /Playwright/i })).not.toBeInTheDocument()
    })
  })
})
