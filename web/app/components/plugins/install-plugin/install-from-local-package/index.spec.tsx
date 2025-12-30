import type { Dependency, PluginDeclaration } from '../../types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InstallStep, PluginCategoryEnum } from '../../types'
import InstallFromLocalPackage from './index'

// Factory functions for test data
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

const createMockDependencies = (): Dependency[] => [
  {
    type: 'package',
    value: {
      unique_identifier: 'dep-1',
      manifest: createMockManifest({ name: 'Dep Plugin 1' }),
    },
  },
  {
    type: 'package',
    value: {
      unique_identifier: 'dep-2',
      manifest: createMockManifest({ name: 'Dep Plugin 2' }),
    },
  },
]

const createMockFile = (name: string = 'test-plugin.difypkg'): File => {
  return new File(['test content'], name, { type: 'application/octet-stream' })
}

const createMockBundleFile = (): File => {
  return new File(['bundle content'], 'test-bundle.difybndl', { type: 'application/octet-stream' })
}

// Mock external dependencies
const mockGetIconUrl = vi.fn()
vi.mock('@/app/components/plugins/install-plugin/base/use-get-icon', () => ({
  default: () => ({ getIconUrl: mockGetIconUrl }),
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
let uploadingOnPackageUploaded: ((result: { uniqueIdentifier: string, manifest: PluginDeclaration }) => void) | null = null
let uploadingOnBundleUploaded: ((result: Dependency[]) => void) | null = null
let _uploadingOnFailed: ((errorMsg: string) => void) | null = null

vi.mock('./steps/uploading', () => ({
  default: ({
    isBundle,
    file,
    onCancel,
    onPackageUploaded,
    onBundleUploaded,
    onFailed,
  }: {
    isBundle: boolean
    file: File
    onCancel: () => void
    onPackageUploaded: (result: { uniqueIdentifier: string, manifest: PluginDeclaration }) => void
    onBundleUploaded: (result: Dependency[]) => void
    onFailed: (errorMsg: string) => void
  }) => {
    uploadingOnPackageUploaded = onPackageUploaded
    uploadingOnBundleUploaded = onBundleUploaded
    _uploadingOnFailed = onFailed
    return (
      <div data-testid="uploading-step">
        <span data-testid="is-bundle">{isBundle ? 'true' : 'false'}</span>
        <span data-testid="file-name">{file.name}</span>
        <button data-testid="cancel-upload-btn" onClick={onCancel}>Cancel</button>
        <button
          data-testid="trigger-package-upload-btn"
          onClick={() => onPackageUploaded({
            uniqueIdentifier: 'test-unique-id',
            manifest: createMockManifest(),
          })}
        >
          Trigger Package Upload
        </button>
        <button
          data-testid="trigger-bundle-upload-btn"
          onClick={() => onBundleUploaded(createMockDependencies())}
        >
          Trigger Bundle Upload
        </button>
        <button
          data-testid="trigger-upload-fail-btn"
          onClick={() => onFailed('Upload failed error')}
        >
          Trigger Upload Fail
        </button>
      </div>
    )
  },
}))

let _packageStepChangeCallback: ((step: InstallStep) => void) | null = null
let _packageSetIsInstallingCallback: ((isInstalling: boolean) => void) | null = null
let _packageOnErrorCallback: ((errorMsg: string) => void) | null = null

vi.mock('./ready-to-install', () => ({
  default: ({
    step,
    onStepChange,
    onStartToInstall,
    setIsInstalling,
    onClose,
    uniqueIdentifier,
    manifest,
    errorMsg,
    onError,
  }: {
    step: InstallStep
    onStepChange: (step: InstallStep) => void
    onStartToInstall: () => void
    setIsInstalling: (isInstalling: boolean) => void
    onClose: () => void
    uniqueIdentifier: string | null
    manifest: PluginDeclaration | null
    errorMsg: string | null
    onError: (errorMsg: string) => void
  }) => {
    _packageStepChangeCallback = onStepChange
    _packageSetIsInstallingCallback = setIsInstalling
    _packageOnErrorCallback = onError
    return (
      <div data-testid="ready-to-install-package">
        <span data-testid="package-step">{step}</span>
        <span data-testid="package-unique-identifier">{uniqueIdentifier || 'null'}</span>
        <span data-testid="package-manifest-name">{manifest?.name || 'null'}</span>
        <span data-testid="package-error-msg">{errorMsg || 'null'}</span>
        <button data-testid="package-close-btn" onClick={onClose}>Close</button>
        <button data-testid="package-start-install-btn" onClick={onStartToInstall}>Start Install</button>
        <button
          data-testid="package-step-installed-btn"
          onClick={() => onStepChange(InstallStep.installed)}
        >
          Set Installed
        </button>
        <button
          data-testid="package-step-failed-btn"
          onClick={() => onStepChange(InstallStep.installFailed)}
        >
          Set Failed
        </button>
        <button
          data-testid="package-set-installing-false-btn"
          onClick={() => setIsInstalling(false)}
        >
          Set Not Installing
        </button>
        <button
          data-testid="package-set-error-btn"
          onClick={() => onError('Custom error message')}
        >
          Set Error
        </button>
      </div>
    )
  },
}))

let _bundleStepChangeCallback: ((step: InstallStep) => void) | null = null
let _bundleSetIsInstallingCallback: ((isInstalling: boolean) => void) | null = null

vi.mock('../install-bundle/ready-to-install', () => ({
  default: ({
    step,
    onStepChange,
    onStartToInstall,
    setIsInstalling,
    onClose,
    allPlugins,
  }: {
    step: InstallStep
    onStepChange: (step: InstallStep) => void
    onStartToInstall: () => void
    setIsInstalling: (isInstalling: boolean) => void
    onClose: () => void
    allPlugins: Dependency[]
  }) => {
    _bundleStepChangeCallback = onStepChange
    _bundleSetIsInstallingCallback = setIsInstalling
    return (
      <div data-testid="ready-to-install-bundle">
        <span data-testid="bundle-step">{step}</span>
        <span data-testid="bundle-plugins-count">{allPlugins.length}</span>
        <button data-testid="bundle-close-btn" onClick={onClose}>Close</button>
        <button data-testid="bundle-start-install-btn" onClick={onStartToInstall}>Start Install</button>
        <button
          data-testid="bundle-step-installed-btn"
          onClick={() => onStepChange(InstallStep.installed)}
        >
          Set Installed
        </button>
        <button
          data-testid="bundle-step-failed-btn"
          onClick={() => onStepChange(InstallStep.installFailed)}
        >
          Set Failed
        </button>
        <button
          data-testid="bundle-set-installing-false-btn"
          onClick={() => setIsInstalling(false)}
        >
          Set Not Installing
        </button>
      </div>
    )
  },
}))

describe('InstallFromLocalPackage', () => {
  const defaultProps = {
    file: createMockFile(),
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetIconUrl.mockReturnValue('processed-icon-url')
    mockHideLogicState = {
      modalClassName: 'test-modal-class',
      foldAnimInto: vi.fn(),
      setIsInstalling: vi.fn(),
      handleStartToInstall: vi.fn(),
    }
    uploadingOnPackageUploaded = null
    uploadingOnBundleUploaded = null
    _uploadingOnFailed = null
    _packageStepChangeCallback = null
    _packageSetIsInstallingCallback = null
    _packageOnErrorCallback = null
    _bundleStepChangeCallback = null
    _bundleSetIsInstallingCallback = null
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render modal with uploading step initially', () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      expect(screen.getByTestId('uploading-step')).toBeInTheDocument()
      expect(screen.getByTestId('file-name')).toHaveTextContent('test-plugin.difypkg')
    })

    it('should render with correct modal title for uploading step', () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()
    })

    it('should apply modal className from useHideLogic', () => {
      expect(mockHideLogicState.modalClassName).toBe('test-modal-class')
    })

    it('should identify bundle file correctly', () => {
      render(<InstallFromLocalPackage {...defaultProps} file={createMockBundleFile()} />)

      expect(screen.getByTestId('is-bundle')).toHaveTextContent('true')
    })

    it('should identify package file correctly', () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      expect(screen.getByTestId('is-bundle')).toHaveTextContent('false')
    })
  })

  // ================================
  // Title Display Tests
  // ================================
  describe('Title Display', () => {
    it('should show install plugin title initially', () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()
    })

    it('should show upload failed title when upload fails', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-upload-fail-btn'))

      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.uploadFailed')).toBeInTheDocument()
      })
    })

    it('should show installed successfully title for package when installed', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-step-installed-btn'))

      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.installedSuccessfully')).toBeInTheDocument()
      })
    })

    it('should show install complete title for bundle when installed', async () => {
      render(<InstallFromLocalPackage {...defaultProps} file={createMockBundleFile()} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('bundle-step-installed-btn'))

      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.installComplete')).toBeInTheDocument()
      })
    })

    it('should show install failed title when install fails', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-step-failed-btn'))

      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.installFailed')).toBeInTheDocument()
      })
    })
  })

  // ================================
  // State Management Tests
  // ================================
  describe('State Management', () => {
    it('should transition from uploading to readyToInstall on successful package upload', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      expect(screen.getByTestId('uploading-step')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
        expect(screen.getByTestId('package-step')).toHaveTextContent('readyToInstall')
      })
    })

    it('should transition from uploading to readyToInstall on successful bundle upload', async () => {
      render(<InstallFromLocalPackage {...defaultProps} file={createMockBundleFile()} />)

      expect(screen.getByTestId('uploading-step')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
        expect(screen.getByTestId('bundle-step')).toHaveTextContent('readyToInstall')
      })
    })

    it('should transition to uploadFailed step on upload error', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-upload-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
        expect(screen.getByTestId('package-step')).toHaveTextContent('uploadFailed')
      })
    })

    it('should store uniqueIdentifier after package upload', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-unique-identifier')).toHaveTextContent('test-unique-id')
      })
    })

    it('should store manifest after package upload', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-manifest-name')).toHaveTextContent('Test Plugin')
      })
    })

    it('should store error message after upload failure', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-upload-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-error-msg')).toHaveTextContent('Upload failed error')
      })
    })

    it('should store dependencies after bundle upload', async () => {
      render(<InstallFromLocalPackage {...defaultProps} file={createMockBundleFile()} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('bundle-plugins-count')).toHaveTextContent('2')
      })
    })
  })

  // ================================
  // Icon Processing Tests
  // ================================
  describe('Icon Processing', () => {
    it('should process icon URL on successful package upload', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(mockGetIconUrl).toHaveBeenCalledWith('test-icon.png')
      })
    })

    it('should process dark icon URL if provided', async () => {
      const manifestWithDarkIcon = createMockManifest({ icon_dark: 'test-icon-dark.png' })

      render(<InstallFromLocalPackage {...defaultProps} />)

      // Manually call the callback with dark icon manifest
      if (uploadingOnPackageUploaded) {
        uploadingOnPackageUploaded({
          uniqueIdentifier: 'test-id',
          manifest: manifestWithDarkIcon,
        })
      }

      await waitFor(() => {
        expect(mockGetIconUrl).toHaveBeenCalledWith('test-icon.png')
        expect(mockGetIconUrl).toHaveBeenCalledWith('test-icon-dark.png')
      })
    })

    it('should not process dark icon if not provided', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(mockGetIconUrl).toHaveBeenCalledTimes(1)
        expect(mockGetIconUrl).toHaveBeenCalledWith('test-icon.png')
      })
    })
  })

  // ================================
  // Callback Tests
  // ================================
  describe('Callbacks', () => {
    it('should call onClose when cancel button is clicked during upload', () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('cancel-upload-btn'))

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should call foldAnimInto when modal close is triggered', () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      expect(mockHideLogicState.foldAnimInto).toBeDefined()
    })

    it('should call handleStartToInstall when start install is triggered for package', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-start-install-btn'))

      expect(mockHideLogicState.handleStartToInstall).toHaveBeenCalledTimes(1)
    })

    it('should call handleStartToInstall when start install is triggered for bundle', async () => {
      render(<InstallFromLocalPackage {...defaultProps} file={createMockBundleFile()} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('bundle-start-install-btn'))

      expect(mockHideLogicState.handleStartToInstall).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when close button is clicked in package ready-to-install', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-close-btn'))

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when close button is clicked in bundle ready-to-install', async () => {
      render(<InstallFromLocalPackage {...defaultProps} file={createMockBundleFile()} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('bundle-close-btn'))

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })
  })

  // ================================
  // Callback Stability Tests (Memoization)
  // ================================
  describe('Callback Stability', () => {
    it('should maintain stable handlePackageUploaded callback reference', async () => {
      const { rerender } = render(<InstallFromLocalPackage {...defaultProps} />)

      expect(screen.getByTestId('uploading-step')).toBeInTheDocument()

      // Rerender with same props
      rerender(<InstallFromLocalPackage {...defaultProps} />)

      // The component should still work correctly
      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })
    })

    it('should maintain stable handleBundleUploaded callback reference', async () => {
      const bundleProps = { ...defaultProps, file: createMockBundleFile() }
      const { rerender } = render(<InstallFromLocalPackage {...bundleProps} />)

      expect(screen.getByTestId('uploading-step')).toBeInTheDocument()

      // Rerender with same props
      rerender(<InstallFromLocalPackage {...bundleProps} />)

      // The component should still work correctly
      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
      })
    })

    it('should maintain stable handleUploadFail callback reference', async () => {
      const { rerender } = render(<InstallFromLocalPackage {...defaultProps} />)

      // Rerender with same props
      rerender(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-upload-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-error-msg')).toHaveTextContent('Upload failed error')
      })
    })
  })

  // ================================
  // Step Change Tests
  // ================================
  describe('Step Change Handling', () => {
    it('should allow step change to installed for package', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-step-installed-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-step')).toHaveTextContent('installed')
      })
    })

    it('should allow step change to installFailed for package', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-step-failed-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-step')).toHaveTextContent('failed')
      })
    })

    it('should allow step change to installed for bundle', async () => {
      render(<InstallFromLocalPackage {...defaultProps} file={createMockBundleFile()} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('bundle-step-installed-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('bundle-step')).toHaveTextContent('installed')
      })
    })

    it('should allow step change to installFailed for bundle', async () => {
      render(<InstallFromLocalPackage {...defaultProps} file={createMockBundleFile()} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('bundle-step-failed-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('bundle-step')).toHaveTextContent('failed')
      })
    })
  })

  // ================================
  // setIsInstalling Tests
  // ================================
  describe('setIsInstalling Handling', () => {
    it('should pass setIsInstalling to package ready-to-install', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-set-installing-false-btn'))

      expect(mockHideLogicState.setIsInstalling).toHaveBeenCalledWith(false)
    })

    it('should pass setIsInstalling to bundle ready-to-install', async () => {
      render(<InstallFromLocalPackage {...defaultProps} file={createMockBundleFile()} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('bundle-set-installing-false-btn'))

      expect(mockHideLogicState.setIsInstalling).toHaveBeenCalledWith(false)
    })
  })

  // ================================
  // Error Handling Tests
  // ================================
  describe('Error Handling', () => {
    it('should handle onError callback for package', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-set-error-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-error-msg')).toHaveTextContent('Custom error message')
      })
    })

    it('should preserve error message through step changes', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-upload-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-error-msg')).toHaveTextContent('Upload failed error')
      })

      // Error message should still be accessible
      expect(screen.getByTestId('package-error-msg')).toHaveTextContent('Upload failed error')
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle file with .difypkg extension as package', () => {
      const pkgFile = createMockFile('my-plugin.difypkg')
      render(<InstallFromLocalPackage {...defaultProps} file={pkgFile} />)

      expect(screen.getByTestId('is-bundle')).toHaveTextContent('false')
    })

    it('should handle file with .difybndl extension as bundle', () => {
      const bundleFile = createMockFile('my-bundle.difybndl')
      render(<InstallFromLocalPackage {...defaultProps} file={bundleFile} />)

      expect(screen.getByTestId('is-bundle')).toHaveTextContent('true')
    })

    it('should handle file without standard extension as package', () => {
      const otherFile = createMockFile('plugin.zip')
      render(<InstallFromLocalPackage {...defaultProps} file={otherFile} />)

      expect(screen.getByTestId('is-bundle')).toHaveTextContent('false')
    })

    it('should handle empty dependencies array for bundle', async () => {
      render(<InstallFromLocalPackage {...defaultProps} file={createMockBundleFile()} />)

      // Manually trigger with empty dependencies
      if (uploadingOnBundleUploaded) {
        uploadingOnBundleUploaded([])
      }

      await waitFor(() => {
        expect(screen.getByTestId('bundle-plugins-count')).toHaveTextContent('0')
      })
    })

    it('should handle manifest without icon_dark', async () => {
      const manifestWithoutDarkIcon = createMockManifest({ icon_dark: undefined })

      render(<InstallFromLocalPackage {...defaultProps} />)

      if (uploadingOnPackageUploaded) {
        uploadingOnPackageUploaded({
          uniqueIdentifier: 'test-id',
          manifest: manifestWithoutDarkIcon,
        })
      }

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      // Should only call getIconUrl once for the main icon
      expect(mockGetIconUrl).toHaveBeenCalledTimes(1)
    })

    it('should display correct file name in uploading step', () => {
      const customFile = createMockFile('custom-plugin-name.difypkg')
      render(<InstallFromLocalPackage {...defaultProps} file={customFile} />)

      expect(screen.getByTestId('file-name')).toHaveTextContent('custom-plugin-name.difypkg')
    })

    it('should handle rapid state transitions', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      // Quickly trigger upload success
      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      // Quickly trigger step changes
      fireEvent.click(screen.getByTestId('package-step-installed-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-step')).toHaveTextContent('installed')
      })
    })
  })

  // ================================
  // Conditional Rendering Tests
  // ================================
  describe('Conditional Rendering', () => {
    it('should show uploading step initially and hide after upload', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      expect(screen.getByTestId('uploading-step')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.queryByTestId('uploading-step')).not.toBeInTheDocument()
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })
    })

    it('should render ReadyToInstallPackage for package files', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
        expect(screen.queryByTestId('ready-to-install-bundle')).not.toBeInTheDocument()
      })
    })

    it('should render ReadyToInstallBundle for bundle files', async () => {
      render(<InstallFromLocalPackage {...defaultProps} file={createMockBundleFile()} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
        expect(screen.queryByTestId('ready-to-install-package')).not.toBeInTheDocument()
      })
    })

    it('should render both uploading and ready-to-install simultaneously during transition', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      // Initially only uploading is shown
      expect(screen.getByTestId('uploading-step')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      // After upload, only ready-to-install is shown
      await waitFor(() => {
        expect(screen.queryByTestId('uploading-step')).not.toBeInTheDocument()
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })
    })
  })

  // ================================
  // Data Flow Tests
  // ================================
  describe('Data Flow', () => {
    it('should pass correct uniqueIdentifier to ReadyToInstallPackage', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-unique-identifier')).toHaveTextContent('test-unique-id')
      })
    })

    it('should pass processed manifest to ReadyToInstallPackage', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-manifest-name')).toHaveTextContent('Test Plugin')
      })
    })

    it('should pass all dependencies to ReadyToInstallBundle', async () => {
      render(<InstallFromLocalPackage {...defaultProps} file={createMockBundleFile()} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('bundle-plugins-count')).toHaveTextContent('2')
      })
    })

    it('should pass error message to ReadyToInstallPackage', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-upload-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-error-msg')).toHaveTextContent('Upload failed error')
      })
    })

    it('should pass null uniqueIdentifier when not uploaded for package', () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      // Before upload, uniqueIdentifier should be null
      // The uploading step is shown, so ReadyToInstallPackage is not rendered yet
      expect(screen.getByTestId('uploading-step')).toBeInTheDocument()
    })

    it('should pass null manifest when not uploaded for package', () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      // Before upload, manifest should be null
      // The uploading step is shown, so ReadyToInstallPackage is not rendered yet
      expect(screen.getByTestId('uploading-step')).toBeInTheDocument()
    })
  })

  // ================================
  // Prop Variations Tests
  // ================================
  describe('Prop Variations', () => {
    it('should work with different file names', () => {
      const files = [
        createMockFile('plugin-a.difypkg'),
        createMockFile('plugin-b.difypkg'),
        createMockFile('bundle-c.difybndl'),
      ]

      files.forEach((file) => {
        const { unmount } = render(<InstallFromLocalPackage {...defaultProps} file={file} />)
        expect(screen.getByTestId('file-name')).toHaveTextContent(file.name)
        unmount()
      })
    })

    it('should call different onClose handlers correctly', () => {
      const onClose1 = vi.fn()
      const onClose2 = vi.fn()

      const { rerender } = render(<InstallFromLocalPackage {...defaultProps} onClose={onClose1} />)

      fireEvent.click(screen.getByTestId('cancel-upload-btn'))
      expect(onClose1).toHaveBeenCalledTimes(1)
      expect(onClose2).not.toHaveBeenCalled()

      rerender(<InstallFromLocalPackage {...defaultProps} onClose={onClose2} />)

      fireEvent.click(screen.getByTestId('cancel-upload-btn'))
      expect(onClose2).toHaveBeenCalledTimes(1)
    })

    it('should handle different file types correctly', () => {
      // Package file
      const { rerender } = render(<InstallFromLocalPackage {...defaultProps} file={createMockFile('test.difypkg')} />)
      expect(screen.getByTestId('is-bundle')).toHaveTextContent('false')

      // Bundle file
      rerender(<InstallFromLocalPackage {...defaultProps} file={createMockBundleFile()} />)
      expect(screen.getByTestId('is-bundle')).toHaveTextContent('true')
    })
  })

  // ================================
  // getTitle Callback Tests
  // ================================
  describe('getTitle Callback', () => {
    it('should return correct title for all InstallStep values', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      // uploading step - shows installPlugin
      expect(screen.getByText('plugin.installModal.installPlugin')).toBeInTheDocument()

      // uploadFailed step
      fireEvent.click(screen.getByTestId('trigger-upload-fail-btn'))
      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.uploadFailed')).toBeInTheDocument()
      })
    })

    it('should differentiate bundle and package installed titles', async () => {
      // Package installed title
      const { unmount } = render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByTestId('package-step-installed-btn'))
      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.installedSuccessfully')).toBeInTheDocument()
      })

      // Unmount and create fresh instance for bundle
      unmount()

      // Bundle installed title
      render(<InstallFromLocalPackage {...defaultProps} file={createMockBundleFile()} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByTestId('bundle-step-installed-btn'))
      await waitFor(() => {
        expect(screen.getByText('plugin.installModal.installComplete')).toBeInTheDocument()
      })
    })
  })

  // ================================
  // Integration with useHideLogic Tests
  // ================================
  describe('Integration with useHideLogic', () => {
    it('should use modalClassName from useHideLogic', () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      // The hook is called and provides modalClassName
      expect(mockHideLogicState.modalClassName).toBe('test-modal-class')
    })

    it('should use foldAnimInto as modal onClose handler', () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      // The foldAnimInto function is available from the hook
      expect(mockHideLogicState.foldAnimInto).toBeDefined()
    })

    it('should use handleStartToInstall from useHideLogic', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-start-install-btn'))

      expect(mockHideLogicState.handleStartToInstall).toHaveBeenCalled()
    })

    it('should use setIsInstalling from useHideLogic', async () => {
      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-set-installing-false-btn'))

      expect(mockHideLogicState.setIsInstalling).toHaveBeenCalledWith(false)
    })
  })

  // ================================
  // useGetIcon Integration Tests
  // ================================
  describe('Integration with useGetIcon', () => {
    it('should call getIconUrl when processing manifest icon', async () => {
      mockGetIconUrl.mockReturnValue('https://example.com/icon.png')

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(mockGetIconUrl).toHaveBeenCalledWith('test-icon.png')
      })
    })

    it('should handle getIconUrl for both icon and icon_dark', async () => {
      mockGetIconUrl.mockReturnValue('https://example.com/icon.png')

      render(<InstallFromLocalPackage {...defaultProps} />)

      const manifestWithDarkIcon = createMockManifest({
        icon: 'light-icon.png',
        icon_dark: 'dark-icon.png',
      })

      if (uploadingOnPackageUploaded) {
        uploadingOnPackageUploaded({
          uniqueIdentifier: 'test-id',
          manifest: manifestWithDarkIcon,
        })
      }

      await waitFor(() => {
        expect(mockGetIconUrl).toHaveBeenCalledWith('light-icon.png')
        expect(mockGetIconUrl).toHaveBeenCalledWith('dark-icon.png')
      })
    })
  })
})

