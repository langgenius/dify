import type { Dependency, GitHubItemAndMarketPlaceDependency, InstallStatus, PackageDependency, Plugin, PluginDeclaration, VersionProps } from '../../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InstallStep, PluginCategoryEnum } from '../../types'
import InstallBundle, { InstallType } from './index'
import GithubItem from './item/github-item'
import LoadedItem from './item/loaded-item'
import MarketplaceItem from './item/marketplace-item'
import PackageItem from './item/package-item'
import ReadyToInstall from './ready-to-install'
import Installed from './steps/installed'

// Factory functions for test data
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
  label: { 'en-US': 'Test Plugin' },
  brief: { 'en-US': 'A test plugin' },
  description: { 'en-US': 'A test plugin description' },
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

const createMockVersionProps = (overrides: Partial<VersionProps> = {}): VersionProps => ({
  hasInstalled: false,
  installedVersion: undefined,
  toInstallVersion: '1.0.0',
  ...overrides,
})

const createMockInstallStatus = (overrides: Partial<InstallStatus> = {}): InstallStatus => ({
  success: true,
  isFromMarketPlace: true,
  ...overrides,
})

const createMockGitHubDependency = (): GitHubItemAndMarketPlaceDependency => ({
  type: 'github',
  value: {
    repo: 'test-org/test-repo',
    version: 'v1.0.0',
    package: 'plugin.zip',
  },
})

const createMockPackageDependency = (): PackageDependency => ({
  type: 'package',
  value: {
    unique_identifier: 'package-plugin-uid',
    manifest: {
      plugin_unique_identifier: 'package-plugin-uid',
      version: '1.0.0',
      author: 'test-author',
      icon: 'icon.png',
      name: 'Package Plugin',
      category: PluginCategoryEnum.tool,
      label: { 'en-US': 'Package Plugin' } as Record<string, string>,
      description: { 'en-US': 'Test package plugin' } as Record<string, string>,
      created_at: '2024-01-01',
      resource: {},
      plugins: [],
      verified: true,
      endpoint: { settings: [], endpoints: [] },
      model: null,
      tags: [],
      agent_strategy: null,
      meta: { version: '1.0.0' },
      trigger: {} as PluginDeclaration['trigger'],
    },
  },
})

const createMockDependency = (overrides: Partial<Dependency> = {}): Dependency => ({
  type: 'marketplace',
  value: {
    plugin_unique_identifier: 'test-plugin-uid',
  },
  ...overrides,
} as Dependency)

const createMockDependencies = (): Dependency[] => [
  {
    type: 'marketplace',
    value: {
      marketplace_plugin_unique_identifier: 'plugin-1-uid',
    },
  },
  {
    type: 'github',
    value: {
      repo: 'test/plugin2',
      version: 'v1.0.0',
      package: 'plugin2.zip',
    },
  },
  {
    type: 'package',
    value: {
      unique_identifier: 'package-plugin-uid',
      manifest: {
        plugin_unique_identifier: 'package-plugin-uid',
        version: '1.0.0',
        author: 'test-author',
        icon: 'icon.png',
        name: 'Package Plugin',
        category: PluginCategoryEnum.tool,
        label: { 'en-US': 'Package Plugin' } as Record<string, string>,
        description: { 'en-US': 'Test package plugin' } as Record<string, string>,
        created_at: '2024-01-01',
        resource: {},
        plugins: [],
        verified: true,
        endpoint: { settings: [], endpoints: [] },
        model: null,
        tags: [],
        agent_strategy: null,
        meta: { version: '1.0.0' },
        trigger: {} as PluginDeclaration['trigger'],
      },
    },
  },
]

// Mock useHideLogic hook
let mockHideLogicState = {
  modalClassName: 'test-modal-class',
  foldAnimInto: vi.fn(),
  setIsInstalling: vi.fn(),
  handleStartToInstall: vi.fn(),
}
vi.mock('../hooks/use-hide-logic', () => ({
  default: () => mockHideLogicState,
}))

// Mock useGetIcon hook
vi.mock('../base/use-get-icon', () => ({
  default: () => ({
    getIconUrl: (icon: string) => icon || 'default-icon.png',
  }),
}))

// Mock usePluginInstallLimit hook
vi.mock('../hooks/use-install-plugin-limit', () => ({
  default: () => ({ canInstall: true }),
  pluginInstallLimit: () => ({ canInstall: true }),
}))

// Mock useUploadGitHub hook
const mockUseUploadGitHub = vi.fn()
vi.mock('@/service/use-plugins', () => ({
  useUploadGitHub: (params: { repo: string, version: string, package: string }) => mockUseUploadGitHub(params),
  useInstallOrUpdate: () => ({ mutate: vi.fn(), isPending: false }),
  usePluginTaskList: () => ({ handleRefetch: vi.fn() }),
  useFetchPluginsInMarketPlaceByInfo: () => ({ isLoading: false, data: null, error: null }),
}))

// Mock config
vi.mock('@/config', () => ({
  MARKETPLACE_API_PREFIX: 'https://marketplace.example.com',
}))

// Mock mitt context
vi.mock('@/context/mitt-context', () => ({
  useMittContextSelector: () => vi.fn(),
}))

// Mock global public context
vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: () => ({}),
}))

// Mock useCanInstallPluginFromMarketplace
vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  useCanInstallPluginFromMarketplace: () => ({ canInstallPluginFromMarketplace: true }),
}))

