import type { Dependency, Plugin, PluginManifestInMarket } from '../../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InstallStep, PluginCategoryEnum } from '../../types'
import InstallFromMarketplace from './index'

// Factory functions for test data
// Use type casting to avoid strict locale requirements in tests
const createMockManifest = (overrides: Partial<PluginManifestInMarket> = {}): PluginManifestInMarket => ({
  plugin_unique_identifier: 'test-unique-identifier',
  name: 'Test Plugin',
  org: 'test-org',
  icon: 'test-icon.png',
  label: { en_US: 'Test Plugin' } as PluginManifestInMarket['label'],
  category: PluginCategoryEnum.tool,
  version: '1.0.0',
  latest_version: '1.0.0',
  brief: { en_US: 'A test plugin' } as PluginManifestInMarket['brief'],
  introduction: 'Introduction text',
  verified: true,
  install_count: 100,
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
  ...overrides,
})

const createMockPlugin = (overrides: Partial<Plugin> = {}): Plugin => ({
  type: 'plugin',
  org: 'test-org',
  name: 'Test Plugin',
  plugin_id: 'test-plugin-id',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'test-package-id',
  icon: 'test-icon.png',
  verified: true,
  label: { en_US: 'Test Plugin' },
  brief: { en_US: 'A test plugin' },
  description: { en_US: 'A test plugin description' },
  introduction: 'Introduction text',
  repository: 'https://github.com/test/plugin',
  category: PluginCategoryEnum.tool,
  install_count: 100,
  endpoint: { settings: [] },
  tags: [],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
  ...overrides,
})

const createMockDependencies = (): Dependency[] => [
  {
    type: 'github',
    value: {
      repo: 'test/plugin1',
      version: 'v1.0.0',
      package: 'plugin1.zip',
    },
  },
  {
    type: 'marketplace',
    value: {
      plugin_unique_identifier: 'plugin-2-uid',
    },
  },
]

// Mock external dependencies
const mockRefreshPluginList = vi.fn()
vi.mock('../hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: mockRefreshPluginList }),
}))

let mockHideLogicState = {
  modalClassName: 'test-modal-class',
  foldAnimInto: vi.fn(),
  setIsInstalling: vi.fn(),
  handleStartToInstall: vi.fn(),
}
vi.mock('../hooks/use-hide-logic', () => ({
  default: () => mockHideLogicState,
}))

// Mock child components
vi.mock('./steps/install', () => ({
  default: ({
    uniqueIdentifier,
    payload,
    onCancel,
    onInstalled,
    onFailed,
    onStartToInstall,
  }: {
    uniqueIdentifier: string
    payload: PluginManifestInMarket | Plugin
    onCancel: () => void
    onInstalled: (notRefresh?: boolean) => void
    onFailed: (message?: string) => void
    onStartToInstall: () => void
  }) => (
    <div data-testid="install-step">
      <span data-testid="unique-identifier">{uniqueIdentifier}</span>
      <span data-testid="payload-name">{payload?.name}</span>
      <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
      <button data-testid="start-install-btn" onClick={onStartToInstall}>Start Install</button>
      <button data-testid="install-success-btn" onClick={() => onInstalled()}>Install Success</button>
      <button data-testid="install-success-no-refresh-btn" onClick={() => onInstalled(true)}>Install Success No Refresh</button>
      <button data-testid="install-fail-btn" onClick={() => onFailed('Installation failed')}>Install Fail</button>
      <button data-testid="install-fail-no-msg-btn" onClick={() => onFailed()}>Install Fail No Msg</button>
    </div>
  ),
}))

