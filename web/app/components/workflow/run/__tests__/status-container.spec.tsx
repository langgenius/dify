import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import StatusContainer from '../status-container'

const copy = vi.fn()

vi.mock('foxact/use-clipboard', () => ({
  useClipboard: () => ({
    copied: false,
    copy,
  }),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(),
}))

const mockUseTheme = vi.mocked(useTheme)

const highlightOverlay = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[class*="pointer-events-none"][class*="bg-no-repeat"]')

describe('StatusContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
  })

  // Status styling should follow the current theme and runtime status.
  describe('Status Variants', () => {
    it('should render success styling for the light theme', () => {
      const { container } = render(
        <StatusContainer status="succeeded">
          <span>Finished</span>
        </StatusContainer>,
      )

      expect(screen.getByText('Finished')).toBeInTheDocument()
      expect(container.firstElementChild).toHaveClass('bg-workflow-display-success-bg')
      expect(container.firstElementChild).toHaveClass('text-text-success')
      expect(container.firstElementChild).toHaveStyle({
        backgroundImage: 'url(/__static__/app/components/workflow/run/assets/bg-line-success.svg)',
      })
      expect(highlightOverlay(container)).toHaveStyle({
        backgroundImage: 'url(/__static__/app/components/workflow/run/assets/highlight.svg)',
      })
    })

    it('should render the dark-theme highlight overlay', () => {
      mockUseTheme.mockReturnValue({ theme: Theme.dark } as ReturnType<typeof useTheme>)

      const { container } = render(<StatusContainer status="running">Running</StatusContainer>)

      expect(container.firstElementChild).toHaveStyle({
        backgroundImage: 'url(/__static__/app/components/workflow/run/assets/bg-line-running.svg)',
      })
      expect(highlightOverlay(container)).toHaveStyle({
        backgroundImage: 'url(/__static__/app/components/workflow/run/assets/highlight-dark.svg)',
      })
    })

    // The alias form `~@/...` is not resolved by the production bundler, so the
    // emitted CSS must never contain it. See #42434.
    it('should not emit unresolved tilde-alias asset URLs', () => {
      const { container } = render(<StatusContainer status="failed">Failed</StatusContainer>)

      expect(container.innerHTML).not.toContain('~@/')
    })

    it('should not set a background image for an unknown status', () => {
      const { container } = render(<StatusContainer status="unknown">Unknown</StatusContainer>)

      expect((container.firstElementChild as HTMLElement).style.backgroundImage).toBe('')
    })
  })

  it('copies the supplied content from the status action', async () => {
    const user = userEvent.setup()
    render(
      <StatusContainer status="failed" copyContent="Execution failed">
        Execution failed
      </StatusContainer>,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))

    expect(copy).toHaveBeenCalledWith('Execution failed')
  })
})