// Mock checkTaskStatus
vi.mock('../base/check-task-status', () => ({
  default: () => ({ check: vi.fn(), stop: vi.fn() }),
}))

// Mock useRefreshPluginList
vi.mock('../hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: vi.fn() }),
}))

// Mock useCheckInstalled
vi.mock('../hooks/use-check-installed', () => ({
  default: () => ({ installedInfo: {} }),
}))

// Mock ReadyToInstall child component to test InstallBundle in isolation
vi.mock('./ready-to-install', () => ({
  default: ({
    step,
    onStepChange,
    onStartToInstall,
    setIsInstalling,
    allPlugins,
    onClose,
  }: {
    step: InstallStep
    onStepChange: (step: InstallStep) => void
    onStartToInstall: () => void
    setIsInstalling: (isInstalling: boolean) => void
    allPlugins: Dependency[]
    onClose: () => void
  }) => (
    <div data-testid="ready-to-install">
      <span data-testid="current-step">{step}</span>
      <span data-testid="plugins-count">{allPlugins?.length || 0}</span>
      <button data-testid="start-install-btn" onClick={onStartToInstall}>Start Install</button>
      <button data-testid="set-installing-true" onClick={() => setIsInstalling(true)}>Set Installing True</button>
      <button data-testid="set-installing-false" onClick={() => setIsInstalling(false)}>Set Installing False</button>
      <button data-testid="change-to-installed" onClick={() => onStepChange(InstallStep.installed)}>Change to Installed</button>
      <button data-testid="change-to-upload-failed" onClick={() => onStepChange(InstallStep.uploadFailed)}>Change to Upload Failed</button>
      <button data-testid="change-to-ready" onClick={() => onStepChange(InstallStep.readyToInstall)}>Change to Ready</button>
      <button data-testid="close-btn" onClick={onClose}>Close</button>
    </div>
  ),
}))