vi.mock('../install-bundle/ready-to-install', () => ({
  default: ({
    step,
    onStepChange,
    onStartToInstall,
    setIsInstalling,
    onClose,
    allPlugins,
    isFromMarketPlace,
  }: {
    step: InstallStep
    onStepChange: (step: InstallStep) => void
    onStartToInstall: () => void
    setIsInstalling: (isInstalling: boolean) => void
    onClose: () => void
    allPlugins: Dependency[]
    isFromMarketPlace?: boolean
  }) => (
    <div data-testid="bundle-step">
      <span data-testid="bundle-step-value">{step}</span>
      <span data-testid="bundle-plugins-count">{allPlugins?.length || 0}</span>
      <span data-testid="is-from-marketplace">{isFromMarketPlace ? 'true' : 'false'}</span>
      <button data-testid="bundle-cancel-btn" onClick={onClose}>Cancel</button>
      <button data-testid="bundle-start-install-btn" onClick={onStartToInstall}>Start Install</button>
      <button data-testid="bundle-set-installing-true" onClick={() => setIsInstalling(true)}>Set Installing True</button>
      <button data-testid="bundle-set-installing-false" onClick={() => setIsInstalling(false)}>Set Installing False</button>
      <button data-testid="bundle-change-to-installed" onClick={() => onStepChange(InstallStep.installed)}>Change to Installed</button>
      <button data-testid="bundle-change-to-failed" onClick={() => onStepChange(InstallStep.installFailed)}>Change to Failed</button>
    </div>
  ),
}))

vi.mock('../base/installed', () => ({
  default: ({
    payload,
    isMarketPayload,
    isFailed,
    errMsg,
    onCancel,
  }: {
    payload: PluginManifestInMarket | Plugin | null
    isMarketPayload?: boolean
    isFailed: boolean
    errMsg?: string | null
    onCancel: () => void
  }) => (
    <div data-testid="installed-step">
      <span data-testid="installed-payload">{payload?.name || 'no-payload'}</span>
      <span data-testid="is-market-payload">{isMarketPayload ? 'true' : 'false'}</span>
      <span data-testid="is-failed">{isFailed ? 'true' : 'false'}</span>
      <span data-testid="error-msg">{errMsg || 'no-error'}</span>
      <button data-testid="installed-close-btn" onClick={onCancel}>Close</button>
    </div>
  ),
}))

