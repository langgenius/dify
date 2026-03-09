import type { Dependency, InstallStatus, Plugin } from '../../../types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InstallStep } from '../../../types'
import ReadyToInstall from '../ready-to-install'

// Track the onInstalled callback from the Install component
let capturedOnInstalled: ((plugins: Plugin[], installStatus: InstallStatus[]) => void) | null = null

vi.mock('../steps/install', () => ({
  default: ({
    allPlugins,
    onCancel,
    onStartToInstall,
    onInstalled,
    isFromMarketPlace,
  }: {
    allPlugins: Dependency[]
    onCancel: () => void
    onStartToInstall: () => void
    onInstalled: (plugins: Plugin[], installStatus: InstallStatus[]) => void
    isFromMarketPlace?: boolean
  }) => {
    capturedOnInstalled = onInstalled
    return (
      <div data-testid="install-step">
        <span data-testid="install-plugins-count">{allPlugins?.length}</span>
        <span data-testid="install-from-marketplace">{String(!!isFromMarketPlace)}</span>
        <button data-testid="install-cancel-btn" onClick={onCancel}>Cancel</button>
        <button data-testid="install-start-btn" onClick={onStartToInstall}>Start</button>
        <button
          data-testid="install-complete-btn"
          onClick={() => onInstalled(
            [{ plugin_id: 'p1', name: 'Plugin 1' } as Plugin],
            [{ success: true, isFromMarketPlace: true }],
          )}
        >
          Complete
        </button>
      </div>
    )
  },
}))

vi.mock('../steps/installed', () => ({
  default: ({
    list,
    installStatus,
    onCancel,
  }: {
    list: Plugin[]
    installStatus: InstallStatus[]
    onCancel: () => void
  }) => (
    <div data-testid="installed-step">
      <span data-testid="installed-count">{list.length}</span>
      <span data-testid="installed-status-count">{installStatus.length}</span>
      <button data-testid="installed-close-btn" onClick={onCancel}>Close</button>
    </div>
  ),
}))

const createMockDependencies = (): Dependency[] => [
  {
    type: 'marketplace',
    value: {
      marketplace_plugin_unique_identifier: 'plugin-1-uid',
    },
  } as Dependency,
  {
    type: 'github',
    value: {
      repo: 'test/plugin2',
      version: 'v1.0.0',
      package: 'plugin2.zip',
    },
  } as Dependency,
]

