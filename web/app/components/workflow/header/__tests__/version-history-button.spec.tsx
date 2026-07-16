import { act, fireEvent, render, screen } from '@testing-library/react'
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

vi.mock('@langgenius/dify-ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: React.ReactNode }) => <>{render}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('VersionHistoryButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hotkeyRegistrations.clear()
    mockTheme = 'light'
  })

  it('should call onClick when the button is clicked', () => {
    const onClick = vi.fn()
    render(<VersionHistoryButton onClick={onClick} />)

    fireEvent.click(screen.getByRole('button'))

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
    render(<VersionHistoryButton onClick={vi.fn()} />)

    fireEvent.mouseEnter(screen.getByRole('button'))

    expect(await screen.findByText('workflow.common.versionHistory')).toBeInTheDocument()
  })

  it('should apply dark theme styles when the theme is dark', () => {
    mockTheme = 'dark'
    render(<VersionHistoryButton onClick={vi.fn()} />)

    expect(screen.getByRole('button')).toHaveClass(
      'border-black/5',
      'bg-white/10',
      'backdrop-blur-xs',
    )
  })
})