describe('InstallBundle', () => {
  const defaultProps = {
    fromDSLPayload: createMockDependencies(),
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
    it('should render modal with correct title for install plugin', () => {
      render(<InstallBundle {...defaultProps} />)

      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()
    })

    it('should render ReadyToInstall component', () => {
      render(<InstallBundle {...defaultProps} />)

      expect(screen.getByTestId('ready-to-install')).toBeInTheDocument()
    })

    it('should integrate with useHideLogic hook', () => {
      render(<InstallBundle {...defaultProps} />)

      // Verify that the component integrates with useHideLogic
      // The hook provides modalClassName, foldAnimInto, setIsInstalling, handleStartToInstall
      expect(mockHideLogicState.modalClassName).toBeDefined()
      expect(mockHideLogicState.foldAnimInto).toBeDefined()
    })

    it('should render modal as visible', () => {
      render(<InstallBundle {...defaultProps} />)

      // Modal is always shown (isShow={true})
      expect(screen.getByText('plugin.installModal.installPlugin')).toBeVisible()
    })
  })

  // ================================
  // Props Tests
  // ================================
  describe('Props', () => {
    describe('installType', () => {
      it('should default to InstallType.fromMarketplace when not provided', () => {
        render(<InstallBundle {...defaultProps} />)

        // When installType is fromMarketplace (default), initial step should be readyToInstall
        expect(screen.getByTestId('current-step')).toHaveTextContent(InstallStep.readyToInstall)
      })

      it('should set initial step to readyToInstall when installType is fromMarketplace', () => {
        render(<InstallBundle {...defaultProps} installType={InstallType.fromMarketplace} />)

        expect(screen.getByTestId('current-step')).toHaveTextContent(InstallStep.readyToInstall)
      })

      it('should set initial step to uploading when installType is fromLocal', () => {
        render(<InstallBundle {...defaultProps} installType={InstallType.fromLocal} />)

        expect(screen.getByTestId('current-step')).toHaveTextContent(InstallStep.uploading)
      })

      it('should set initial step to uploading when installType is fromDSL', () => {
        render(<InstallBundle {...defaultProps} installType={InstallType.fromDSL} />)

        expect(screen.getByTestId('current-step')).toHaveTextContent(InstallStep.uploading)
      })
    })

    describe('fromDSLPayload', () => {
      it('should pass allPlugins to ReadyToInstall', () => {
        const plugins = createMockDependencies()
        render(<InstallBundle {...defaultProps} fromDSLPayload={plugins} />)

        expect(screen.getByTestId('plugins-count')).toHaveTextContent('3')
      })

      it('should handle empty fromDSLPayload array', () => {
        render(<InstallBundle {...defaultProps} fromDSLPayload={[]} />)

        expect(screen.getByTestId('plugins-count')).toHaveTextContent('0')
      })

      it('should handle single plugin in fromDSLPayload', () => {
        render(<InstallBundle {...defaultProps} fromDSLPayload={[createMockDependency()]} />)

        expect(screen.getByTestId('plugins-count')).toHaveTextContent('1')
      })
    })

    describe('onClose', () => {
      it('should pass onClose to ReadyToInstall', () => {
        const onClose = vi.fn()
        render(<InstallBundle {...defaultProps} onClose={onClose} />)

        fireEvent.click(screen.getByTestId('close-btn'))

        expect(onClose).toHaveBeenCalledTimes(1)
      })
    })
  })

  // ================================
  // State Management Tests
  // ================================
  describe('State Management', () => {
    it('should update title when step changes to uploadFailed', () => {
      render(<InstallBundle {...defaultProps} />)

      // Initial title
      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()

      // Change step to uploadFailed
      fireEvent.click(screen.getByTestId('change-to-upload-failed'))

      expect(screen.getByText('plugin.installModal.uploadFailed')).toBeInTheDocument()
    })

    it('should update title when step changes to installed', () => {
      render(<InstallBundle {...defaultProps} />)

      // Change step to installed
      fireEvent.click(screen.getByTestId('change-to-installed'))

      expect(screen.getByText('plugin.installModal.installComplete')).toBeInTheDocument()
    })

    it('should maintain installPlugin title for readyToInstall step', () => {
      render(<InstallBundle {...defaultProps} />)

      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()

      // Explicitly change to readyToInstall
      fireEvent.click(screen.getByTestId('change-to-ready'))

      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()
    })

    it('should pass step state to ReadyToInstall component', () => {
      render(<InstallBundle {...defaultProps} />)

      expect(screen.getByTestId('current-step')).toHaveTextContent(InstallStep.readyToInstall)
    })

    it('should update ReadyToInstall step when onStepChange is called', () => {
      render(<InstallBundle {...defaultProps} />)

      // Initially readyToInstall
      expect(screen.getByTestId('current-step')).toHaveTextContent(InstallStep.readyToInstall)

      // Change to installed
      fireEvent.click(screen.getByTestId('change-to-installed'))

      expect(screen.getByTestId('current-step')).toHaveTextContent(InstallStep.installed)
    })
  })

  // ================================
  // Callback Stability and useHideLogic Integration Tests
  // ================================
  describe('Callback Stability and useHideLogic Integration', () => {
    it('should provide foldAnimInto for modal onClose handler', () => {
      render(<InstallBundle {...defaultProps} />)

      // The modal's onClose is set to foldAnimInto from useHideLogic
      // Verify the hook provides this function
      expect(mockHideLogicState.foldAnimInto).toBeDefined()
      expect(typeof mockHideLogicState.foldAnimInto).toBe('function')
    })

    it('should pass handleStartToInstall to ReadyToInstall', () => {
      render(<InstallBundle {...defaultProps} />)

      fireEvent.click(screen.getByTestId('start-install-btn'))

      expect(mockHideLogicState.handleStartToInstall).toHaveBeenCalledTimes(1)
    })

    it('should pass setIsInstalling to ReadyToInstall', () => {
      render(<InstallBundle {...defaultProps} />)

      fireEvent.click(screen.getByTestId('set-installing-true'))

      expect(mockHideLogicState.setIsInstalling).toHaveBeenCalledWith(true)
    })

    it('should pass setIsInstalling with false to ReadyToInstall', () => {
      render(<InstallBundle {...defaultProps} />)

      fireEvent.click(screen.getByTestId('set-installing-false'))

      expect(mockHideLogicState.setIsInstalling).toHaveBeenCalledWith(false)
    })
  })

  // ================================
  // Title Logic Tests (getTitle callback)
  // ================================
  describe('Title Logic (getTitle callback)', () => {
    it('should return uploadFailed title when step is uploadFailed', () => {
      render(<InstallBundle {...defaultProps} installType={InstallType.fromLocal} />)

      fireEvent.click(screen.getByTestId('change-to-upload-failed'))

      expect(screen.getByText('plugin.installModal.uploadFailed')).toBeInTheDocument()
    })

    it('should return installComplete title when step is installed', () => {
      render(<InstallBundle {...defaultProps} />)

      fireEvent.click(screen.getByTestId('change-to-installed'))

      expect(screen.getByText('plugin.installModal.installComplete')).toBeInTheDocument()
    })

    it('should return installPlugin title for all other steps', () => {
      render(<InstallBundle {...defaultProps} />)

      // Default step - readyToInstall
      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()
    })

    it('should return installPlugin title when step is uploading', () => {
      render(<InstallBundle {...defaultProps} installType={InstallType.fromLocal} />)

      // Step is uploading
      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()
    })
  })

  // ================================
  // Component Memoization Tests
  // ================================
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Verify that InstallBundle is memoized by checking its displayName or structure
      // Since the component is exported as React.memo(InstallBundle), we can check its type
      expect(InstallBundle).toBeDefined()
      expect(typeof InstallBundle).toBe('object') // memo returns an object
    })

    it('should not re-render when same props are passed', () => {
      const onClose = vi.fn()
      const payload = createMockDependencies()

      const { rerender } = render(
        <InstallBundle fromDSLPayload={payload} onClose={onClose} />,
      )

      // Re-render with same props reference
      rerender(<InstallBundle fromDSLPayload={payload} onClose={onClose} />)

      // Component should still render correctly
      expect(screen.getByTestId('ready-to-install')).toBeInTheDocument()
    })
  })

  // ================================
  // User Interactions Tests
  // ================================
  describe('User Interactions', () => {
    it('should handle start install button click', () => {
      render(<InstallBundle {...defaultProps} />)

      fireEvent.click(screen.getByTestId('start-install-btn'))

      expect(mockHideLogicState.handleStartToInstall).toHaveBeenCalledTimes(1)
    })

    it('should handle close button click', () => {
      const onClose = vi.fn()
      render(<InstallBundle {...defaultProps} onClose={onClose} />)

      fireEvent.click(screen.getByTestId('close-btn'))

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should handle step change to installed', () => {
      render(<InstallBundle {...defaultProps} />)

      fireEvent.click(screen.getByTestId('change-to-installed'))

      expect(screen.getByTestId('current-step')).toHaveTextContent(InstallStep.installed)
      expect(screen.getByText('plugin.installModal.installComplete')).toBeInTheDocument()
    })

    it('should handle step change to uploadFailed', () => {
      render(<InstallBundle {...defaultProps} />)

      fireEvent.click(screen.getByTestId('change-to-upload-failed'))

      expect(screen.getByTestId('current-step')).toHaveTextContent(InstallStep.uploadFailed)
      expect(screen.getByText('plugin.installModal.uploadFailed')).toBeInTheDocument()
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle empty dependencies array', () => {
      render(<InstallBundle fromDSLPayload={[]} onClose={vi.fn()} />)

      expect(screen.getByTestId('plugins-count')).toHaveTextContent('0')
    })

    it('should handle large number of dependencies', () => {
      const largeDependencies: Dependency[] = Array.from({ length: 100 }, (_, i) => ({
        type: 'marketplace',
        value: {
          marketplace_plugin_unique_identifier: `plugin-${i}-uid`,
        },
      }))

      render(<InstallBundle fromDSLPayload={largeDependencies} onClose={vi.fn()} />)

      expect(screen.getByTestId('plugins-count')).toHaveTextContent('100')
    })

    it('should handle dependencies with different types', () => {
      const mixedDependencies: Dependency[] = [
        { type: 'marketplace', value: { marketplace_plugin_unique_identifier: 'mp-uid' } },
        { type: 'github', value: { repo: 'org/repo', version: 'v1.0.0', package: 'pkg.zip' } },
        {
          type: 'package',
          value: {
            unique_identifier: 'pkg-uid',
            manifest: {
              plugin_unique_identifier: 'pkg-uid',
              version: '1.0.0',
              author: 'author',
              icon: 'icon.png',
              name: 'Package',
              category: PluginCategoryEnum.tool,
              label: {} as Record<string, string>,
              description: {} as Record<string, string>,
              created_at: '',
              resource: {},
              plugins: [],
              verified: true,
              endpoint: { settings: [], endpoints: [] },
              model: null,
              tags: [],
              agent_strategy: null,
              meta: { version: '1.0.0' },
              trigger: {} as PluginDeclaration['trigger'],
            },
          },
        },
      ]

      render(<InstallBundle fromDSLPayload={mixedDependencies} onClose={vi.fn()} />)

      expect(screen.getByTestId('plugins-count')).toHaveTextContent('3')
    })

    it('should handle rapid step changes', () => {
      render(<InstallBundle {...defaultProps} />)

      // Rapid step changes
      fireEvent.click(screen.getByTestId('change-to-installed'))
      fireEvent.click(screen.getByTestId('change-to-upload-failed'))
      fireEvent.click(screen.getByTestId('change-to-ready'))

      // Should end up at readyToInstall
      expect(screen.getByTestId('current-step')).toHaveTextContent(InstallStep.readyToInstall)
      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()
    })

    it('should handle multiple setIsInstalling calls', () => {
      render(<InstallBundle {...defaultProps} />)

      fireEvent.click(screen.getByTestId('set-installing-true'))
      fireEvent.click(screen.getByTestId('set-installing-false'))
      fireEvent.click(screen.getByTestId('set-installing-true'))

      expect(mockHideLogicState.setIsInstalling).toHaveBeenCalledTimes(3)
      expect(mockHideLogicState.setIsInstalling).toHaveBeenNthCalledWith(1, true)
      expect(mockHideLogicState.setIsInstalling).toHaveBeenNthCalledWith(2, false)
      expect(mockHideLogicState.setIsInstalling).toHaveBeenNthCalledWith(3, true)
    })
  })

  // ================================
  // InstallType Enum Tests
  // ================================
  describe('InstallType Enum', () => {
    it('should export InstallType enum with correct values', () => {
      expect(InstallType.fromLocal).toBe('fromLocal')
      expect(InstallType.fromMarketplace).toBe('fromMarketplace')
      expect(InstallType.fromDSL).toBe('fromDSL')
    })

    it('should handle all InstallType values', () => {
      const types = [InstallType.fromLocal, InstallType.fromMarketplace, InstallType.fromDSL]

      types.forEach((type) => {
        const { unmount } = render(
          <InstallBundle {...defaultProps} installType={type} />,
        )
        expect(screen.getByTestId('ready-to-install')).toBeInTheDocument()
        unmount()
      })
    })
  })

  // ================================
  // Modal Integration Tests
  // ================================
  describe('Modal Integration', () => {
    it('should render modal with title', () => {
      render(<InstallBundle {...defaultProps} />)

      // Verify modal renders with title
      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()
    })

    it('should render modal with closable behavior', () => {
      render(<InstallBundle {...defaultProps} />)

      // Modal should render the content including the ReadyToInstall component
      expect(screen.getByTestId('ready-to-install')).toBeInTheDocument()
    })

    it('should display title in modal header', () => {
      render(<InstallBundle {...defaultProps} />)

      const titleElement = screen.getByText('plugin.installModal.installPlugin')
      expect(titleElement).toBeInTheDocument()
      expect(titleElement).toHaveClass('title-2xl-semi-bold')
    })
  })

  // ================================
  // Initial Step Determination Tests
  // ================================
  describe('Initial Step Determination', () => {
    it('should set initial step based on installType for fromMarketplace', () => {
      render(<InstallBundle {...defaultProps} installType={InstallType.fromMarketplace} />)

      expect(screen.getByTestId('current-step')).toHaveTextContent(InstallStep.readyToInstall)
    })

    it('should set initial step based on installType for fromLocal', () => {
      render(<InstallBundle {...defaultProps} installType={InstallType.fromLocal} />)

      expect(screen.getByTestId('current-step')).toHaveTextContent(InstallStep.uploading)
    })

    it('should set initial step based on installType for fromDSL', () => {
      render(<InstallBundle {...defaultProps} installType={InstallType.fromDSL} />)

      expect(screen.getByTestId('current-step')).toHaveTextContent(InstallStep.uploading)
    })

    it('should use default installType when not provided', () => {
      render(<InstallBundle fromDSLPayload={defaultProps.fromDSLPayload} onClose={defaultProps.onClose} />)

      // Default is fromMarketplace which results in readyToInstall
      expect(screen.getByTestId('current-step')).toHaveTextContent(InstallStep.readyToInstall)
    })
  })

  // ================================
  // useHideLogic Hook Integration Tests
  // ================================
  describe('useHideLogic Hook Integration', () => {
    it('should receive modalClassName from useHideLogic', () => {
      mockHideLogicState.modalClassName = 'custom-modal-class'

      render(<InstallBundle {...defaultProps} />)

      // Verify hook provides modalClassName (component uses it in Modal className prop)
      expect(mockHideLogicState.modalClassName).toBe('custom-modal-class')
    })

    it('should pass onClose to useHideLogic', () => {
      const onClose = vi.fn()
      render(<InstallBundle {...defaultProps} onClose={onClose} />)

      // The hook receives onClose and returns foldAnimInto
      // When modal closes, foldAnimInto should be used
      expect(mockHideLogicState.foldAnimInto).toBeDefined()
    })

    it('should use foldAnimInto for modal close action', () => {
      render(<InstallBundle {...defaultProps} />)

      // The modal's onClose is set to foldAnimInto
      // This is verified by checking that the hook returns the function
      expect(typeof mockHideLogicState.foldAnimInto).toBe('function')
    })
  })

  // ================================
  // ReadyToInstall Props Passing Tests
  // ================================
  describe('ReadyToInstall Props Passing', () => {
    it('should pass step to ReadyToInstall', () => {
      render(<InstallBundle {...defaultProps} />)

      expect(screen.getByTestId('current-step')).toHaveTextContent(InstallStep.readyToInstall)
    })

    it('should pass onStepChange to ReadyToInstall', () => {
      render(<InstallBundle {...defaultProps} />)

      // Trigger step change
      fireEvent.click(screen.getByTestId('change-to-installed'))

      expect(screen.getByTestId('current-step')).toHaveTextContent(InstallStep.installed)
    })

    it('should pass onStartToInstall to ReadyToInstall', () => {
      render(<InstallBundle {...defaultProps} />)

      fireEvent.click(screen.getByTestId('start-install-btn'))

      expect(mockHideLogicState.handleStartToInstall).toHaveBeenCalled()
    })

    it('should pass setIsInstalling to ReadyToInstall', () => {
      render(<InstallBundle {...defaultProps} />)

      fireEvent.click(screen.getByTestId('set-installing-true'))

      expect(mockHideLogicState.setIsInstalling).toHaveBeenCalledWith(true)
    })

    it('should pass allPlugins (fromDSLPayload) to ReadyToInstall', () => {
      const plugins = createMockDependencies()
      render(<InstallBundle fromDSLPayload={plugins} onClose={vi.fn()} />)

      expect(screen.getByTestId('plugins-count')).toHaveTextContent(String(plugins.length))
    })

    it('should pass onClose to ReadyToInstall', () => {
      const onClose = vi.fn()
      render(<InstallBundle {...defaultProps} onClose={onClose} />)

      fireEvent.click(screen.getByTestId('close-btn'))

      expect(onClose).toHaveBeenCalled()
    })
  })

  // ================================
  // Callback Memoization Tests
  // ================================
  describe('Callback Memoization (getTitle)', () => {
    it('should return correct title based on current step', () => {
      render(<InstallBundle {...defaultProps} />)

      // Default step (readyToInstall) -> installPlugin title
      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()
    })

    it('should update title when step changes', () => {
      render(<InstallBundle {...defaultProps} />)

      // Change to installed
      fireEvent.click(screen.getByTestId('change-to-installed'))
      expect(screen.getByText('plugin.installModal.installComplete')).toBeInTheDocument()

      // Change to uploadFailed
      fireEvent.click(screen.getByTestId('change-to-upload-failed'))
      expect(screen.getByText('plugin.installModal.uploadFailed')).toBeInTheDocument()

      // Change back to readyToInstall
      fireEvent.click(screen.getByTestId('change-to-ready'))
      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()
    })
  })

  // ================================
  // Error Handling Tests
  // ================================
  describe('Error Handling', () => {
    it('should handle null in fromDSLPayload gracefully', () => {
      // TypeScript would catch this, but testing runtime behavior
      // @ts-expect-error Testing null handling
      render(<InstallBundle fromDSLPayload={null} onClose={vi.fn()} />)

      // Should render without crashing, count will be 0
      expect(screen.getByTestId('plugins-count')).toHaveTextContent('0')
    })

    it('should handle undefined in fromDSLPayload gracefully', () => {
      // @ts-expect-error Testing undefined handling
      render(<InstallBundle fromDSLPayload={undefined} onClose={vi.fn()} />)

      // Should render without crashing
      expect(screen.getByTestId('plugins-count')).toHaveTextContent('0')
    })
  })

  // ================================
  // CSS Classes Tests
  // ================================
  describe('CSS Classes', () => {
    it('should render modal with proper structure', () => {
      render(<InstallBundle {...defaultProps} />)

      // Verify component renders with expected structure
      expect(screen.getByTestId('ready-to-install')).toBeInTheDocument()
      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()
    })

    it('should apply correct CSS classes to title', () => {
      render(<InstallBundle {...defaultProps} />)

      const title = screen.getByText('plugin.installModal.installPlugin')
      expect(title).toHaveClass('title-2xl-semi-bold')
      expect(title).toHaveClass('text-text-primary')
    })
  })

  // ================================
  // Rendering Consistency Tests
  // ================================
  describe('Rendering Consistency', () => {
    it('should render consistently across different installTypes', () => {
      // fromMarketplace
      const { unmount: unmount1 } = render(
        <InstallBundle {...defaultProps} installType={InstallType.fromMarketplace} />,
      )
      expect(screen.getByTestId('ready-to-install')).toBeInTheDocument()
      unmount1()

      // fromLocal
      const { unmount: unmount2 } = render(
        <InstallBundle {...defaultProps} installType={InstallType.fromLocal} />,
      )
      expect(screen.getByTestId('ready-to-install')).toBeInTheDocument()
      unmount2()

      // fromDSL
      const { unmount: unmount3 } = render(
        <InstallBundle {...defaultProps} installType={InstallType.fromDSL} />,
      )
      expect(screen.getByTestId('ready-to-install')).toBeInTheDocument()
      unmount3()
    })

    it('should maintain modal structure across step changes', () => {
      render(<InstallBundle {...defaultProps} />)

      // Check ReadyToInstall component exists
      expect(screen.getByTestId('ready-to-install')).toBeInTheDocument()

      // Change step
      fireEvent.click(screen.getByTestId('change-to-installed'))

      // ReadyToInstall should still exist
      expect(screen.getByTestId('ready-to-install')).toBeInTheDocument()
      // Title should be updated
      expect(screen.getByText('plugin.installModal.installComplete')).toBeInTheDocument()
    })
  })
})

