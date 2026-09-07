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
      expect(
        container.querySelector(
          '.bg-\\[url\\(\\~\\@\\/app\\/components\\/workflow\\/run\\/assets\\/highlight\\.svg\\)\\]',
        ),
      ).toBeInTheDocument()
    })
  })

  it('copies the supplied content from the status action', async () => {
    const user = userEvent.setup()
    render(
      <StatusContainer status="failed" copyContent="Execution failed">
        Execution failed
      </StatusContainer>,
    )

    await user.click(
      screen.getByRole('button', { name: 'appOverview.overview.appInfo.embedded.copy' }),
    )

    expect(copy).toHaveBeenCalledWith('Execution failed')
  })
})
