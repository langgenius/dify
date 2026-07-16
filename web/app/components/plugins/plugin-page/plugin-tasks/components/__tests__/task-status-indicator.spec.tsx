import { fireEvent, render, screen } from '@testing-library/react'
import TaskStatusIndicator from '../task-status-indicator'

vi.mock('@/app/components/header/plugins-nav/downloading-icon', () => ({
  default: ({ active = true }: { active?: boolean }) => (
    <span data-active={String(active)} data-testid="downloading-icon" />
  ),
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
      expect(screen.getByRole('button', { name: 'Installing plugins' })).toBeInTheDocument()
    })

    it('should use tip as the trigger accessible name', () => {
      render(<TaskStatusIndicator {...defaultProps} tip="My tip" />)
      expect(screen.getByRole('button', { name: 'My tip' })).toBeInTheDocument()
    })

    it('should render install icon by default', () => {
      render(<TaskStatusIndicator {...defaultProps} />)
      expect(screen.getByTestId('downloading-icon')).toHaveAttribute('data-active', 'false')
    })

    it('should match the all-done install icon treatment', () => {
      render(
        <TaskStatusIndicator
          {...defaultProps}
          isSuccess
          successPluginsLength={1}
          totalPluginsLength={1}
        />,
      )

      const button = document.getElementById('plugin-task-trigger')!

      expect(button).toHaveClass(
        'size-8',
        'border-[0.5px]',
        'border-components-panel-border-subtle',
        'bg-components-panel-bg',
        'p-2',
        'rounded-lg',
      )
      expect(screen.getByTestId('downloading-icon')).toHaveAttribute('data-active', 'false')
      expect(screen.getByTestId('task-status-success-badge')).toHaveClass(
        'size-3.5',
        'text-text-success',
      )
    })
  })

  describe('Installing state', () => {
    it('should show downloading icon when isInstalling', () => {
      render(<TaskStatusIndicator {...defaultProps} isInstalling />)
      expect(screen.getByTestId('downloading-icon')).toHaveAttribute('data-active', 'true')
    })

    it('should show downloading icon when isInstallingWithError', () => {
      render(<TaskStatusIndicator {...defaultProps} isInstallingWithError />)
      expect(screen.getByTestId('downloading-icon')).toHaveAttribute('data-active', 'true')
    })

    it('should not show a badge when isInstalling', () => {
      render(
        <TaskStatusIndicator
          {...defaultProps}
          isInstalling
          successPluginsLength={2}
          totalPluginsLength={5}
        />,
      )
      expect(screen.queryByTestId('progress-circle')).not.toBeInTheDocument()
    })

    it('should show downloading icon without success badge when isInstallingWithSuccess', () => {
      render(
        <TaskStatusIndicator
          {...defaultProps}
          isInstallingWithSuccess
          successPluginsLength={3}
          totalPluginsLength={4}
        />,
      )
      expect(screen.getByTestId('downloading-icon')).toHaveAttribute('data-active', 'true')
      expect(screen.queryByTestId('progress-circle')).not.toBeInTheDocument()
      expect(screen.queryByTestId('task-status-success-badge')).not.toBeInTheDocument()
    })

    it('should show error badge when isInstallingWithError', () => {
      render(
        <TaskStatusIndicator
          {...defaultProps}
          isInstallingWithError
          runningPluginsLength={1}
          totalPluginsLength={3}
        />,
      )
      expect(screen.queryByTestId('progress-circle')).not.toBeInTheDocument()
      const badgeIcon = screen.getByTestId('task-status-error-badge')
      expect(badgeIcon).toBeInTheDocument()
      expect(badgeIcon.parentElement).toHaveClass(
        '-top-1.5',
        '-right-1.5',
        'box-content',
        'size-3.5',
      )
      expect(badgeIcon.parentElement).toHaveClass('border')
      expect(badgeIcon).toHaveClass('size-3.5')
    })

    it('should handle zero totalPluginsLength without division error', () => {
      render(<TaskStatusIndicator {...defaultProps} isInstalling totalPluginsLength={0} />)
      expect(screen.queryByTestId('progress-circle')).not.toBeInTheDocument()
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
      // Installing icon is shown instead of success badge.
      expect(screen.getByTestId('downloading-icon')).toHaveAttribute('data-active', 'true')
      expect(screen.queryByTestId('progress-circle')).not.toBeInTheDocument()
      expect(container.querySelector('.text-text-success')).not.toBeInTheDocument()
    })
  })

  describe('Failed state', () => {
    it('should show error icon when isFailed', () => {
      const { container } = render(
        <TaskStatusIndicator {...defaultProps} isFailed totalPluginsLength={2} />,
      )
      const errorIcon = container.querySelector('.text-text-destructive')
      expect(errorIcon).toBeInTheDocument()
    })

    it('should not show success badge when failed state includes successful plugins', () => {
      render(
        <TaskStatusIndicator
          {...defaultProps}
          isFailed
          successPluginsLength={1}
          runningPluginsLength={0}
          totalPluginsLength={2}
        />,
      )

      expect(screen.getByTestId('task-status-error-badge')).toBeInTheDocument()
      expect(screen.queryByTestId('task-status-success-badge')).not.toBeInTheDocument()
    })

    it('should keep the center install icon neutral in failed state', () => {
      render(<TaskStatusIndicator {...defaultProps} isFailed totalPluginsLength={1} />)

      expect(screen.getByTestId('downloading-icon')).toHaveAttribute('data-active', 'false')
    })

    it('should apply destructive styling when isFailed', () => {
      render(<TaskStatusIndicator {...defaultProps} isFailed totalPluginsLength={1} />)
      const button = document.getElementById('plugin-task-trigger')!
      expect(button.className).toContain('bg-state-destructive-hover')
    })

    it('should apply destructive styling when isInstallingWithError', () => {
      render(<TaskStatusIndicator {...defaultProps} isInstallingWithError totalPluginsLength={2} />)
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
    it('should keep success state clickable so completed tasks can be reviewed', () => {
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

    it('should apply cursor-pointer for error states', () => {
      render(<TaskStatusIndicator {...defaultProps} isFailed totalPluginsLength={1} />)
      const button = document.getElementById('plugin-task-trigger')!
      expect(button.className).toContain('cursor-pointer')
    })

    it('should apply open trigger styling when the task menu is expanded', () => {
      render(<TaskStatusIndicator {...defaultProps} isFailed isOpen totalPluginsLength={1} />)

      const button = document.getElementById('plugin-task-trigger')!
      expect(button).toHaveClass('bg-state-destructive-hover-alt', 'shadow-xs')
    })

    it('should not show any badge indicators when all flags are false', () => {
      render(<TaskStatusIndicator {...defaultProps} />)
      expect(screen.queryByTestId('progress-circle')).not.toBeInTheDocument()
      const button = document.getElementById('plugin-task-trigger')!
      // No success or error icons in the badge area
      expect(button.querySelector('.text-text-success')).not.toBeInTheDocument()
      expect(button.querySelector('.text-text-destructive')).not.toBeInTheDocument()
    })

    it('should render a disabled trigger icon for inactive task status', () => {
      render(<TaskStatusIndicator {...defaultProps} disabled />)

      const button = document.getElementById('plugin-task-trigger')!
      expect(button).toBeDisabled()
      expect(screen.getByTestId('downloading-icon')).toHaveAttribute('data-active', 'false')
      expect(screen.queryByTestId('task-status-success-badge')).not.toBeInTheDocument()
    })
  })
})