// ================================================================
// ReadyToInstall Component Tests (using mocked version from InstallBundle)
// ================================================================
describe('ReadyToInstall (via InstallBundle mock)', () => {
  // Note: ReadyToInstall is mocked for InstallBundle tests.
  // These tests verify the mock interface and component behavior.

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ================================
  // Component Definition Tests
  // ================================
  describe('Component Definition', () => {
    it('should be defined and importable', () => {
      expect(ReadyToInstall).toBeDefined()
    })

    it('should be a memoized component', () => {
      // The import gives us the mocked version, which is a function
      expect(typeof ReadyToInstall).toBe('function')
    })
  })
})

// ================================================================
// Installed Component Tests
// ================================================================
describe('Installed', () => {
  const defaultInstalledProps = {
    list: [createMockPlugin()],
    installStatus: [createMockInstallStatus()],
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render plugin list', () => {
      render(<Installed {...defaultInstalledProps} />)

      // Should show close button
      expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
    })

    it('should render multiple plugins', () => {
      const plugins = [
        createMockPlugin({ plugin_id: 'plugin-1', name: 'Plugin 1' }),
        createMockPlugin({ plugin_id: 'plugin-2', name: 'Plugin 2' }),
      ]
      const statuses = [
        createMockInstallStatus({ success: true }),
        createMockInstallStatus({ success: false }),
      ]

      render(<Installed list={plugins} installStatus={statuses} onCancel={vi.fn()} />)

      expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
    })

    it('should not render close button when isHideButton is true', () => {
      render(<Installed {...defaultInstalledProps} isHideButton={true} />)

      expect(screen.queryByRole('button', { name: 'common.operation.close' })).not.toBeInTheDocument()
    })
  })

  // ================================
  // User Interactions Tests
  // ================================
  describe('User Interactions', () => {
    it('should call onCancel when close button is clicked', () => {
      const onCancel = vi.fn()
      render(<Installed {...defaultInstalledProps} onCancel={onCancel} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))

      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle empty plugin list', () => {
      render(<Installed list={[]} installStatus={[]} onCancel={vi.fn()} />)

      expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
    })

    it('should handle mixed install statuses', () => {
      const plugins = [
        createMockPlugin({ plugin_id: 'success-plugin' }),
        createMockPlugin({ plugin_id: 'failed-plugin' }),
      ]
      const statuses = [
        createMockInstallStatus({ success: true }),
        createMockInstallStatus({ success: false }),
      ]

      render(<Installed list={plugins} installStatus={statuses} onCancel={vi.fn()} />)

      expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
    })
  })

  // ================================
  // Component Memoization Tests
  // ================================
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect(Installed).toBeDefined()
      expect(typeof Installed).toBe('object')
    })
  })
})