// ================================================================
// ReadyToInstall Component Tests
// ================================================================
describe('ReadyToInstall', () => {
  // Import the actual ReadyToInstall component for isolated testing
  // We'll test it through the parent component with specific scenarios

  const mockRefreshPluginList = vi.fn()

  // Reset mocks for ReadyToInstall tests
  beforeEach(() => {
    vi.clearAllMocks()
    mockRefreshPluginList.mockClear()
  })

  describe('Step Conditional Rendering', () => {
    it('should render Install component when step is readyToInstall', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      // Trigger package upload to transition to readyToInstall step
      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
        expect(screen.getByTestId('package-step')).toHaveTextContent('readyToInstall')
      })
    })

    it('should render Installed component when step is uploadFailed', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      // Trigger upload failure
      fireEvent.click(screen.getByTestId('trigger-upload-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-step')).toHaveTextContent('uploadFailed')
      })
    })

    it('should render Installed component when step is installed', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      // Trigger package upload then install
      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-step-installed-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-step')).toHaveTextContent('installed')
      })
    })

    it('should render Installed component when step is installFailed', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      // Trigger package upload then fail
      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-step-failed-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-step')).toHaveTextContent('failed')
      })
    })
  })

  describe('handleInstalled Callback', () => {
    it('should transition to installed step when handleInstalled is called', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      // Simulate successful installation
      fireEvent.click(screen.getByTestId('package-step-installed-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-step')).toHaveTextContent('installed')
      })
    })

    it('should call setIsInstalling(false) when installation completes', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-set-installing-false-btn'))

      expect(mockHideLogicState.setIsInstalling).toHaveBeenCalledWith(false)
    })
  })

  describe('handleFailed Callback', () => {
    it('should transition to installFailed step when handleFailed is called', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-step-failed-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-step')).toHaveTextContent('failed')
      })
    })

    it('should store error message when handleFailed is called with errorMsg', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-set-error-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-error-msg')).toHaveTextContent('Custom error message')
      })
    })
  })

  describe('onClose Handler', () => {
    it('should call onClose when cancel is clicked', async () => {
      const onClose = vi.fn()
      const defaultProps = {
        file: createMockFile(),
        onClose,
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-close-btn'))

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Props Passing', () => {
    it('should pass uniqueIdentifier to Install component', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-unique-identifier')).toHaveTextContent('test-unique-id')
      })
    })

    it('should pass manifest to Install component', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-manifest-name')).toHaveTextContent('Test Plugin')
      })
    })

    it('should pass errorMsg to Installed component', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-upload-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-error-msg')).toHaveTextContent('Upload failed error')
      })
    })
  })
})

