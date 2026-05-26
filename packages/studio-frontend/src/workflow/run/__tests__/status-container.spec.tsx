import { render, screen } from '@testing-library/react'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import StatusContainer from '../status-container'

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
      expect(container.querySelector('.bg-\\[url\\(\\~\\@\\/app\\/components\\/workflow\\/run\\/assets\\/highlight\\.svg\\)\\]')).toBeInTheDocument()
    })

    it('should render failed styling for the dark theme', () => {
      mockUseTheme.mockReturnValue({ theme: Theme.dark } as ReturnType<typeof useTheme>)

      const { container } = render(
        <StatusContainer status="failed">
          <span>Failed</span>
        </StatusContainer>,
      )

      expect(container.firstElementChild).toHaveClass('bg-workflow-display-error-bg')
      expect(container.firstElementChild).toHaveClass('text-text-warning')
      expect(container.querySelector('.bg-\\[url\\(\\~\\@\\/app\\/components\\/workflow\\/run\\/assets\\/highlight-dark\\.svg\\)\\]')).toBeInTheDocument()
    })

    it('should render warning styling for paused runs', () => {
      const { container } = render(
        <StatusContainer status="paused">
          <span>Paused</span>
        </StatusContainer>,
      )

      expect(container.firstElementChild).toHaveClass('bg-workflow-display-warning-bg')
      expect(container.firstElementChild).toHaveClass('text-text-destructive')
    })
  })
})