describe('ReadyToInstall', () => {
  const mockOnStepChange = vi.fn()
  const mockOnStartToInstall = vi.fn()
  const mockSetIsInstalling = vi.fn()
  const mockOnClose = vi.fn()

  const defaultProps = {
    step: InstallStep.readyToInstall,
    onStepChange: mockOnStepChange,
    onStartToInstall: mockOnStartToInstall,
    setIsInstalling: mockSetIsInstalling,
    allPlugins: createMockDependencies(),
    onClose: mockOnClose,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnInstalled = null
  })

  describe('readyToInstall step', () => {
    it('should render Install component when step is readyToInstall', () => {
      render(<ReadyToInstall {...defaultProps} />)

      expect(screen.getByTestId('install-step')).toBeInTheDocument()
      expect(screen.queryByTestId('installed-step')).not.toBeInTheDocument()
    })

    it('should pass allPlugins count to Install component', () => {
      render(<ReadyToInstall {...defaultProps} />)

      expect(screen.getByTestId('install-plugins-count')).toHaveTextContent('2')
    })

    it('should pass isFromMarketPlace to Install component', () => {
      render(<ReadyToInstall {...defaultProps} isFromMarketPlace />)

      expect(screen.getByTestId('install-from-marketplace')).toHaveTextContent('true')
    })

    it('should pass onClose as onCancel to Install', () => {
      render(<ReadyToInstall {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-cancel-btn'))

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should pass onStartToInstall to Install', () => {
      render(<ReadyToInstall {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-start-btn'))

      expect(mockOnStartToInstall).toHaveBeenCalledTimes(1)
    })
  })

  describe('handleInstalled callback', () => {
    it('should transition to installed step when Install completes', () => {
      render(<ReadyToInstall {...defaultProps} />)

      // Trigger the onInstalled callback via the mock button
      fireEvent.click(screen.getByTestId('install-complete-btn'))

      // Should update step to installed
      expect(mockOnStepChange).toHaveBeenCalledWith(InstallStep.installed)
      // Should set isInstalling to false
      expect(mockSetIsInstalling).toHaveBeenCalledWith(false)
    })

    it('should store installed plugins and status for the Installed step', () => {
      const { rerender } = render(<ReadyToInstall {...defaultProps} />)

      // Trigger install completion
      fireEvent.click(screen.getByTestId('install-complete-btn'))

      // Re-render with step=installed to show Installed component
      rerender(
        <ReadyToInstall
          {...defaultProps}
          step={InstallStep.installed}
        />,
      )

      expect(screen.getByTestId('installed-step')).toBeInTheDocument()
      expect(screen.getByTestId('installed-count')).toHaveTextContent('1')
      expect(screen.getByTestId('installed-status-count')).toHaveTextContent('1')
    })

    it('should pass custom plugins and status via capturedOnInstalled', () => {
      const { rerender } = render(<ReadyToInstall {...defaultProps} />)

      // Use the captured callback directly with custom data
      expect(capturedOnInstalled).toBeTruthy()
      act(() => {
        capturedOnInstalled!(
          [
            { plugin_id: 'p1', name: 'P1' } as Plugin,
            { plugin_id: 'p2', name: 'P2' } as Plugin,
          ],
          [
            { success: true, isFromMarketPlace: true },
            { success: false, isFromMarketPlace: false },
          ],
        )
      })

      expect(mockOnStepChange).toHaveBeenCalledWith(InstallStep.installed)
      expect(mockSetIsInstalling).toHaveBeenCalledWith(false)

      // Re-render at installed step
      rerender(
        <ReadyToInstall
          {...defaultProps}
          step={InstallStep.installed}
        />,
      )

      expect(screen.getByTestId('installed-count')).toHaveTextContent('2')
      expect(screen.getByTestId('installed-status-count')).toHaveTextContent('2')
    })
  })

  describe('installed step', () => {
    it('should render Installed component when step is installed', () => {
      render(
        <ReadyToInstall
          {...defaultProps}
          step={InstallStep.installed}
        />,
      )

      expect(screen.queryByTestId('install-step')).not.toBeInTheDocument()
      expect(screen.getByTestId('installed-step')).toBeInTheDocument()
    })

    it('should pass onClose to Installed component', () => {
      render(
        <ReadyToInstall
          {...defaultProps}
          step={InstallStep.installed}
        />,
      )

      fireEvent.click(screen.getByTestId('installed-close-btn'))

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should render empty installed list initially', () => {
      render(
        <ReadyToInstall
          {...defaultProps}
          step={InstallStep.installed}
        />,
      )

      expect(screen.getByTestId('installed-count')).toHaveTextContent('0')
      expect(screen.getByTestId('installed-status-count')).toHaveTextContent('0')
    })
  })

  describe('edge cases', () => {
    it('should render nothing when step is neither readyToInstall nor installed', () => {
      const { container } = render(
        <ReadyToInstall
          {...defaultProps}
          step={InstallStep.uploading}
        />,
      )

      expect(screen.queryByTestId('install-step')).not.toBeInTheDocument()
      expect(screen.queryByTestId('installed-step')).not.toBeInTheDocument()
      // Only the empty fragment wrapper
      expect(container.innerHTML).toBe('')
    })

    it('should handle empty allPlugins array', () => {
      render(
        <ReadyToInstall
          {...defaultProps}
          allPlugins={[]}
        />,
      )

      expect(screen.getByTestId('install-plugins-count')).toHaveTextContent('0')
    })
  })
})