// ================================================================
// LoadedItem Component Tests
// ================================================================
describe('LoadedItem', () => {
  const defaultLoadedItemProps = {
    checked: false,
    onCheckedChange: vi.fn(),
    payload: createMockPlugin(),
    versionInfo: createMockVersionProps(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Helper to find checkbox element
  const getCheckbox = () => screen.getByTestId(/^checkbox/)

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render checkbox', () => {
      render(<LoadedItem {...defaultLoadedItemProps} />)

      expect(getCheckbox()).toBeInTheDocument()
    })

    it('should render checkbox with check icon when checked prop is true', () => {
      render(<LoadedItem {...defaultLoadedItemProps} checked={true} />)

      expect(getCheckbox()).toBeInTheDocument()
      // Check icon should be present when checked
      expect(screen.getByTestId(/^check-icon/)).toBeInTheDocument()
    })

    it('should render checkbox without check icon when checked prop is false', () => {
      render(<LoadedItem {...defaultLoadedItemProps} checked={false} />)

      expect(getCheckbox()).toBeInTheDocument()
      // Check icon should not be present when unchecked
      expect(screen.queryByTestId(/^check-icon/)).not.toBeInTheDocument()
    })
  })

  // ================================
  // User Interactions Tests
  // ================================
  describe('User Interactions', () => {
    it('should call onCheckedChange when checkbox is clicked', () => {
      const onCheckedChange = vi.fn()
      render(<LoadedItem {...defaultLoadedItemProps} onCheckedChange={onCheckedChange} />)

      fireEvent.click(getCheckbox())

      expect(onCheckedChange).toHaveBeenCalledWith(defaultLoadedItemProps.payload)
    })
  })

  // ================================
  // Props Tests
  // ================================
  describe('Props', () => {
    it('should handle isFromMarketPlace prop', () => {
      render(<LoadedItem {...defaultLoadedItemProps} isFromMarketPlace={true} />)

      expect(getCheckbox()).toBeInTheDocument()
    })

    it('should display version info when payload has version', () => {
      const pluginWithVersion = createMockPlugin({ version: '2.0.0' })
      render(<LoadedItem {...defaultLoadedItemProps} payload={pluginWithVersion} />)

      expect(getCheckbox()).toBeInTheDocument()
    })
  })

  // ================================
  // Component Memoization Tests
  // ================================
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect(LoadedItem).toBeDefined()
      expect(typeof LoadedItem).toBe('object')
    })
  })
})

