import type { PluginDeclaration } from '../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InstallStep, PluginCategoryEnum } from '../../types'
import ReadyToInstall from './ready-to-install'

// Factory function for test data
const createMockManifest = (overrides: Partial<PluginDeclaration> = {}): PluginDeclaration => ({
  plugin_unique_identifier: 'test-plugin-uid',
  version: '1.0.0',
  author: 'test-author',
  icon: 'test-icon.png',
  name: 'Test Plugin',
  category: PluginCategoryEnum.tool,
  label: { 'en-US': 'Test Plugin' } as PluginDeclaration['label'],
  description: { 'en-US': 'A test plugin' } as PluginDeclaration['description'],
  created_at: '2024-01-01T00:00:00Z',
  resource: {},
  plugins: [],
  verified: true,
  endpoint: { settings: [], endpoints: [] },
  model: null,
  tags: [],
  agent_strategy: null,
  meta: { version: '1.0.0' },
  trigger: {} as PluginDeclaration['trigger'],
  ...overrides,
})

// Mock external dependencies
const mockRefreshPluginList = vi.fn()
vi.mock('../hooks/use-refresh-plugin-list', () => ({
  default: () => ({
    refreshPluginList: mockRefreshPluginList,
  }),
}))

// Mock Install component
let _installOnInstalled: ((notRefresh?: boolean) => void) | null = null
let _installOnFailed: ((message?: string) => void) | null = null
let _installOnCancel: (() => void) | null = null
let _installOnStartToInstall: (() => void) | null = null

vi.mock('./steps/install', () => ({
  default: ({
    uniqueIdentifier,
    payload,
    onCancel,
    onStartToInstall,
    onInstalled,
    onFailed,
  }: {
    uniqueIdentifier: string
    payload: PluginDeclaration
    onCancel: () => void
    onStartToInstall?: () => void
    onInstalled: (notRefresh?: boolean) => void
    onFailed: (message?: string) => void
  }) => {
    _installOnInstalled = onInstalled
    _installOnFailed = onFailed
    _installOnCancel = onCancel
    _installOnStartToInstall = onStartToInstall ?? null
    return (
      <div data-testid="install-step">
        <span data-testid="install-uid">{uniqueIdentifier}</span>
        <span data-testid="install-payload-name">{payload.name}</span>
        <button data-testid="install-cancel-btn" onClick={onCancel}>Cancel</button>
        <button data-testid="install-start-btn" onClick={() => onStartToInstall?.()}>
          Start Install
        </button>
        <button data-testid="install-installed-btn" onClick={() => onInstalled()}>
          Installed
        </button>
        <button data-testid="install-installed-no-refresh-btn" onClick={() => onInstalled(true)}>
          Installed (No Refresh)
        </button>
        <button data-testid="install-failed-btn" onClick={() => onFailed()}>
          Failed
        </button>
        <button data-testid="install-failed-msg-btn" onClick={() => onFailed('Error message')}>
          Failed with Message
        </button>
      </div>
    )
  },
}))

// Mock Installed component
vi.mock('../base/installed', () => ({
  default: ({
    payload,
    isFailed,
    errMsg,
    onCancel,
  }: {
    payload: PluginDeclaration | null
    isFailed: boolean
    errMsg: string | null
    onCancel: () => void
  }) => (
    <div data-testid="installed-step">
      <span data-testid="installed-payload-name">{payload?.name || 'null'}</span>
      <span data-testid="installed-is-failed">{isFailed ? 'true' : 'false'}</span>
      <span data-testid="installed-err-msg">{errMsg || 'null'}</span>
      <button data-testid="installed-cancel-btn" onClick={onCancel}>Close</button>
    </div>
  ),
}))

