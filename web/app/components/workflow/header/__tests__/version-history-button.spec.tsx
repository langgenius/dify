import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VersionHistoryButton } from '../version-history-button'

let mockTheme: 'light' | 'dark' = 'light'
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({
    theme: mockTheme,
  }),
}))

describe('VersionHistoryButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTheme = 'light'
  })

  it('should call onClick when the button is clicked', () => {
    const onClick = vi.fn()
    render(<VersionHistoryButton onClick={onClick} />)

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.versionHistory' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('opens history once per press from the page and respects editable and handled keys', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <HotkeysProvider defaultOptions={{ hotkey: { platform: 'windows' } }}>
        <VersionHistoryButton onClick={onClick} />
        <input aria-label="Prompt" />
        <button onKeyDown={(event) => event.preventDefault()}>Local control</button>
      </HotkeysProvider>,
    )
    for (const repeat of [false, true, true]) {
      const event = new KeyboardEvent('keydown', {
        key: 'h',
        ctrlKey: true,
        shiftKey: true,
        repeat,
        bubbles: true,
        cancelable: true,
      })
      fireEvent(document.body, event)
      expect(event.defaultPrevented).toBe(true)
    }
    fireEvent.keyUp(document.body, { key: 'h', ctrlKey: true, shiftKey: true })
    expect(onClick).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('textbox', { name: 'Prompt' }))
    await user.keyboard('{Control>}{Shift>}h{/Shift}{/Control}')
    await user.click(screen.getByRole('button', { name: 'Local control' }))
    await user.keyboard('{Control>}{Shift>}h{/Shift}{/Control}')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('should render the tooltip popup content on hover', async () => {
    const user = userEvent.setup()
    render(<VersionHistoryButton onClick={vi.fn()} />)

    await user.hover(screen.getByRole('button', { name: 'workflow.common.versionHistory' }))

    expect(await screen.findByText('workflow.common.versionHistory')).toBeInTheDocument()
  })
})