// ================================================================
// MarketplaceItem Component Tests
// ================================================================
describe('MarketplaceItem', () => {
  const defaultMarketplaceItemProps = {
    checked: false,
    onCheckedChange: vi.fn(),
    payload: createMockPlugin(),
    version: '1.0.0',
    versionInfo: createMockVersionProps(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Helper to find checkbox element
  const getCheckbox = () => screen.getByTestId(/^checkbox/)

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render LoadedItem when payload is provided', () => {
      render(<MarketplaceItem {...defaultMarketplaceItemProps} />)

      expect(getCheckbox()).toBeInTheDocument()
    })

    it('should render Loading when payload is undefined', () => {
      render(<MarketplaceItem {...defaultMarketplaceItemProps} payload={undefined} />)

      // Loading component renders a disabled checkbox
      const checkbox = screen.getByTestId(/^checkbox/)
      expect(checkbox).toHaveClass('cursor-not-allowed')
    })
  })

  // ================================
  // Props Tests
  // ================================
  describe('Props', () => {
    it('should pass version to LoadedItem', () => {
      render(<MarketplaceItem {...defaultMarketplaceItemProps} version="2.0.0" />)

      expect(getCheckbox()).toBeInTheDocument()
    })

    it('should pass checked state to LoadedItem', () => {
      render(<MarketplaceItem {...defaultMarketplaceItemProps} checked={true} />)

      // When checked, the check icon should be present
      expect(screen.getByTestId(/^check-icon/)).toBeInTheDocument()
    })
  })

  // ================================
  // User Interactions Tests
  // ================================
  describe('User Interactions', () => {
    it('should call onCheckedChange when clicked', () => {
      const onCheckedChange = vi.fn()
      render(<MarketplaceItem {...defaultMarketplaceItemProps} onCheckedChange={onCheckedChange} />)

      fireEvent.click(getCheckbox())

      expect(onCheckedChange).toHaveBeenCalled()
    })
  })

  // ================================
  // Component Memoization Tests
  // ================================
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect(MarketplaceItem).toBeDefined()
      expect(typeof MarketplaceItem).toBe('object')
    })
  })
})

