import { fireEvent, render, screen } from '@testing-library/react'
import VersionHistoryButton from '../version-history-button'

let mockTheme: 'light' | 'dark' = 'light'

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({
    theme: mockTheme,
  }),
}))

vi.mock('../../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils')>()
  return {
    ...actual,
    getKeyboardKeyCodeBySystem: () => 'ctrl',
  }
})

describe('VersionHistoryButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTheme = 'light'
  })

  it('should call onClick when the button is clicked', () => {
    const onClick = vi.fn()
    render(<VersionHistoryButton onClick={onClick} />)

    fireEvent.click(screen.getByRole('button'))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('should trigger onClick when the version history shortcut is pressed', () => {
    const onClick = vi.fn()
    render(<VersionHistoryButton onClick={onClick} />)

    const keyboardEvent = new KeyboardEvent('keydown', {
      key: 'H',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(keyboardEvent, 'keyCode', { value: 72 })
    Object.defineProperty(keyboardEvent, 'which', { value: 72 })
    window.dispatchEvent(keyboardEvent)

    expect(keyboardEvent.defaultPrevented).toBe(true)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('should render the tooltip popup content on hover', async () => {
    render(<VersionHistoryButton onClick={vi.fn()} />)

    fireEvent.mouseEnter(screen.getByRole('button'))

    expect(await screen.findByText('workflow.common.versionHistory')).toBeInTheDocument()
  })

  it('should apply dark theme styles when the theme is dark', () => {
    mockTheme = 'dark'
    render(<VersionHistoryButton onClick={vi.fn()} />)

    expect(screen.getByRole('button')).toHaveClass('border-black/5', 'bg-white/10', 'backdrop-blur-sm')
  })
})