describe('ReadyToInstall', () => {
  const defaultProps = {
    step: InstallStep.readyToInstall,
    onStepChange: vi.fn(),
    onStartToInstall: vi.fn(),
    setIsInstalling: vi.fn(),
    onClose: vi.fn(),
    uniqueIdentifier: 'test-unique-identifier',
    manifest: createMockManifest(),
    errorMsg: null as string | null,
    onError: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    _installOnInstalled = null
    _installOnFailed = null
    _installOnCancel = null
    _installOnStartToInstall = null
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render Install component when step is readyToInstall', () => {
      render(<ReadyToInstall {...defaultProps} step={InstallStep.readyToInstall} />)

      expect(screen.getByTestId('install-step')).toBeInTheDocument()
      expect(screen.queryByTestId('installed-step')).not.toBeInTheDocument()
    })

    it('should render Installed component when step is uploadFailed', () => {
      render(<ReadyToInstall {...defaultProps} step={InstallStep.uploadFailed} />)

      expect(screen.queryByTestId('install-step')).not.toBeInTheDocument()
      expect(screen.getByTestId('installed-step')).toBeInTheDocument()
    })

    it('should render Installed component when step is installed', () => {
      render(<ReadyToInstall {...defaultProps} step={InstallStep.installed} />)

      expect(screen.queryByTestId('install-step')).not.toBeInTheDocument()
      expect(screen.getByTestId('installed-step')).toBeInTheDocument()
    })

    it('should render Installed component when step is installFailed', () => {
      render(<ReadyToInstall {...defaultProps} step={InstallStep.installFailed} />)

      expect(screen.queryByTestId('install-step')).not.toBeInTheDocument()
      expect(screen.getByTestId('installed-step')).toBeInTheDocument()
    })
  })

  // ================================
  // Props Passing Tests
  // ================================
  describe('Props Passing', () => {
    it('should pass uniqueIdentifier to Install component', () => {
      render(<ReadyToInstall {...defaultProps} uniqueIdentifier="custom-uid" />)

      expect(screen.getByTestId('install-uid')).toHaveTextContent('custom-uid')
    })

    it('should pass manifest to Install component', () => {
      const manifest = createMockManifest({ name: 'Custom Plugin' })
      render(<ReadyToInstall {...defaultProps} manifest={manifest} />)

      expect(screen.getByTestId('install-payload-name')).toHaveTextContent('Custom Plugin')
    })

    it('should pass manifest to Installed component', () => {
      const manifest = createMockManifest({ name: 'Installed Plugin' })
      render(<ReadyToInstall {...defaultProps} step={InstallStep.installed} manifest={manifest} />)

      expect(screen.getByTestId('installed-payload-name')).toHaveTextContent('Installed Plugin')
    })

    it('should pass errorMsg to Installed component', () => {
      render(
        <ReadyToInstall
          {...defaultProps}
          step={InstallStep.installFailed}
          errorMsg="Some error"
        />,
      )

      expect(screen.getByTestId('installed-err-msg')).toHaveTextContent('Some error')
    })

    it('should pass isFailed=true for uploadFailed step', () => {
      render(<ReadyToInstall {...defaultProps} step={InstallStep.uploadFailed} />)

      expect(screen.getByTestId('installed-is-failed')).toHaveTextContent('true')
    })

    it('should pass isFailed=true for installFailed step', () => {
      render(<ReadyToInstall {...defaultProps} step={InstallStep.installFailed} />)

      expect(screen.getByTestId('installed-is-failed')).toHaveTextContent('true')
    })

    it('should pass isFailed=false for installed step', () => {
      render(<ReadyToInstall {...defaultProps} step={InstallStep.installed} />)

      expect(screen.getByTestId('installed-is-failed')).toHaveTextContent('false')
    })
  })

  // ================================
  // handleInstalled Callback Tests
  // ================================
  describe('handleInstalled Callback', () => {
    it('should call onStepChange with installed when handleInstalled is triggered', () => {
      const onStepChange = vi.fn()
      render(<ReadyToInstall {...defaultProps} onStepChange={onStepChange} />)

      fireEvent.click(screen.getByTestId('install-installed-btn'))

      expect(onStepChange).toHaveBeenCalledWith(InstallStep.installed)
    })

    it('should call refreshPluginList when handleInstalled is triggered without notRefresh', () => {
      const manifest = createMockManifest()
      render(<ReadyToInstall {...defaultProps} manifest={manifest} />)

      fireEvent.click(screen.getByTestId('install-installed-btn'))

      expect(mockRefreshPluginList).toHaveBeenCalledWith(manifest)
    })

    it('should not call refreshPluginList when handleInstalled is triggered with notRefresh=true', () => {
      render(<ReadyToInstall {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-installed-no-refresh-btn'))

      expect(mockRefreshPluginList).not.toHaveBeenCalled()
    })

    it('should call setIsInstalling(false) when handleInstalled is triggered', () => {
      const setIsInstalling = vi.fn()
      render(<ReadyToInstall {...defaultProps} setIsInstalling={setIsInstalling} />)

      fireEvent.click(screen.getByTestId('install-installed-btn'))

      expect(setIsInstalling).toHaveBeenCalledWith(false)
    })
  })

  // ================================
  // handleFailed Callback Tests
  // ================================
  describe('handleFailed Callback', () => {
    it('should call onStepChange with installFailed when handleFailed is triggered', () => {
      const onStepChange = vi.fn()
      render(<ReadyToInstall {...defaultProps} onStepChange={onStepChange} />)

      fireEvent.click(screen.getByTestId('install-failed-btn'))

      expect(onStepChange).toHaveBeenCalledWith(InstallStep.installFailed)
    })

    it('should call setIsInstalling(false) when handleFailed is triggered', () => {
      const setIsInstalling = vi.fn()
      render(<ReadyToInstall {...defaultProps} setIsInstalling={setIsInstalling} />)

      fireEvent.click(screen.getByTestId('install-failed-btn'))

      expect(setIsInstalling).toHaveBeenCalledWith(false)
    })

    it('should call onError when handleFailed is triggered with error message', () => {
      const onError = vi.fn()
      render(<ReadyToInstall {...defaultProps} onError={onError} />)

      fireEvent.click(screen.getByTestId('install-failed-msg-btn'))

      expect(onError).toHaveBeenCalledWith('Error message')
    })

    it('should not call onError when handleFailed is triggered without error message', () => {
      const onError = vi.fn()
      render(<ReadyToInstall {...defaultProps} onError={onError} />)

      fireEvent.click(screen.getByTestId('install-failed-btn'))

      expect(onError).not.toHaveBeenCalled()
    })
  })

  // ================================
  // onClose Callback Tests
  // ================================
  describe('onClose Callback', () => {
    it('should call onClose when cancel is clicked in Install component', () => {
      const onClose = vi.fn()
      render(<ReadyToInstall {...defaultProps} onClose={onClose} />)

      fireEvent.click(screen.getByTestId('install-cancel-btn'))

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when cancel is clicked in Installed component', () => {
      const onClose = vi.fn()
      render(<ReadyToInstall {...defaultProps} step={InstallStep.installed} onClose={onClose} />)

      fireEvent.click(screen.getByTestId('installed-cancel-btn'))

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  // ================================
  // onStartToInstall Callback Tests
  // ================================
  describe('onStartToInstall Callback', () => {
    it('should pass onStartToInstall to Install component', () => {
      const onStartToInstall = vi.fn()
      render(<ReadyToInstall {...defaultProps} onStartToInstall={onStartToInstall} />)

      fireEvent.click(screen.getByTestId('install-start-btn'))

      expect(onStartToInstall).toHaveBeenCalledTimes(1)
    })
  })

  // ================================
  // Step Transitions Tests
  // ================================
  describe('Step Transitions', () => {
    it('should handle transition from readyToInstall to installed', () => {
      const onStepChange = vi.fn()
      const { rerender } = render(
        <ReadyToInstall {...defaultProps} step={InstallStep.readyToInstall} onStepChange={onStepChange} />,
      )

      // Initially shows Install component
      expect(screen.getByTestId('install-step')).toBeInTheDocument()

      // Simulate successful installation
      fireEvent.click(screen.getByTestId('install-installed-btn'))

      expect(onStepChange).toHaveBeenCalledWith(InstallStep.installed)

      // Rerender with new step
      rerender(<ReadyToInstall {...defaultProps} step={InstallStep.installed} onStepChange={onStepChange} />)

      // Now shows Installed component
      expect(screen.getByTestId('installed-step')).toBeInTheDocument()
    })

    it('should handle transition from readyToInstall to installFailed', () => {
      const onStepChange = vi.fn()
      const { rerender } = render(
        <ReadyToInstall {...defaultProps} step={InstallStep.readyToInstall} onStepChange={onStepChange} />,
      )

      // Initially shows Install component
      expect(screen.getByTestId('install-step')).toBeInTheDocument()

      // Simulate failed installation
      fireEvent.click(screen.getByTestId('install-failed-btn'))

      expect(onStepChange).toHaveBeenCalledWith(InstallStep.installFailed)

      // Rerender with new step
      rerender(<ReadyToInstall {...defaultProps} step={InstallStep.installFailed} onStepChange={onStepChange} />)

      // Now shows Installed component with failed state
      expect(screen.getByTestId('installed-step')).toBeInTheDocument()
      expect(screen.getByTestId('installed-is-failed')).toHaveTextContent('true')
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle null manifest', () => {
      render(<ReadyToInstall {...defaultProps} step={InstallStep.installed} manifest={null} />)

      expect(screen.getByTestId('installed-payload-name')).toHaveTextContent('null')
    })

    it('should handle null errorMsg', () => {
      render(<ReadyToInstall {...defaultProps} step={InstallStep.installFailed} errorMsg={null} />)

      expect(screen.getByTestId('installed-err-msg')).toHaveTextContent('null')
    })

    it('should handle empty string errorMsg', () => {
      render(<ReadyToInstall {...defaultProps} step={InstallStep.installFailed} errorMsg="" />)

      expect(screen.getByTestId('installed-err-msg')).toHaveTextContent('null')
    })
  })

  // ================================
  // Callback Stability Tests
  // ================================
  describe('Callback Stability', () => {
    it('should maintain stable handleInstalled callback across re-renders', () => {
      const onStepChange = vi.fn()
      const setIsInstalling = vi.fn()
      const { rerender } = render(
        <ReadyToInstall
          {...defaultProps}
          onStepChange={onStepChange}
          setIsInstalling={setIsInstalling}
        />,
      )

      // Rerender with same props
      rerender(
        <ReadyToInstall
          {...defaultProps}
          onStepChange={onStepChange}
          setIsInstalling={setIsInstalling}
        />,
      )

      // Callback should still work
      fireEvent.click(screen.getByTestId('install-installed-btn'))

      expect(onStepChange).toHaveBeenCalledWith(InstallStep.installed)
      expect(setIsInstalling).toHaveBeenCalledWith(false)
    })

    it('should maintain stable handleFailed callback across re-renders', () => {
      const onStepChange = vi.fn()
      const setIsInstalling = vi.fn()
      const onError = vi.fn()
      const { rerender } = render(
        <ReadyToInstall
          {...defaultProps}
          onStepChange={onStepChange}
          setIsInstalling={setIsInstalling}
          onError={onError}
        />,
      )

      // Rerender with same props
      rerender(
        <ReadyToInstall
          {...defaultProps}
          onStepChange={onStepChange}
          setIsInstalling={setIsInstalling}
          onError={onError}
        />,
      )

      // Callback should still work
      fireEvent.click(screen.getByTestId('install-failed-msg-btn'))

      expect(onStepChange).toHaveBeenCalledWith(InstallStep.installFailed)
      expect(setIsInstalling).toHaveBeenCalledWith(false)
      expect(onError).toHaveBeenCalledWith('Error message')
    })
  })
})