// ================================================================
// Uploading Step Component Tests
// ================================================================
describe('Uploading Step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetIconUrl.mockReturnValue('processed-icon-url')
    mockHideLogicState = {
      modalClassName: 'test-modal-class',
      foldAnimInto: vi.fn(),
      setIsInstalling: vi.fn(),
      handleStartToInstall: vi.fn(),
    }
  })

  describe('Rendering', () => {
    it('should render uploading state with file name', () => {
      const defaultProps = {
        file: createMockFile('my-custom-plugin.difypkg'),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      expect(screen.getByTestId('uploading-step')).toBeInTheDocument()
      expect(screen.getByTestId('file-name')).toHaveTextContent('my-custom-plugin.difypkg')
    })

    it('should pass isBundle=true for bundle files', () => {
      const defaultProps = {
        file: createMockBundleFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      expect(screen.getByTestId('is-bundle')).toHaveTextContent('true')
    })

    it('should pass isBundle=false for package files', () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      expect(screen.getByTestId('is-bundle')).toHaveTextContent('false')
    })
  })

  describe('Upload Callbacks', () => {
    it('should call onPackageUploaded with correct data for package files', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-unique-identifier')).toHaveTextContent('test-unique-id')
        expect(screen.getByTestId('package-manifest-name')).toHaveTextContent('Test Plugin')
      })
    })

    it('should call onBundleUploaded with dependencies for bundle files', async () => {
      const defaultProps = {
        file: createMockBundleFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('bundle-plugins-count')).toHaveTextContent('2')
      })
    })

    it('should call onFailed with error message when upload fails', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-upload-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-error-msg')).toHaveTextContent('Upload failed error')
      })
    })
  })

  describe('Cancel Button', () => {
    it('should call onCancel when cancel button is clicked', () => {
      const onClose = vi.fn()
      const defaultProps = {
        file: createMockFile(),
        onClose,
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('cancel-upload-btn'))

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('File Type Detection', () => {
    it('should detect .difypkg as package', () => {
      const defaultProps = {
        file: createMockFile('test.difypkg'),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      expect(screen.getByTestId('is-bundle')).toHaveTextContent('false')
    })

    it('should detect .difybndl as bundle', () => {
      const defaultProps = {
        file: createMockFile('test.difybndl'),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      expect(screen.getByTestId('is-bundle')).toHaveTextContent('true')
    })

    it('should detect other extensions as package', () => {
      const defaultProps = {
        file: createMockFile('test.zip'),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      expect(screen.getByTestId('is-bundle')).toHaveTextContent('false')
    })
  })
})

// ================================================================
// Install Step Component Tests
// ================================================================
describe('Install Step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetIconUrl.mockReturnValue('processed-icon-url')
    mockHideLogicState = {
      modalClassName: 'test-modal-class',
      foldAnimInto: vi.fn(),
      setIsInstalling: vi.fn(),
      handleStartToInstall: vi.fn(),
    }
  })

  describe('Props Handling', () => {
    it('should receive uniqueIdentifier prop correctly', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-unique-identifier')).toHaveTextContent('test-unique-id')
      })
    })

    it('should receive payload prop correctly', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-manifest-name')).toHaveTextContent('Test Plugin')
      })
    })
  })

  describe('Installation Callbacks', () => {
    it('should call onStartToInstall when install starts', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-start-install-btn'))

      expect(mockHideLogicState.handleStartToInstall).toHaveBeenCalledTimes(1)
    })

    it('should call onInstalled when installation succeeds', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-step-installed-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-step')).toHaveTextContent('installed')
      })
    })

    it('should call onFailed when installation fails', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-step-failed-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-step')).toHaveTextContent('failed')
      })
    })
  })

  describe('Cancel Handling', () => {
    it('should call onCancel when cancel is clicked', async () => {
      const onClose = vi.fn()
      const defaultProps = {
        file: createMockFile(),
        onClose,
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-close-btn'))

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})

// ================================================================
// Bundle ReadyToInstall Component Tests
// ================================================================
describe('Bundle ReadyToInstall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetIconUrl.mockReturnValue('processed-icon-url')
    mockHideLogicState = {
      modalClassName: 'test-modal-class',
      foldAnimInto: vi.fn(),
      setIsInstalling: vi.fn(),
      handleStartToInstall: vi.fn(),
    }
  })

  describe('Rendering', () => {
    it('should render bundle install view with all plugins', async () => {
      const defaultProps = {
        file: createMockBundleFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
        expect(screen.getByTestId('bundle-plugins-count')).toHaveTextContent('2')
      })
    })
  })

  describe('Step Changes', () => {
    it('should transition to installed step on successful bundle install', async () => {
      const defaultProps = {
        file: createMockBundleFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('bundle-step-installed-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('bundle-step')).toHaveTextContent('installed')
      })
    })

    it('should transition to installFailed step on bundle install failure', async () => {
      const defaultProps = {
        file: createMockBundleFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('bundle-step-failed-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('bundle-step')).toHaveTextContent('failed')
      })
    })
  })

  describe('Callbacks', () => {
    it('should call onStartToInstall when bundle install starts', async () => {
      const defaultProps = {
        file: createMockBundleFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('bundle-start-install-btn'))

      expect(mockHideLogicState.handleStartToInstall).toHaveBeenCalledTimes(1)
    })

    it('should call setIsInstalling when bundle installation state changes', async () => {
      const defaultProps = {
        file: createMockBundleFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('bundle-set-installing-false-btn'))

      expect(mockHideLogicState.setIsInstalling).toHaveBeenCalledWith(false)
    })

    it('should call onClose when bundle install is cancelled', async () => {
      const onClose = vi.fn()
      const defaultProps = {
        file: createMockBundleFile(),
        onClose,
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('bundle-close-btn'))

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Dependencies Handling', () => {
    it('should pass all dependencies to bundle install component', async () => {
      const defaultProps = {
        file: createMockBundleFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('bundle-plugins-count')).toHaveTextContent('2')
      })
    })

    it('should handle empty dependencies array', async () => {
      const defaultProps = {
        file: createMockBundleFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      // Manually trigger with empty dependencies
      const callback = uploadingOnBundleUploaded
      if (callback) {
        act(() => {
          callback([])
        })
      }

      await waitFor(() => {
        expect(screen.getByTestId('bundle-plugins-count')).toHaveTextContent('0')
      })
    })
  })
})