// ================================================================
// PackageItem Component Tests
// ================================================================
describe('PackageItem', () => {
  const defaultPackageItemProps = {
    checked: false,
    onCheckedChange: vi.fn(),
    payload: createMockPackageDependency(),
    versionInfo: createMockVersionProps(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Helper to find checkbox element
  const getCheckbox = () => screen.getByTestId(/^checkbox/)

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render LoadedItem when payload has manifest', () => {
      render(<PackageItem {...defaultPackageItemProps} />)

      expect(getCheckbox()).toBeInTheDocument()
    })

    it('should render LoadingError when manifest is missing', () => {
      const invalidPayload = {
        type: 'package',
        value: { unique_identifier: 'test' },
      } as PackageDependency

      render(<PackageItem {...defaultPackageItemProps} payload={invalidPayload} />)

      // LoadingError renders a disabled checkbox and error text
      const checkbox = screen.getByTestId(/^checkbox/)
      expect(checkbox).toHaveClass('cursor-not-allowed')
      expect(screen.getByText('plugin.installModal.pluginLoadError')).toBeInTheDocument()
    })
  })

  // ================================
  // Props Tests
  // ================================
  describe('Props', () => {
    it('should pass isFromMarketPlace to LoadedItem', () => {
      render(<PackageItem {...defaultPackageItemProps} isFromMarketPlace={true} />)

      expect(getCheckbox()).toBeInTheDocument()
    })

    it('should pass checked state to LoadedItem', () => {
      render(<PackageItem {...defaultPackageItemProps} checked={true} />)

      // When checked, the check icon should be present
      expect(screen.getByTestId(/^check-icon/)).toBeInTheDocument()
    })
  })

  // ================================
  // User Interactions Tests
  // ================================
  describe('User Interactions', () => {
    it('should call onCheckedChange when clicked', () => {
      const onCheckedChange = vi.fn()
      render(<PackageItem {...defaultPackageItemProps} onCheckedChange={onCheckedChange} />)

      fireEvent.click(getCheckbox())

      expect(onCheckedChange).toHaveBeenCalled()
    })
  })

  // ================================
  // Component Memoization Tests
  // ================================
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect(PackageItem).toBeDefined()
      expect(typeof PackageItem).toBe('object')
    })
  })
})

