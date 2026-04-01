import { fireEvent, render, screen } from '@testing-library/react'
import TaskStatusIndicator from '../task-status-indicator'

vi.mock('@/app/components/base/progress-bar/progress-circle', () => ({
  default: ({ percentage }: { percentage: number }) => (
    <div data-testid="progress-circle" data-percentage={percentage} />
  ),
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children, popupContent }: { children: React.ReactNode, popupContent: string }) => (
    <div data-testid="tooltip" data-tip={popupContent}>{children}</div>
  ),
}))

vi.mock('@/app/components/header/plugins-nav/downloading-icon', () => ({
  default: () => <span data-testid="downloading-icon" />,
}))

const defaultProps = {
  tip: 'Installing plugins',
  isInstalling: false,
  isInstallingWithSuccess: false,
  isInstallingWithError: false,
  isSuccess: false,
  isFailed: false,
  successPluginsLength: 0,
  runningPluginsLength: 0,
  totalPluginsLength: 0,
  onClick: vi.fn(),
}

describe('TaskStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<TaskStatusIndicator {...defaultProps} />)
      expect(screen.getByTestId('tooltip')).toBeInTheDocument()
    })

    it('should pass tip to tooltip', () => {
      render(<TaskStatusIndicator {...defaultProps} tip="My tip" />)
      expect(screen.getByTestId('tooltip')).toHaveAttribute('data-tip', 'My tip')
    })

    it('should render install icon by default', () => {
      const { container } = render(<TaskStatusIndicator {...defaultProps} />)
      // RiInstallLine renders as svg
      expect(container.querySelector('svg')).toBeInTheDocument()
      expect(screen.queryByTestId('downloading-icon')).not.toBeInTheDocument()
    })
  })

  describe('Installing state', () => {
    it('should show downloading icon when isInstalling', () => {
      render(<TaskStatusIndicator {...defaultProps} isInstalling />)
      expect(screen.getByTestId('downloading-icon')).toBeInTheDocument()
    })

    it('should show downloading icon when isInstallingWithError', () => {
      render(<TaskStatusIndicator {...defaultProps} isInstallingWithError />)
      expect(screen.getByTestId('downloading-icon')).toBeInTheDocument()
    })

    it('should show progress circle when isInstalling', () => {
      render(
        <TaskStatusIndicator
          {...defaultProps}
          isInstalling
          successPluginsLength={2}
          totalPluginsLength={5}
        />,
      )
      const progress = screen.getByTestId('progress-circle')
      expect(progress).toHaveAttribute('data-percentage', '40')
    })

    it('should show progress circle when isInstallingWithSuccess', () => {
      render(
        <TaskStatusIndicator
          {...defaultProps}
          isInstallingWithSuccess
          successPluginsLength={3}
          totalPluginsLength={4}
        />,
      )
      const progress = screen.getByTestId('progress-circle')
      expect(progress).toHaveAttribute('data-percentage', '75')
    })

    it('should show error progress circle when isInstallingWithError', () => {
      render(
        <TaskStatusIndicator
          {...defaultProps}
          isInstallingWithError
          runningPluginsLength={1}
          totalPluginsLength={3}
        />,
      )
      const progress = screen.getByTestId('progress-circle')
      expect(progress).toBeInTheDocument()
    })

    it('should handle zero totalPluginsLength without division error', () => {
      render(
        <TaskStatusIndicator
          {...defaultProps}
          isInstalling
          totalPluginsLength={0}
        />,
      )
      const progress = screen.getByTestId('progress-circle')
      expect(progress).toHaveAttribute('data-percentage', '0')
    })
  })

  describe('Success state', () => {
    it('should show success icon when isSuccess', () => {
      const { container } = render(
        <TaskStatusIndicator
          {...defaultProps}
          isSuccess
          successPluginsLength={3}
          totalPluginsLength={3}
        />,
      )
      // RiCheckboxCircleFill is rendered as svg with text-text-success
      const successIcon = container.querySelector('.text-text-success')
      expect(successIcon).toBeInTheDocument()
    })

    it('should show success icon when successPlugins > 0 and no running plugins', () => {
      const { container } = render(
        <TaskStatusIndicator
          {...defaultProps}
          successPluginsLength={2}
          runningPluginsLength={0}
          totalPluginsLength={2}
        />,
      )
      const successIcon = container.querySelector('.text-text-success')
      expect(successIcon).toBeInTheDocument()
    })

    it('should not show success icon during installing states', () => {
      const { container } = render(
        <TaskStatusIndicator
          {...defaultProps}
          isInstalling
          successPluginsLength={1}
          runningPluginsLength={1}
          totalPluginsLength={2}
        />,
      )
      // Progress circle shown instead of success icon
      expect(screen.getByTestId('progress-circle')).toBeInTheDocument()
      expect(container.querySelector('.text-text-success')).not.toBeInTheDocument()
    })
  })

  describe('Failed state', () => {
    it('should show error icon when isFailed', () => {
      const { container } = render(
        <TaskStatusIndicator
          {...defaultProps}
          isFailed
          totalPluginsLength={2}
        />,
      )
      const errorIcon = container.querySelector('.text-text-destructive')
      expect(errorIcon).toBeInTheDocument()
    })

    it('should apply destructive styling when isFailed', () => {
      render(
        <TaskStatusIndicator
          {...defaultProps}
          isFailed
          totalPluginsLength={1}
        />,
      )
      const button = document.getElementById('plugin-task-trigger')!
      expect(button.className).toContain('bg-state-destructive-hover')
    })

    it('should apply destructive styling when isInstallingWithError', () => {
      render(
        <TaskStatusIndicator
          {...defaultProps}
          isInstallingWithError
          totalPluginsLength={2}
        />,
      )
      const button = document.getElementById('plugin-task-trigger')!
      expect(button.className).toContain('bg-state-destructive-hover')
    })
  })

  describe('User Interactions', () => {
    it('should call onClick when clicked', () => {
      const onClick = vi.fn()
      render(<TaskStatusIndicator {...defaultProps} onClick={onClick} />)

      const button = document.getElementById('plugin-task-trigger')!
      fireEvent.click(button)

      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should apply cursor-pointer for interactive states', () => {
      render(
        <TaskStatusIndicator
          {...defaultProps}
          isSuccess
          successPluginsLength={1}
          totalPluginsLength={1}
        />,
      )
      const button = document.getElementById('plugin-task-trigger')!
      expect(button.className).toContain('cursor-pointer')
    })

    it('should not show any badge indicators when all flags are false', () => {
      render(<TaskStatusIndicator {...defaultProps} />)
      expect(screen.queryByTestId('progress-circle')).not.toBeInTheDocument()
      const button = document.getElementById('plugin-task-trigger')!
      // No success or error icons in the badge area
      expect(button.querySelector('.text-text-success')).not.toBeInTheDocument()
      expect(button.querySelector('.text-text-destructive')).not.toBeInTheDocument()
    })
  })
})
