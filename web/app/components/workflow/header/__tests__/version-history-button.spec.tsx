import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VersionHistoryButton } from '../version-history-button'

let mockTheme: 'light' | 'dark' = 'light'
const hotkeyRegistrations = vi.hoisted(
  () =>
    new Map<
      string,
      {
        callback: () => void
        options?: { ignoreInputs?: boolean }
      }
    >(),
)

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({
    theme: mockTheme,
  }),
}))

vi.mock('@tanstack/react-hotkeys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-hotkeys')>()
  return {
    ...actual,
    useHotkey: (hotkey: string, callback: () => void, options?: { ignoreInputs?: boolean }) => {
      hotkeyRegistrations.set(hotkey, { callback, options })
    },
  }
})

describe('VersionHistoryButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hotkeyRegistrations.clear()
    mockTheme = 'light'
  })

  it('should call onClick when the button is clicked', () => {
    const onClick = vi.fn()
    render(<VersionHistoryButton onClick={onClick} />)

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.versionHistory' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('should trigger onClick when the version history shortcut is pressed', async () => {
    const onClick = vi.fn()
    render(<VersionHistoryButton onClick={onClick} />)

    await act(async () => {
      hotkeyRegistrations.get('Mod+Shift+H')?.callback()
    })

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(hotkeyRegistrations.get('Mod+Shift+H')?.options).toEqual(
      expect.objectContaining({ ignoreInputs: true }),
    )
  })

  it('should render the tooltip popup content on hover', async () => {
    const user = userEvent.setup()
    render(<VersionHistoryButton onClick={vi.fn()} />)

    await user.hover(screen.getByRole('button', { name: 'workflow.common.versionHistory' }))

    expect(await screen.findByText('workflow.common.versionHistory')).toBeInTheDocument()
  })
})