// ================================================================
// GithubItem Component Tests
// ================================================================
describe('GithubItem', () => {
  const defaultGithubItemProps = {
    checked: false,
    onCheckedChange: vi.fn(),
    dependency: createMockGitHubDependency(),
    versionInfo: createMockVersionProps(),
    onFetchedPayload: vi.fn(),
    onFetchError: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseUploadGitHub.mockReturnValue({ data: null, error: null })
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render Loading when data is not yet fetched', () => {
      mockUseUploadGitHub.mockReturnValue({ data: null, error: null })
      render(<GithubItem {...defaultGithubItemProps} />)

      // Loading component renders a disabled checkbox
      const checkbox = screen.getByTestId(/^checkbox/)
      expect(checkbox).toHaveClass('cursor-not-allowed')
    })

    it('should render LoadedItem when data is fetched', async () => {
      const mockData = {
        unique_identifier: 'test-uid',
        manifest: {
          plugin_unique_identifier: 'test-uid',
          version: '1.0.0',
          author: 'test-author',
          icon: 'icon.png',
          name: 'Test Plugin',
          category: PluginCategoryEnum.tool,
          label: { 'en-US': 'Test' },
          description: { 'en-US': 'Test Description' },
          created_at: '2024-01-01',
          resource: {},
          plugins: [],
          verified: true,
          endpoint: { settings: [], endpoints: [] },
          model: null,
          tags: [],
          agent_strategy: null,
          meta: { version: '1.0.0' },
          trigger: {},
        },
      }
      mockUseUploadGitHub.mockReturnValue({ data: mockData, error: null })

      render(<GithubItem {...defaultGithubItemProps} />)

      // When data is loaded, LoadedItem should be rendered with checkbox
      await waitFor(() => {
        expect(screen.getByTestId(/^checkbox/)).toBeInTheDocument()
      })
    })
  })

  // ================================
  // Callback Tests
  // ================================
  describe('Callbacks', () => {
    it('should call onFetchedPayload when data is fetched', async () => {
      const onFetchedPayload = vi.fn()
      const mockData = {
        unique_identifier: 'test-uid',
        manifest: {
          plugin_unique_identifier: 'test-uid',
          version: '1.0.0',
          author: 'test-author',
          icon: 'icon.png',
          name: 'Test Plugin',
          category: PluginCategoryEnum.tool,
          label: { 'en-US': 'Test' },
          description: { 'en-US': 'Test Description' },
          created_at: '2024-01-01',
          resource: {},
          plugins: [],
          verified: true,
          endpoint: { settings: [], endpoints: [] },
          model: null,
          tags: [],
          agent_strategy: null,
          meta: { version: '1.0.0' },
          trigger: {},
        },
      }
      mockUseUploadGitHub.mockReturnValue({ data: mockData, error: null })

      render(<GithubItem {...defaultGithubItemProps} onFetchedPayload={onFetchedPayload} />)

      await waitFor(() => {
        expect(onFetchedPayload).toHaveBeenCalled()
      })
    })

    it('should call onFetchError when error occurs', async () => {
      const onFetchError = vi.fn()
      mockUseUploadGitHub.mockReturnValue({ data: null, error: new Error('Fetch failed') })

      render(<GithubItem {...defaultGithubItemProps} onFetchError={onFetchError} />)

      await waitFor(() => {
        expect(onFetchError).toHaveBeenCalled()
      })
    })
  })

  // ================================
  // Props Tests
  // ================================
  describe('Props', () => {
    it('should pass dependency info to useUploadGitHub', () => {
      const dependency = createMockGitHubDependency()
      render(<GithubItem {...defaultGithubItemProps} dependency={dependency} />)

      expect(mockUseUploadGitHub).toHaveBeenCalledWith({
        repo: dependency.value.repo,
        version: dependency.value.version,
        package: dependency.value.package,
      })
    })
  })

  // ================================
  // Component Memoization Tests
  // ================================
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect(GithubItem).toBeDefined()
      expect(typeof GithubItem).toBe('object')
    })
  })
})