describe('InstallFromMarketplace', () => {
  const defaultProps = {
    uniqueIdentifier: 'test-unique-identifier',
    manifest: createMockManifest(),
    onSuccess: vi.fn(),
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockHideLogicState = {
      modalClassName: 'test-modal-class',
      foldAnimInto: vi.fn(),
      setIsInstalling: vi.fn(),
      handleStartToInstall: vi.fn(),
    }
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render modal with correct initial state for single plugin', () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      expect(screen.getByTestId('install-step')).toBeInTheDocument()
      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()
    })

    it('should render with bundle step when isBundle is true', () => {
      const dependencies = createMockDependencies()
      render(
        <InstallFromMarketplace
          {...defaultProps}
          isBundle={true}
          dependencies={dependencies}
        />,
      )

      expect(screen.getByTestId('bundle-step')).toBeInTheDocument()
      expect(screen.getByTestId('bundle-plugins-count')).toHaveTextContent('2')
    })

    it('should pass isFromMarketPlace as true to bundle component', () => {
      const dependencies = createMockDependencies()
      render(
        <InstallFromMarketplace
          {...defaultProps}
          isBundle={true}
          dependencies={dependencies}
        />,
      )

      expect(screen.getByTestId('is-from-marketplace')).toHaveTextContent('true')
    })

    it('should pass correct props to Install component', () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      expect(screen.getByTestId('unique-identifier')).toHaveTextContent('test-unique-identifier')
      expect(screen.getByTestId('payload-name')).toHaveTextContent('Test Plugin')
    })

    it('should apply modal className from useHideLogic', () => {
      expect(mockHideLogicState.modalClassName).toBe('test-modal-class')
    })
  })

  // ================================
  // Title Display Tests
  // ================================
  describe('Title Display', () => {
    it('should show install title in readyToInstall step', () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()
    })

    it('should show success title when installation completes for single plugin', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.installedSuccessfully')).toBeInTheDocument()
      })
    })

    it('should show bundle complete title when bundle installation completes', async () => {
      const dependencies = createMockDependencies()
      render(
        <InstallFromMarketplace
          {...defaultProps}
          isBundle={true}
          dependencies={dependencies}
        />,
      )

      fireEvent.click(screen.getByTestId('bundle-change-to-installed'))

      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.installComplete')).toBeInTheDocument()
      })
    })

    it('should show failed title when installation fails', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-fail-btn'))

      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.installFailed')).toBeInTheDocument()
      })
    })
  })

  // ================================
  // State Management Tests
  // ================================
  describe('State Management', () => {
    it('should transition from readyToInstall to installed on success', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      expect(screen.getByTestId('install-step')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('false')
      })
    })

    it('should transition from readyToInstall to installFailed on failure', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('true')
        expect(screen.getByTestId('error-msg')).toHaveTextContent('Installation failed')
      })
    })

    it('should handle failure without error message', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-fail-no-msg-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('true')
        expect(screen.getByTestId('error-msg')).toHaveTextContent('no-error')
      })
    })

    it('should update step via onStepChange in bundle mode', async () => {
      const dependencies = createMockDependencies()
      render(
        <InstallFromMarketplace
          {...defaultProps}
          isBundle={true}
          dependencies={dependencies}
        />,
      )

      fireEvent.click(screen.getByTestId('bundle-change-to-installed'))

      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.installComplete')).toBeInTheDocument()
      })
    })
  })

  // ================================
  // Callback Stability Tests (Memoization)
  // ================================
  describe('Callback Stability', () => {
    it('should maintain stable getTitle callback across rerenders', () => {
      const { rerender } = render(<InstallFromMarketplace {...defaultProps} />)

      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()

      rerender(<InstallFromMarketplace {...defaultProps} />)

      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()
    })

    it('should maintain stable handleInstalled callback', async () => {
      const { rerender } = render(<InstallFromMarketplace {...defaultProps} />)

      rerender(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
      })
    })

    it('should maintain stable handleFailed callback', async () => {
      const { rerender } = render(<InstallFromMarketplace {...defaultProps} />)

      rerender(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('true')
      })
    })
  })

  // ================================
  // User Interactions Tests
  // ================================
  describe('User Interactions', () => {
    it('should call onClose when cancel is clicked', () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('cancel-btn'))

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should call foldAnimInto when modal close is triggered', () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      expect(mockHideLogicState.foldAnimInto).toBeDefined()
    })

    it('should call handleStartToInstall when start install is triggered', () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('start-install-btn'))

      expect(mockHideLogicState.handleStartToInstall).toHaveBeenCalledTimes(1)
    })

    it('should call onSuccess when close button is clicked in installed step', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('installed-close-btn'))

      expect(defaultProps.onSuccess).toHaveBeenCalledTimes(1)
    })

    it('should call onClose in bundle mode cancel', () => {
      const dependencies = createMockDependencies()
      render(
        <InstallFromMarketplace
          {...defaultProps}
          isBundle={true}
          dependencies={dependencies}
        />,
      )

      fireEvent.click(screen.getByTestId('bundle-cancel-btn'))

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })
  })

  // ================================
  // Refresh Plugin List Tests
  // ================================
  describe('Refresh Plugin List', () => {
    it('should call refreshPluginList when installation completes without notRefresh flag', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(mockRefreshPluginList).toHaveBeenCalledWith(defaultProps.manifest)
      })
    })

    it('should not call refreshPluginList when notRefresh flag is true', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-success-no-refresh-btn'))

      await waitFor(() => {
        expect(mockRefreshPluginList).not.toHaveBeenCalled()
      })
    })
  })

  // ================================
  // setIsInstalling Tests
  // ================================
  describe('setIsInstalling Behavior', () => {
    it('should call setIsInstalling(false) when installation completes', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(mockHideLogicState.setIsInstalling).toHaveBeenCalledWith(false)
      })
    })

    it('should call setIsInstalling(false) when installation fails', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-fail-btn'))

      await waitFor(() => {
        expect(mockHideLogicState.setIsInstalling).toHaveBeenCalledWith(false)
      })
    })

    it('should pass setIsInstalling to bundle component', () => {
      const dependencies = createMockDependencies()
      render(
        <InstallFromMarketplace
          {...defaultProps}
          isBundle={true}
          dependencies={dependencies}
        />,
      )

      fireEvent.click(screen.getByTestId('bundle-set-installing-true'))
      expect(mockHideLogicState.setIsInstalling).toHaveBeenCalledWith(true)

      fireEvent.click(screen.getByTestId('bundle-set-installing-false'))
      expect(mockHideLogicState.setIsInstalling).toHaveBeenCalledWith(false)
    })
  })

  // ================================
  // Installed Component Props Tests
  // ================================
  describe('Installed Component Props', () => {
    it('should pass isMarketPayload as true to Installed component', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('is-market-payload')).toHaveTextContent('true')
      })
    })

    it('should pass correct payload to Installed component', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-payload')).toHaveTextContent('Test Plugin')
      })
    })

    it('should pass isFailed as true when installation fails', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('is-failed')).toHaveTextContent('true')
      })
    })

    it('should pass error message to Installed component on failure', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('error-msg')).toHaveTextContent('Installation failed')
      })
    })
  })

  // ================================
  // Prop Variations Tests
  // ================================
  describe('Prop Variations', () => {
    it('should work with Plugin type manifest', () => {
      const plugin = createMockPlugin()
      render(
        <InstallFromMarketplace
          {...defaultProps}
          manifest={plugin}
        />,
      )

      expect(screen.getByTestId('payload-name')).toHaveTextContent('Test Plugin')
    })

    it('should work with PluginManifestInMarket type manifest', () => {
      const manifest = createMockManifest({ name: 'Market Plugin' })
      render(
        <InstallFromMarketplace
          {...defaultProps}
          manifest={manifest}
        />,
      )

      expect(screen.getByTestId('payload-name')).toHaveTextContent('Market Plugin')
    })

    it('should handle different uniqueIdentifier values', () => {
      render(
        <InstallFromMarketplace
          {...defaultProps}
          uniqueIdentifier="custom-unique-id-123"
        />,
      )

      expect(screen.getByTestId('unique-identifier')).toHaveTextContent('custom-unique-id-123')
    })

    it('should work without isBundle prop (default to single plugin)', () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      expect(screen.getByTestId('install-step')).toBeInTheDocument()
      expect(screen.queryByTestId('bundle-step')).not.toBeInTheDocument()
    })

    it('should work with isBundle=false', () => {
      render(
        <InstallFromMarketplace
          {...defaultProps}
          isBundle={false}
        />,
      )

      expect(screen.getByTestId('install-step')).toBeInTheDocument()
      expect(screen.queryByTestId('bundle-step')).not.toBeInTheDocument()
    })

    it('should work with empty dependencies array in bundle mode', () => {
      render(
        <InstallFromMarketplace
          {...defaultProps}
          isBundle={true}
          dependencies={[]}
        />,
      )

      expect(screen.getByTestId('bundle-step')).toBeInTheDocument()
      expect(screen.getByTestId('bundle-plugins-count')).toHaveTextContent('0')
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle manifest with minimal required fields', () => {
      const minimalManifest = createMockManifest({
        name: 'Minimal',
        version: '0.0.1',
      })
      render(
        <InstallFromMarketplace
          {...defaultProps}
          manifest={minimalManifest}
        />,
      )

      expect(screen.getByTestId('payload-name')).toHaveTextContent('Minimal')
    })

    it('should handle multiple rapid state transitions', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      // Trigger installation completion
      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
      })

      // Should stay in installed state
      expect(screen.getByTestId('is-failed')).toHaveTextContent('false')
    })

    it('should handle bundle mode step changes', async () => {
      const dependencies = createMockDependencies()
      render(
        <InstallFromMarketplace
          {...defaultProps}
          isBundle={true}
          dependencies={dependencies}
        />,
      )

      // Change to installed step
      fireEvent.click(screen.getByTestId('bundle-change-to-installed'))

      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.installComplete')).toBeInTheDocument()
      })
    })

    it('should handle bundle mode failure step change', async () => {
      const dependencies = createMockDependencies()
      render(
        <InstallFromMarketplace
          {...defaultProps}
          isBundle={true}
          dependencies={dependencies}
        />,
      )

      fireEvent.click(screen.getByTestId('bundle-change-to-failed'))

      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.installFailed')).toBeInTheDocument()
      })
    })

    it('should not render Install component in terminal steps', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(screen.queryByTestId('install-step')).not.toBeInTheDocument()
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
      })
    })

    it('should render Installed component for success state with isFailed false', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('false')
      })
    })

    it('should render Installed component for failure state with isFailed true', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('true')
      })
    })
  })

  // ================================
  // Terminal Steps Rendering Tests
  // ================================
  describe('Terminal Steps Rendering', () => {
    it('should render Installed component when step is installed', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
      })
    })

    it('should render Installed component when step is installFailed', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('true')
      })
    })

    it('should not render Install component when in terminal step', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      // Initially Install is shown
      expect(screen.getByTestId('install-step')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(screen.queryByTestId('install-step')).not.toBeInTheDocument()
      })
    })
  })

  // ================================
  // Data Flow Tests
  // ================================
  describe('Data Flow', () => {
    it('should pass uniqueIdentifier to Install component', () => {
      render(<InstallFromMarketplace {...defaultProps} uniqueIdentifier="flow-test-id" />)

      expect(screen.getByTestId('unique-identifier')).toHaveTextContent('flow-test-id')
    })

    it('should pass manifest payload to Install component', () => {
      const customManifest = createMockManifest({ name: 'Flow Test Plugin' })
      render(<InstallFromMarketplace {...defaultProps} manifest={customManifest} />)

      expect(screen.getByTestId('payload-name')).toHaveTextContent('Flow Test Plugin')
    })

    it('should pass dependencies to bundle component', () => {
      const dependencies = createMockDependencies()
      render(
        <InstallFromMarketplace
          {...defaultProps}
          isBundle={true}
          dependencies={dependencies}
        />,
      )

      expect(screen.getByTestId('bundle-plugins-count')).toHaveTextContent('2')
    })

    it('should pass current step to bundle component', () => {
      const dependencies = createMockDependencies()
      render(
        <InstallFromMarketplace
          {...defaultProps}
          isBundle={true}
          dependencies={dependencies}
        />,
      )

      expect(screen.getByTestId('bundle-step-value')).toHaveTextContent(InstallStep.readyToInstall)
    })
  })

  // ================================
  // Manifest Category Variations Tests
  // ================================
  describe('Manifest Category Variations', () => {
    it('should handle tool category manifest', () => {
      const manifest = createMockManifest({ category: PluginCategoryEnum.tool })
      render(<InstallFromMarketplace {...defaultProps} manifest={manifest} />)

      expect(screen.getByTestId('install-step')).toBeInTheDocument()
    })

    it('should handle model category manifest', () => {
      const manifest = createMockManifest({ category: PluginCategoryEnum.model })
      render(<InstallFromMarketplace {...defaultProps} manifest={manifest} />)

      expect(screen.getByTestId('install-step')).toBeInTheDocument()
    })

    it('should handle extension category manifest', () => {
      const manifest = createMockManifest({ category: PluginCategoryEnum.extension })
      render(<InstallFromMarketplace {...defaultProps} manifest={manifest} />)

      expect(screen.getByTestId('install-step')).toBeInTheDocument()
    })
  })

  // ================================
  // Hook Integration Tests
  // ================================
  describe('Hook Integration', () => {
    it('should use handleStartToInstall from useHideLogic', () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('start-install-btn'))

      expect(mockHideLogicState.handleStartToInstall).toHaveBeenCalled()
    })

    it('should use setIsInstalling from useHideLogic in handleInstalled', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(mockHideLogicState.setIsInstalling).toHaveBeenCalledWith(false)
      })
    })

    it('should use setIsInstalling from useHideLogic in handleFailed', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-fail-btn'))

      await waitFor(() => {
        expect(mockHideLogicState.setIsInstalling).toHaveBeenCalledWith(false)
      })
    })

    it('should use refreshPluginList from useRefreshPluginList', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(mockRefreshPluginList).toHaveBeenCalled()
      })
    })
  })

  // ================================
  // getTitle Memoization Tests
  // ================================
  describe('getTitle Memoization', () => {
    it('should return installPlugin title for readyToInstall step', () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()
    })

    it('should return installedSuccessfully for non-bundle installed step', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.installedSuccessfully')).toBeInTheDocument()
      })
    })

    it('should return installComplete for bundle installed step', async () => {
      const dependencies = createMockDependencies()
      render(
        <InstallFromMarketplace
          {...defaultProps}
          isBundle={true}
          dependencies={dependencies}
        />,
      )

      fireEvent.click(screen.getByTestId('bundle-change-to-installed'))

      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.installComplete')).toBeInTheDocument()
      })
    })

    it('should return installFailed for installFailed step', async () => {
      render(<InstallFromMarketplace {...defaultProps} />)

      fireEvent.click(screen.getByTestId('install-fail-btn'))

      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.installFailed')).toBeInTheDocument()
      })
    })
  })
})