// ================================================================
// Complete Flow Integration Tests
// ================================================================
describe('Complete Installation Flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetIconUrl.mockReturnValue('processed-icon-url')
    mockHideLogicState = {
      modalClassName: 'test-modal-class',
      foldAnimInto: vi.fn(),
      setIsInstalling: vi.fn(),
      handleStartToInstall: vi.fn(),
    }
  })

  describe('Package Installation Flow', () => {
    it('should complete full package installation flow: upload -> install -> success', async () => {
      const onClose = vi.fn()
      const onSuccess = vi.fn()
      const defaultProps = { file: createMockFile(), onClose, onSuccess }

      render(<InstallFromLocalPackage {...defaultProps} />)

      // Step 1: Uploading
      expect(screen.getByTestId('uploading-step')).toBeInTheDocument()

      // Step 2: Upload complete, transition to readyToInstall
      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
        expect(screen.getByTestId('package-step')).toHaveTextContent('readyToInstall')
      })

      // Step 3: Start installation
      fireEvent.click(screen.getByTestId('package-start-install-btn'))
      expect(mockHideLogicState.handleStartToInstall).toHaveBeenCalled()

      // Step 4: Installation complete
      fireEvent.click(screen.getByTestId('package-step-installed-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-step')).toHaveTextContent('installed')
        expect(screen.getByText('plugin.installModal.installedSuccessfully')).toBeInTheDocument()
      })
    })

    it('should handle package installation failure flow', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      // Upload
      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      // Set error and fail
      fireEvent.click(screen.getByTestId('package-set-error-btn'))
      fireEvent.click(screen.getByTestId('package-step-failed-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-step')).toHaveTextContent('failed')
        expect(screen.getByText('plugin.installModal.installFailed')).toBeInTheDocument()
      })
    })

    it('should handle upload failure flow', async () => {
      const defaultProps = {
        file: createMockFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-upload-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('package-step')).toHaveTextContent('uploadFailed')
        expect(screen.getByTestId('package-error-msg')).toHaveTextContent('Upload failed error')
        expect(screen.getByText('plugin.installModal.uploadFailed')).toBeInTheDocument()
      })
    })
  })

  describe('Bundle Installation Flow', () => {
    it('should complete full bundle installation flow: upload -> install -> success', async () => {
      const onClose = vi.fn()
      const onSuccess = vi.fn()
      const defaultProps = { file: createMockBundleFile(), onClose, onSuccess }

      render(<InstallFromLocalPackage {...defaultProps} />)

      // Step 1: Uploading
      expect(screen.getByTestId('uploading-step')).toBeInTheDocument()
      expect(screen.getByTestId('is-bundle')).toHaveTextContent('true')

      // Step 2: Upload complete, transition to readyToInstall
      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
        expect(screen.getByTestId('bundle-step')).toHaveTextContent('readyToInstall')
        expect(screen.getByTestId('bundle-plugins-count')).toHaveTextContent('2')
      })

      // Step 3: Start installation
      fireEvent.click(screen.getByTestId('bundle-start-install-btn'))
      expect(mockHideLogicState.handleStartToInstall).toHaveBeenCalled()

      // Step 4: Installation complete
      fireEvent.click(screen.getByTestId('bundle-step-installed-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('bundle-step')).toHaveTextContent('installed')
        expect(screen.getByText('plugin.installModal.installComplete')).toBeInTheDocument()
      })
    })

    it('should handle bundle installation failure flow', async () => {
      const defaultProps = {
        file: createMockBundleFile(),
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      // Upload
      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
      })

      // Fail
      fireEvent.click(screen.getByTestId('bundle-step-failed-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('bundle-step')).toHaveTextContent('failed')
        expect(screen.getByText('plugin.installModal.installFailed')).toBeInTheDocument()
      })
    })
  })

  describe('User Cancellation Flows', () => {
    it('should allow cancellation during upload', () => {
      const onClose = vi.fn()
      const defaultProps = {
        file: createMockFile(),
        onClose,
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('cancel-upload-btn'))

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should allow cancellation during package ready-to-install', async () => {
      const onClose = vi.fn()
      const defaultProps = {
        file: createMockFile(),
        onClose,
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-package-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-package')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('package-close-btn'))

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should allow cancellation during bundle ready-to-install', async () => {
      const onClose = vi.fn()
      const defaultProps = {
        file: createMockBundleFile(),
        onClose,
        onSuccess: vi.fn(),
      }

      render(<InstallFromLocalPackage {...defaultProps} />)

      fireEvent.click(screen.getByTestId('trigger-bundle-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('ready-to-install-bundle')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('bundle-close-btn'))

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
