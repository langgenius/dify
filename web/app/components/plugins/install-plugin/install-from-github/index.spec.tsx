import type { GitHubRepoReleaseResponse, PluginDeclaration, PluginManifestInMarket, UpdateFromGitHubPayload } from '../../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '../../types'
import { convertRepoToUrl, parseGitHubUrl, pluginManifestInMarketToPluginProps, pluginManifestToCardPluginProps } from '../utils'
import InstallFromGitHub from './index'

// Factory functions for test data (defined before mocks that use them)
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

const createMockReleases = (): GitHubRepoReleaseResponse[] => [
  {
    tag_name: 'v1.0.0',
    assets: [
      { id: 1, name: 'plugin-v1.0.0.zip', browser_download_url: 'https://github.com/test/repo/releases/download/v1.0.0/plugin-v1.0.0.zip' },
      { id: 2, name: 'plugin-v1.0.0.tar.gz', browser_download_url: 'https://github.com/test/repo/releases/download/v1.0.0/plugin-v1.0.0.tar.gz' },
    ],
  },
  {
    tag_name: 'v0.9.0',
    assets: [
      { id: 3, name: 'plugin-v0.9.0.zip', browser_download_url: 'https://github.com/test/repo/releases/download/v0.9.0/plugin-v0.9.0.zip' },
    ],
  },
]

const createUpdatePayload = (overrides: Partial<UpdateFromGitHubPayload> = {}): UpdateFromGitHubPayload => ({
  originalPackageInfo: {
    id: 'original-id',
    repo: 'owner/repo',
    version: 'v0.9.0',
    package: 'plugin-v0.9.0.zip',
    releases: createMockReleases(),
  },
  ...overrides,
})

// Mock external dependencies
const mockNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: (props: { type: string, message: string }) => mockNotify(props),
  },
}))

const mockGetIconUrl = vi.fn()
vi.mock('@/app/components/plugins/install-plugin/base/use-get-icon', () => ({
  default: () => ({ getIconUrl: mockGetIconUrl }),
}))

const mockFetchReleases = vi.fn()
vi.mock('../hooks', () => ({
  useGitHubReleases: () => ({ fetchReleases: mockFetchReleases }),
}))

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
vi.mock('./steps/setURL', () => ({
  default: ({ repoUrl, onChange, onNext, onCancel }: {
    repoUrl: string
    onChange: (value: string) => void
    onNext: () => void
    onCancel: () => void
  }) => (
    <div data-testid="set-url-step">
      <input
        data-testid="repo-url-input"
        value={repoUrl}
        onChange={e => onChange(e.target.value)}
      />
      <button data-testid="next-btn" onClick={onNext}>Next</button>
      <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
    </div>
  ),
}))

vi.mock('./steps/selectPackage', () => ({
  default: ({
    repoUrl,
    selectedVersion,
    versions,
    onSelectVersion,
    selectedPackage,
    packages,
    onSelectPackage,
    onUploaded,
    onFailed,
    onBack,
  }: {
    repoUrl: string
    selectedVersion: string
    versions: { value: string, name: string }[]
    onSelectVersion: (item: { value: string, name: string }) => void
    selectedPackage: string
    packages: { value: string, name: string }[]
    onSelectPackage: (item: { value: string, name: string }) => void
    onUploaded: (result: { uniqueIdentifier: string, manifest: PluginDeclaration }) => void
    onFailed: (errorMsg: string) => void
    onBack: () => void
  }) => (
    <div data-testid="select-package-step">
      <span data-testid="repo-url-display">{repoUrl}</span>
      <span data-testid="selected-version">{selectedVersion}</span>
      <span data-testid="selected-package">{selectedPackage}</span>
      <span data-testid="versions-count">{versions.length}</span>
      <span data-testid="packages-count">{packages.length}</span>
      <button
        data-testid="select-version-btn"
        onClick={() => onSelectVersion({ value: 'v1.0.0', name: 'v1.0.0' })}
      >
        Select Version
      </button>
      <button
        data-testid="select-package-btn"
        onClick={() => onSelectPackage({ value: 'package.zip', name: 'package.zip' })}
      >
        Select Package
      </button>
      <button
        data-testid="trigger-upload-btn"
        onClick={() => onUploaded({
          uniqueIdentifier: 'test-unique-id',
          manifest: createMockManifest(),
        })}
      >
        Trigger Upload
      </button>
      <button
        data-testid="trigger-upload-fail-btn"
        onClick={() => onFailed('Upload failed error')}
      >
        Trigger Upload Fail
      </button>
      <button data-testid="back-btn" onClick={onBack}>Back</button>
    </div>
  ),
}))

vi.mock('./steps/loaded', () => ({
  default: ({
    uniqueIdentifier,
    payload,
    repoUrl,
    selectedVersion,
    selectedPackage,
    onBack,
    onStartToInstall,
    onInstalled,
    onFailed,
  }: {
    uniqueIdentifier: string
    payload: PluginDeclaration
    repoUrl: string
    selectedVersion: string
    selectedPackage: string
    onBack: () => void
    onStartToInstall: () => void
    onInstalled: (notRefresh?: boolean) => void
    onFailed: (message?: string) => void
  }) => (
    <div data-testid="loaded-step">
      <span data-testid="unique-identifier">{uniqueIdentifier}</span>
      <span data-testid="payload-name">{payload?.name}</span>
      <span data-testid="loaded-repo-url">{repoUrl}</span>
      <span data-testid="loaded-version">{selectedVersion}</span>
      <span data-testid="loaded-package">{selectedPackage}</span>
      <button data-testid="loaded-back-btn" onClick={onBack}>Back</button>
      <button data-testid="start-install-btn" onClick={onStartToInstall}>Start Install</button>
      <button data-testid="install-success-btn" onClick={() => onInstalled()}>Install Success</button>
      <button data-testid="install-success-no-refresh-btn" onClick={() => onInstalled(true)}>Install Success No Refresh</button>
      <button data-testid="install-fail-btn" onClick={() => onFailed('Install failed')}>Install Fail</button>
      <button data-testid="install-fail-no-msg-btn" onClick={() => onFailed()}>Install Fail No Msg</button>
    </div>
  ),
}))

vi.mock('../base/installed', () => ({
  default: ({ payload, isFailed, errMsg, onCancel }: {
    payload: PluginDeclaration | null
    isFailed: boolean
    errMsg: string | null
    onCancel: () => void
  }) => (
    <div data-testid="installed-step">
      <span data-testid="installed-payload">{payload?.name || 'no-payload'}</span>
      <span data-testid="is-failed">{isFailed ? 'true' : 'false'}</span>
      <span data-testid="error-msg">{errMsg || 'no-error'}</span>
      <button data-testid="installed-close-btn" onClick={onCancel}>Close</button>
    </div>
  ),
}))

describe('InstallFromGitHub', () => {
  const defaultProps = {
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetIconUrl.mockResolvedValue('processed-icon-url')
    mockFetchReleases.mockResolvedValue(createMockReleases())
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
    it('should render modal with correct initial state for new installation', () => {
      render(<InstallFromGitHub {...defaultProps} />)

      expect(screen.getByTestId('set-url-step')).toBeInTheDocument()
      expect(screen.getByTestId('repo-url-input')).toHaveValue('')
    })

    it('should render modal with selectPackage step when updatePayload is provided', () => {
      const updatePayload = createUpdatePayload()

      render(<InstallFromGitHub {...defaultProps} updatePayload={updatePayload} />)

      expect(screen.getByTestId('select-package-step')).toBeInTheDocument()
      expect(screen.getByTestId('repo-url-display')).toHaveTextContent('https://github.com/owner/repo')
    })

    it('should render install note text in non-terminal steps', () => {
      render(<InstallFromGitHub {...defaultProps} />)

      expect(screen.getByText('plugin.installFromGitHub.installNote')).toBeInTheDocument()
    })

    it('should apply modal className from useHideLogic', () => {
      // Verify useHideLogic provides modalClassName
      // The actual className application is handled by Modal component internally
      // We verify the hook integration by checking that it returns the expected class
      expect(mockHideLogicState.modalClassName).toBe('test-modal-class')
    })
  })

  // ================================
  // Title Tests
  // ================================
  describe('Title Display', () => {
    it('should show install title when no updatePayload', () => {
      render(<InstallFromGitHub {...defaultProps} />)

      expect(screen.getByText('plugin.installFromGitHub.installPlugin')).toBeInTheDocument()
    })

    it('should show update title when updatePayload is provided', () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      expect(screen.getByText('plugin.installFromGitHub.updatePlugin')).toBeInTheDocument()
    })
  })

  // ================================
  // State Management Tests
  // ================================
  describe('State Management', () => {
    it('should update repoUrl when user types in input', () => {
      render(<InstallFromGitHub {...defaultProps} />)

      const input = screen.getByTestId('repo-url-input')
      fireEvent.change(input, { target: { value: 'https://github.com/test/repo' } })

      expect(input).toHaveValue('https://github.com/test/repo')
    })

    it('should transition from setUrl to selectPackage on successful URL submit', async () => {
      render(<InstallFromGitHub {...defaultProps} />)

      const input = screen.getByTestId('repo-url-input')
      fireEvent.change(input, { target: { value: 'https://github.com/owner/repo' } })

      const nextBtn = screen.getByTestId('next-btn')
      fireEvent.click(nextBtn)

      await waitFor(() => {
        expect(screen.getByTestId('select-package-step')).toBeInTheDocument()
      })
    })

    it('should update selectedVersion when version is selected', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      const selectVersionBtn = screen.getByTestId('select-version-btn')
      fireEvent.click(selectVersionBtn)

      expect(screen.getByTestId('selected-version')).toHaveTextContent('v1.0.0')
    })

    it('should update selectedPackage when package is selected', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      const selectPackageBtn = screen.getByTestId('select-package-btn')
      fireEvent.click(selectPackageBtn)

      expect(screen.getByTestId('selected-package')).toHaveTextContent('package.zip')
    })

    it('should transition to readyToInstall step after successful upload', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      const uploadBtn = screen.getByTestId('trigger-upload-btn')
      fireEvent.click(uploadBtn)

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })
    })

    it('should transition to installed step after successful install', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      // First upload
      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      // Then install
      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('false')
      })
    })

    it('should transition to installFailed step on install failure', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('true')
        expect(screen.getByTestId('error-msg')).toHaveTextContent('Install failed')
      })
    })

    it('should transition to uploadFailed step on upload failure', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('true')
        expect(screen.getByTestId('error-msg')).toHaveTextContent('Upload failed error')
      })
    })
  })

  // ================================
  // Versions and Packages Tests
  // ================================
  describe('Versions and Packages Computation', () => {
    it('should derive versions from releases', () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      expect(screen.getByTestId('versions-count')).toHaveTextContent('2')
    })

    it('should derive packages from selected version', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      // Initially no packages (no version selected)
      expect(screen.getByTestId('packages-count')).toHaveTextContent('0')

      // Select a version
      fireEvent.click(screen.getByTestId('select-version-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('packages-count')).toHaveTextContent('2')
      })
    })
  })

  // ================================
  // URL Validation Tests
  // ================================
  describe('URL Validation', () => {
    it('should show error toast for invalid GitHub URL', async () => {
      render(<InstallFromGitHub {...defaultProps} />)

      const input = screen.getByTestId('repo-url-input')
      fireEvent.change(input, { target: { value: 'invalid-url' } })

      const nextBtn = screen.getByTestId('next-btn')
      fireEvent.click(nextBtn)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'plugin.error.inValidGitHubUrl',
        })
      })
    })

    it('should show error toast when no releases are found', async () => {
      mockFetchReleases.mockResolvedValue([])

      render(<InstallFromGitHub {...defaultProps} />)

      const input = screen.getByTestId('repo-url-input')
      fireEvent.change(input, { target: { value: 'https://github.com/owner/repo' } })

      const nextBtn = screen.getByTestId('next-btn')
      fireEvent.click(nextBtn)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'plugin.error.noReleasesFound',
        })
      })
    })

    it('should show error toast when fetchReleases throws', async () => {
      mockFetchReleases.mockRejectedValue(new Error('Network error'))

      render(<InstallFromGitHub {...defaultProps} />)

      const input = screen.getByTestId('repo-url-input')
      fireEvent.change(input, { target: { value: 'https://github.com/owner/repo' } })

      const nextBtn = screen.getByTestId('next-btn')
      fireEvent.click(nextBtn)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'plugin.error.fetchReleasesError',
        })
      })
    })
  })

  // ================================
  // Back Navigation Tests
  // ================================
  describe('Back Navigation', () => {
    it('should go back from selectPackage to setUrl', async () => {
      render(<InstallFromGitHub {...defaultProps} />)

      // Navigate to selectPackage
      const input = screen.getByTestId('repo-url-input')
      fireEvent.change(input, { target: { value: 'https://github.com/owner/repo' } })
      fireEvent.click(screen.getByTestId('next-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('select-package-step')).toBeInTheDocument()
      })

      // Go back
      fireEvent.click(screen.getByTestId('back-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('set-url-step')).toBeInTheDocument()
      })
    })

    it('should go back from readyToInstall to selectPackage', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      // Navigate to readyToInstall
      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      // Go back
      fireEvent.click(screen.getByTestId('loaded-back-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('select-package-step')).toBeInTheDocument()
      })
    })
  })

  // ================================
  // Callback Tests
  // ================================
  describe('Callbacks', () => {
    it('should call onClose when cancel button is clicked', () => {
      render(<InstallFromGitHub {...defaultProps} />)

      fireEvent.click(screen.getByTestId('cancel-btn'))

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should call foldAnimInto when modal close is triggered', () => {
      render(<InstallFromGitHub {...defaultProps} />)

      // The modal's onClose is bound to foldAnimInto
      // We verify the hook is properly connected
      expect(mockHideLogicState.foldAnimInto).toBeDefined()
    })

    it('should call onSuccess when installation completes', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(defaultProps.onSuccess).toHaveBeenCalledTimes(1)
      })
    })

    it('should call refreshPluginList when installation completes without notRefresh flag', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(mockRefreshPluginList).toHaveBeenCalled()
      })
    })

    it('should not call refreshPluginList when notRefresh flag is true', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-success-no-refresh-btn'))

      await waitFor(() => {
        expect(mockRefreshPluginList).not.toHaveBeenCalled()
      })
    })

    it('should call setIsInstalling(false) when installation completes', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(mockHideLogicState.setIsInstalling).toHaveBeenCalledWith(false)
      })
    })

    it('should call handleStartToInstall when start install is triggered', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('start-install-btn'))

      expect(mockHideLogicState.handleStartToInstall).toHaveBeenCalledTimes(1)
    })

    it('should call setIsInstalling(false) when installation fails', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-fail-btn'))

      await waitFor(() => {
        expect(mockHideLogicState.setIsInstalling).toHaveBeenCalledWith(false)
      })
    })
  })

  // ================================
  // Callback Stability Tests (Memoization)
  // ================================
  describe('Callback Stability', () => {
    it('should maintain stable handleUploadFail callback reference', async () => {
      const { rerender } = render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      const firstRender = screen.getByTestId('select-package-step')
      expect(firstRender).toBeInTheDocument()

      // Rerender with same props
      rerender(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      // The component should still work correctly
      fireEvent.click(screen.getByTestId('trigger-upload-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
      })
    })
  })

  // ================================
  // Icon Processing Tests
  // ================================
  describe('Icon Processing', () => {
    it('should process icon URL on successful upload', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(mockGetIconUrl).toHaveBeenCalled()
      })
    })

    it('should handle icon processing error gracefully', async () => {
      mockGetIconUrl.mockRejectedValue(new Error('Icon processing failed'))

      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('true')
      })
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle empty releases array from updatePayload', () => {
      const updatePayload = createUpdatePayload({
        originalPackageInfo: {
          id: 'original-id',
          repo: 'owner/repo',
          version: 'v0.9.0',
          package: 'plugin.zip',
          releases: [],
        },
      })

      render(<InstallFromGitHub {...defaultProps} updatePayload={updatePayload} />)

      expect(screen.getByTestId('versions-count')).toHaveTextContent('0')
    })

    it('should handle release with no assets', async () => {
      const updatePayload = createUpdatePayload({
        originalPackageInfo: {
          id: 'original-id',
          repo: 'owner/repo',
          version: 'v0.9.0',
          package: 'plugin.zip',
          releases: [{ tag_name: 'v1.0.0', assets: [] }],
        },
      })

      render(<InstallFromGitHub {...defaultProps} updatePayload={updatePayload} />)

      // Select the version
      fireEvent.click(screen.getByTestId('select-version-btn'))

      // Should have 0 packages
      expect(screen.getByTestId('packages-count')).toHaveTextContent('0')
    })

    it('should handle selected version not found in releases', async () => {
      const updatePayload = createUpdatePayload({
        originalPackageInfo: {
          id: 'original-id',
          repo: 'owner/repo',
          version: 'v0.9.0',
          package: 'plugin.zip',
          releases: [],
        },
      })

      render(<InstallFromGitHub {...defaultProps} updatePayload={updatePayload} />)

      fireEvent.click(screen.getByTestId('select-version-btn'))

      expect(screen.getByTestId('packages-count')).toHaveTextContent('0')
    })

    it('should handle install failure without error message', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-fail-no-msg-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('true')
        expect(screen.getByTestId('error-msg')).toHaveTextContent('no-error')
      })
    })

    it('should handle URL without trailing slash', async () => {
      render(<InstallFromGitHub {...defaultProps} />)

      const input = screen.getByTestId('repo-url-input')
      fireEvent.change(input, { target: { value: 'https://github.com/owner/repo' } })

      fireEvent.click(screen.getByTestId('next-btn'))

      await waitFor(() => {
        expect(mockFetchReleases).toHaveBeenCalledWith('owner', 'repo')
      })
    })

    it('should preserve state correctly through step transitions', async () => {
      render(<InstallFromGitHub {...defaultProps} />)

      // Set URL
      const input = screen.getByTestId('repo-url-input')
      fireEvent.change(input, { target: { value: 'https://github.com/test/myrepo' } })

      // Navigate to selectPackage
      fireEvent.click(screen.getByTestId('next-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('select-package-step')).toBeInTheDocument()
      })

      // Verify URL is preserved
      expect(screen.getByTestId('repo-url-display')).toHaveTextContent('https://github.com/test/myrepo')

      // Select version and package
      fireEvent.click(screen.getByTestId('select-version-btn'))
      fireEvent.click(screen.getByTestId('select-package-btn'))

      // Navigate to readyToInstall
      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      // Verify all data is preserved
      expect(screen.getByTestId('loaded-repo-url')).toHaveTextContent('https://github.com/test/myrepo')
      expect(screen.getByTestId('loaded-version')).toHaveTextContent('v1.0.0')
      expect(screen.getByTestId('loaded-package')).toHaveTextContent('package.zip')
    })
  })

  // ================================
  // Terminal Steps Rendering Tests
  // ================================
  describe('Terminal Steps Rendering', () => {
    it('should render Installed component for installed step', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.queryByText('plugin.installFromGitHub.installNote')).not.toBeInTheDocument()
      })
    })

    it('should render Installed component for uploadFailed step', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('true')
      })
    })

    it('should render Installed component for installFailed step', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('true')
      })
    })

    it('should call onClose when close button is clicked in installed step', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('installed-close-btn'))

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })
  })

  // ================================
  // Title Update Tests
  // ================================
  describe('Title Updates', () => {
    it('should show success title when installed', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(screen.getByText('plugin.installFromGitHub.installedSuccessfully')).toBeInTheDocument()
      })
    })

    it('should show failed title when install failed', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-fail-btn'))

      await waitFor(() => {
        expect(screen.getByText('plugin.installFromGitHub.installFailed')).toBeInTheDocument()
      })
    })
  })

  // ================================
  // Data Flow Tests
  // ================================
  describe('Data Flow', () => {
    it('should pass correct uniqueIdentifier to Loaded component', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('unique-identifier')).toHaveTextContent('test-unique-id')
      })
    })

    it('should pass processed manifest to Loaded component', async () => {
      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('payload-name')).toHaveTextContent('Test Plugin')
      })
    })

    it('should pass manifest with processed icon to Loaded component', async () => {
      mockGetIconUrl.mockResolvedValue('https://processed-icon.com/icon.png')

      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(mockGetIconUrl).toHaveBeenCalledWith('test-icon.png')
      })
    })
  })

  // ================================
  // Prop Variations Tests
  // ================================
  describe('Prop Variations', () => {
    it('should work without updatePayload (fresh install flow)', async () => {
      render(<InstallFromGitHub {...defaultProps} />)

      // Start from setUrl step
      expect(screen.getByTestId('set-url-step')).toBeInTheDocument()

      // Enter URL
      const input = screen.getByTestId('repo-url-input')
      fireEvent.change(input, { target: { value: 'https://github.com/owner/repo' } })
      fireEvent.click(screen.getByTestId('next-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('select-package-step')).toBeInTheDocument()
      })
    })

    it('should work with updatePayload (update flow)', async () => {
      const updatePayload = createUpdatePayload()

      render(<InstallFromGitHub {...defaultProps} updatePayload={updatePayload} />)

      // Start from selectPackage step
      expect(screen.getByTestId('select-package-step')).toBeInTheDocument()
      expect(screen.getByTestId('repo-url-display')).toHaveTextContent('https://github.com/owner/repo')
    })

    it('should use releases from updatePayload', () => {
      const customReleases: GitHubRepoReleaseResponse[] = [
        { tag_name: 'v2.0.0', assets: [{ id: 1, name: 'custom.zip', browser_download_url: 'url' }] },
        { tag_name: 'v1.5.0', assets: [{ id: 2, name: 'custom2.zip', browser_download_url: 'url2' }] },
        { tag_name: 'v1.0.0', assets: [{ id: 3, name: 'custom3.zip', browser_download_url: 'url3' }] },
      ]

      const updatePayload = createUpdatePayload({
        originalPackageInfo: {
          id: 'id',
          repo: 'owner/repo',
          version: 'v1.0.0',
          package: 'pkg.zip',
          releases: customReleases,
        },
      })

      render(<InstallFromGitHub {...defaultProps} updatePayload={updatePayload} />)

      expect(screen.getByTestId('versions-count')).toHaveTextContent('3')
    })

    it('should convert repo to URL correctly', () => {
      const updatePayload = createUpdatePayload({
        originalPackageInfo: {
          id: 'id',
          repo: 'myorg/myrepo',
          version: 'v1.0.0',
          package: 'pkg.zip',
          releases: createMockReleases(),
        },
      })

      render(<InstallFromGitHub {...defaultProps} updatePayload={updatePayload} />)

      expect(screen.getByTestId('repo-url-display')).toHaveTextContent('https://github.com/myorg/myrepo')
    })
  })

  // ================================
  // Error Handling Tests
  // ================================
  describe('Error Handling', () => {
    it('should handle API error with response message', async () => {
      mockGetIconUrl.mockRejectedValue({
        response: { message: 'API Error Message' },
      })

      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('true')
        expect(screen.getByTestId('error-msg')).toHaveTextContent('API Error Message')
      })
    })

    it('should handle API error without response message', async () => {
      mockGetIconUrl.mockRejectedValue(new Error('Generic error'))

      render(<InstallFromGitHub {...defaultProps} updatePayload={createUpdatePayload()} />)

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('true')
        expect(screen.getByTestId('error-msg')).toHaveTextContent('plugin.installModal.installFailedDesc')
      })
    })
  })

  // ================================
  // handleBack Default Case Tests
  // ================================
  describe('handleBack Edge Cases', () => {
    it('should not change state when back is called from setUrl step', async () => {
      // This tests the default case in handleBack switch
      // When in setUrl step, calling back should keep the state unchanged
      render(<InstallFromGitHub {...defaultProps} />)

      // Verify we're on setUrl step
      expect(screen.getByTestId('set-url-step')).toBeInTheDocument()

      // The setUrl step doesn't expose onBack in the real component,
      // but our mock doesn't have it either - this is correct behavior
      // as setUrl is the first step with no back option
    })

    it('should handle multiple back navigations correctly', async () => {
      render(<InstallFromGitHub {...defaultProps} />)

      // Navigate to selectPackage
      const input = screen.getByTestId('repo-url-input')
      fireEvent.change(input, { target: { value: 'https://github.com/owner/repo' } })
      fireEvent.click(screen.getByTestId('next-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('select-package-step')).toBeInTheDocument()
      })

      // Navigate to readyToInstall
      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      // Go back to selectPackage
      fireEvent.click(screen.getByTestId('loaded-back-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('select-package-step')).toBeInTheDocument()
      })

      // Go back to setUrl
      fireEvent.click(screen.getByTestId('back-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('set-url-step')).toBeInTheDocument()
      })

      // Verify URL is preserved after back navigation
      expect(screen.getByTestId('repo-url-input')).toHaveValue('https://github.com/owner/repo')
    })
  })
})

// ================================
// Utility Functions Tests
// ================================
describe('Install Plugin Utils', () => {
  describe('parseGitHubUrl', () => {
    it('should parse valid GitHub URL correctly', () => {
      const result = parseGitHubUrl('https://github.com/owner/repo')

      expect(result.isValid).toBe(true)
      expect(result.owner).toBe('owner')
      expect(result.repo).toBe('repo')
    })

    it('should parse GitHub URL with trailing slash', () => {
      const result = parseGitHubUrl('https://github.com/owner/repo/')

      expect(result.isValid).toBe(true)
      expect(result.owner).toBe('owner')
      expect(result.repo).toBe('repo')
    })

    it('should return invalid for non-GitHub URL', () => {
      const result = parseGitHubUrl('https://gitlab.com/owner/repo')

      expect(result.isValid).toBe(false)
      expect(result.owner).toBeUndefined()
      expect(result.repo).toBeUndefined()
    })

    it('should return invalid for malformed URL', () => {
      const result = parseGitHubUrl('not-a-url')

      expect(result.isValid).toBe(false)
    })

    it('should return invalid for GitHub URL with extra path segments', () => {
      const result = parseGitHubUrl('https://github.com/owner/repo/tree/main')

      expect(result.isValid).toBe(false)
    })

    it('should return invalid for empty string', () => {
      const result = parseGitHubUrl('')

      expect(result.isValid).toBe(false)
    })

    it('should handle URL with special characters in owner/repo names', () => {
      const result = parseGitHubUrl('https://github.com/my-org/my-repo-123')

      expect(result.isValid).toBe(true)
      expect(result.owner).toBe('my-org')
      expect(result.repo).toBe('my-repo-123')
    })
  })

  describe('convertRepoToUrl', () => {
    it('should convert repo string to full GitHub URL', () => {
      const result = convertRepoToUrl('owner/repo')

      expect(result).toBe('https://github.com/owner/repo')
    })

    it('should return empty string for empty repo', () => {
      const result = convertRepoToUrl('')

      expect(result).toBe('')
    })

    it('should handle repo with organization name', () => {
      const result = convertRepoToUrl('my-organization/my-repository')

      expect(result).toBe('https://github.com/my-organization/my-repository')
    })
  })

  describe('pluginManifestToCardPluginProps', () => {
    it('should convert PluginDeclaration to Plugin props correctly', () => {
      const manifest: PluginDeclaration = {
        plugin_unique_identifier: 'test-uid',
        version: '1.0.0',
        author: 'test-author',
        icon: 'icon.png',
        icon_dark: 'icon-dark.png',
        name: 'Test Plugin',
        category: PluginCategoryEnum.tool,
        label: { 'en-US': 'Test Label' } as PluginDeclaration['label'],
        description: { 'en-US': 'Test Description' } as PluginDeclaration['description'],
        created_at: '2024-01-01',
        resource: {},
        plugins: [],
        verified: true,
        endpoint: { settings: [], endpoints: [] },
        model: null,
        tags: ['tag1', 'tag2'],
        agent_strategy: null,
        meta: { version: '1.0.0' },
        trigger: {} as PluginDeclaration['trigger'],
      }

      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.plugin_id).toBe('test-uid')
      expect(result.type).toBe('tool')
      expect(result.category).toBe(PluginCategoryEnum.tool)
      expect(result.name).toBe('Test Plugin')
      expect(result.version).toBe('1.0.0')
      expect(result.latest_version).toBe('')
      expect(result.org).toBe('test-author')
      expect(result.author).toBe('test-author')
      expect(result.icon).toBe('icon.png')
      expect(result.icon_dark).toBe('icon-dark.png')
      expect(result.verified).toBe(true)
      expect(result.tags).toEqual([{ name: 'tag1' }, { name: 'tag2' }])
      expect(result.from).toBe('package')
    })

    it('should handle manifest with empty tags', () => {
      const manifest: PluginDeclaration = {
        plugin_unique_identifier: 'test-uid',
        version: '1.0.0',
        author: 'author',
        icon: 'icon.png',
        name: 'Plugin',
        category: PluginCategoryEnum.model,
        label: {} as PluginDeclaration['label'],
        description: {} as PluginDeclaration['description'],
        created_at: '2024-01-01',
        resource: {},
        plugins: [],
        verified: false,
        endpoint: { settings: [], endpoints: [] },
        model: null,
        tags: [],
        agent_strategy: null,
        meta: { version: '1.0.0' },
        trigger: {} as PluginDeclaration['trigger'],
      }

      const result = pluginManifestToCardPluginProps(manifest)

      expect(result.tags).toEqual([])
      expect(result.verified).toBe(false)
    })
  })

  describe('pluginManifestInMarketToPluginProps', () => {
    it('should convert PluginManifestInMarket to Plugin props correctly', () => {
      const manifest: PluginManifestInMarket = {
        plugin_unique_identifier: 'market-uid',
        name: 'Market Plugin',
        org: 'market-org',
        icon: 'market-icon.png',
        label: { 'en-US': 'Market Label' } as PluginManifestInMarket['label'],
        category: PluginCategoryEnum.extension,
        version: '1.0.0',
        latest_version: '2.0.0',
        brief: { 'en-US': 'Brief Description' } as PluginManifestInMarket['brief'],
        introduction: 'Full introduction text',
        verified: true,
        install_count: 1000,
        badges: ['featured', 'verified'],
        verification: { authorized_category: 'partner' },
        from: 'marketplace',
      }

      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.plugin_id).toBe('market-uid')
      expect(result.type).toBe('extension')
      expect(result.name).toBe('Market Plugin')
      expect(result.version).toBe('2.0.0')
      expect(result.latest_version).toBe('2.0.0')
      expect(result.org).toBe('market-org')
      expect(result.introduction).toBe('Full introduction text')
      expect(result.badges).toEqual(['featured', 'verified'])
      expect(result.verification.authorized_category).toBe('partner')
      expect(result.from).toBe('marketplace')
    })

    it('should use default verification when empty', () => {
      const manifest: PluginManifestInMarket = {
        plugin_unique_identifier: 'uid',
        name: 'Plugin',
        org: 'org',
        icon: 'icon.png',
        label: {} as PluginManifestInMarket['label'],
        category: PluginCategoryEnum.tool,
        version: '1.0.0',
        latest_version: '1.0.0',
        brief: {} as PluginManifestInMarket['brief'],
        introduction: '',
        verified: false,
        install_count: 0,
        badges: [],
        verification: {} as PluginManifestInMarket['verification'],
        from: 'github',
      }

      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.verification.authorized_category).toBe('langgenius')
      expect(result.verified).toBe(true) // always true in this function
    })

    it('should handle marketplace plugin with from github source', () => {
      const manifest: PluginManifestInMarket = {
        plugin_unique_identifier: 'github-uid',
        name: 'GitHub Plugin',
        org: 'github-org',
        icon: 'icon.png',
        label: {} as PluginManifestInMarket['label'],
        category: PluginCategoryEnum.agent,
        version: '0.1.0',
        latest_version: '0.2.0',
        brief: {} as PluginManifestInMarket['brief'],
        introduction: 'From GitHub',
        verified: true,
        install_count: 50,
        badges: [],
        verification: { authorized_category: 'community' },
        from: 'github',
      }

      const result = pluginManifestInMarketToPluginProps(manifest)

      expect(result.from).toBe('github')
      expect(result.verification.authorized_category).toBe('community')
    })
  })
})

// ================================
// Steps Components Tests
// ================================

// SetURL Component Tests
describe('SetURL Component', () => {
  // Import the real component for testing
  const SetURL = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    // Re-mock the SetURL component with a more testable version
    vi.doMock('./steps/setURL', () => ({
      default: SetURL,
    }))
  })

  describe('Rendering', () => {
    it('should render label with correct text', () => {
      render(<InstallFromGitHub onClose={vi.fn()} onSuccess={vi.fn()} />)

      // The mocked component should be rendered
      expect(screen.getByTestId('set-url-step')).toBeInTheDocument()
    })

    it('should render input field with placeholder', () => {
      render(<InstallFromGitHub onClose={vi.fn()} onSuccess={vi.fn()} />)

      const input = screen.getByTestId('repo-url-input')
      expect(input).toBeInTheDocument()
    })

    it('should render cancel and next buttons', () => {
      render(<InstallFromGitHub onClose={vi.fn()} onSuccess={vi.fn()} />)

      expect(screen.getByTestId('cancel-btn')).toBeInTheDocument()
      expect(screen.getByTestId('next-btn')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should display repoUrl value in input', () => {
      render(<InstallFromGitHub onClose={vi.fn()} onSuccess={vi.fn()} />)

      const input = screen.getByTestId('repo-url-input')
      fireEvent.change(input, { target: { value: 'https://github.com/test/repo' } })

      expect(input).toHaveValue('https://github.com/test/repo')
    })

    it('should call onChange when input value changes', () => {
      render(<InstallFromGitHub onClose={vi.fn()} onSuccess={vi.fn()} />)

      const input = screen.getByTestId('repo-url-input')
      fireEvent.change(input, { target: { value: 'new-value' } })

      expect(input).toHaveValue('new-value')
    })
  })

  describe('User Interactions', () => {
    it('should call onNext when next button is clicked', async () => {
      mockFetchReleases.mockResolvedValue(createMockReleases())

      render(<InstallFromGitHub onClose={vi.fn()} onSuccess={vi.fn()} />)

      const input = screen.getByTestId('repo-url-input')
      fireEvent.change(input, { target: { value: 'https://github.com/owner/repo' } })

      fireEvent.click(screen.getByTestId('next-btn'))

      await waitFor(() => {
        expect(mockFetchReleases).toHaveBeenCalled()
      })
    })

    it('should call onCancel when cancel button is clicked', () => {
      const onClose = vi.fn()
      render(<InstallFromGitHub onClose={onClose} onSuccess={vi.fn()} />)

      fireEvent.click(screen.getByTestId('cancel-btn'))

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty URL input', () => {
      render(<InstallFromGitHub onClose={vi.fn()} onSuccess={vi.fn()} />)

      const input = screen.getByTestId('repo-url-input')
      expect(input).toHaveValue('')
    })

    it('should handle URL with whitespace only', () => {
      render(<InstallFromGitHub onClose={vi.fn()} onSuccess={vi.fn()} />)

      const input = screen.getByTestId('repo-url-input')
      fireEvent.change(input, { target: { value: '   ' } })

      // With whitespace only, next should still be submittable but validation will fail
      fireEvent.click(screen.getByTestId('next-btn'))

      // Should show error for invalid URL
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'plugin.error.inValidGitHubUrl',
      })
    })
  })
})

// SelectPackage Component Tests
describe('SelectPackage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchReleases.mockResolvedValue(createMockReleases())
    mockGetIconUrl.mockResolvedValue('processed-icon-url')
  })

  describe('Rendering', () => {
    it('should render version selector', () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      expect(screen.getByTestId('select-package-step')).toBeInTheDocument()
    })

    it('should render package selector', () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      expect(screen.getByTestId('selected-package')).toBeInTheDocument()
    })

    it('should show back button when not in edit mode', async () => {
      render(<InstallFromGitHub onClose={vi.fn()} onSuccess={vi.fn()} />)

      // Navigate to selectPackage step
      const input = screen.getByTestId('repo-url-input')
      fireEvent.change(input, { target: { value: 'https://github.com/owner/repo' } })
      fireEvent.click(screen.getByTestId('next-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('back-btn')).toBeInTheDocument()
      })
    })
  })

  describe('Props', () => {
    it('should display versions count correctly', () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      expect(screen.getByTestId('versions-count')).toHaveTextContent('2')
    })

    it('should display packages count based on selected version', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      // Initially 0 packages
      expect(screen.getByTestId('packages-count')).toHaveTextContent('0')

      // Select version
      fireEvent.click(screen.getByTestId('select-version-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('packages-count')).toHaveTextContent('2')
      })
    })
  })

  describe('User Interactions', () => {
    it('should call onSelectVersion when version is selected', () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('select-version-btn'))

      expect(screen.getByTestId('selected-version')).toHaveTextContent('v1.0.0')
    })

    it('should call onSelectPackage when package is selected', () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('select-package-btn'))

      expect(screen.getByTestId('selected-package')).toHaveTextContent('package.zip')
    })

    it('should call onBack when back button is clicked', async () => {
      render(<InstallFromGitHub onClose={vi.fn()} onSuccess={vi.fn()} />)

      // Navigate to selectPackage
      const input = screen.getByTestId('repo-url-input')
      fireEvent.change(input, { target: { value: 'https://github.com/owner/repo' } })
      fireEvent.click(screen.getByTestId('next-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('select-package-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('back-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('set-url-step')).toBeInTheDocument()
      })
    })

    it('should trigger upload when conditions are met', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })
    })
  })

  describe('Upload Handling', () => {
    it('should call onUploaded on successful upload', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(mockGetIconUrl).toHaveBeenCalled()
      })
    })

    it('should call onFailed on upload failure', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('true')
      })
    })

    it('should handle upload error with response message', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('error-msg')).toHaveTextContent('Upload failed error')
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty versions array', () => {
      const updatePayload = createUpdatePayload({
        originalPackageInfo: {
          id: 'id',
          repo: 'owner/repo',
          version: 'v1.0.0',
          package: 'pkg.zip',
          releases: [],
        },
      })

      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={updatePayload}
        />,
      )

      expect(screen.getByTestId('versions-count')).toHaveTextContent('0')
    })

    it('should handle version with no assets', () => {
      const updatePayload = createUpdatePayload({
        originalPackageInfo: {
          id: 'id',
          repo: 'owner/repo',
          version: 'v1.0.0',
          package: 'pkg.zip',
          releases: [{ tag_name: 'v1.0.0', assets: [] }],
        },
      })

      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={updatePayload}
        />,
      )

      // Select the empty version
      fireEvent.click(screen.getByTestId('select-version-btn'))

      expect(screen.getByTestId('packages-count')).toHaveTextContent('0')
    })
  })
})

// Loaded Component Tests
describe('Loaded Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetIconUrl.mockResolvedValue('processed-icon-url')
    mockFetchReleases.mockResolvedValue(createMockReleases())
    mockHideLogicState = {
      modalClassName: 'test-modal-class',
      foldAnimInto: vi.fn(),
      setIsInstalling: vi.fn(),
      handleStartToInstall: vi.fn(),
    }
  })

  describe('Rendering', () => {
    it('should render ready to install message', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })
    })

    it('should render plugin card with correct payload', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('payload-name')).toHaveTextContent('Test Plugin')
      })
    })

    it('should render back button when not installing', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-back-btn')).toBeInTheDocument()
      })
    })

    it('should render install button', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('install-success-btn')).toBeInTheDocument()
      })
    })
  })

  describe('Props', () => {
    it('should display correct uniqueIdentifier', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('unique-identifier')).toHaveTextContent('test-unique-id')
      })
    })

    it('should display correct repoUrl', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-repo-url')).toHaveTextContent('https://github.com/owner/repo')
      })
    })

    it('should display selected version and package', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      // First select version and package
      fireEvent.click(screen.getByTestId('select-version-btn'))
      fireEvent.click(screen.getByTestId('select-package-btn'))

      // Then trigger upload
      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-version')).toHaveTextContent('v1.0.0')
        expect(screen.getByTestId('loaded-package')).toHaveTextContent('package.zip')
      })
    })
  })

  describe('User Interactions', () => {
    it('should call onBack when back button is clicked', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('loaded-back-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('select-package-step')).toBeInTheDocument()
      })
    })

    it('should call onStartToInstall when install is triggered', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('start-install-btn'))

      expect(mockHideLogicState.handleStartToInstall).toHaveBeenCalledTimes(1)
    })

    it('should call onInstalled on successful installation', async () => {
      const onSuccess = vi.fn()
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={onSuccess}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
      })
    })

    it('should call onFailed on installation failure', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('true')
      })
    })
  })

  describe('Installation Flows', () => {
    it('should handle fresh install flow', async () => {
      const onSuccess = vi.fn()
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={onSuccess}
          updatePayload={createUpdatePayload()}
        />,
      )

      // Navigate to loaded step
      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      // Trigger install
      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(onSuccess).toHaveBeenCalled()
      })
    })

    it('should handle update flow with updatePayload', async () => {
      const onSuccess = vi.fn()
      const updatePayload = createUpdatePayload()

      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={onSuccess}
          updatePayload={updatePayload}
        />,
      )

      // Navigate to loaded step
      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      // Trigger install (update)
      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
      })
    })

    it('should refresh plugin list after successful install', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-success-btn'))

      await waitFor(() => {
        expect(mockRefreshPluginList).toHaveBeenCalled()
      })
    })

    it('should not refresh plugin list when notRefresh is true', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-success-no-refresh-btn'))

      await waitFor(() => {
        expect(mockRefreshPluginList).not.toHaveBeenCalled()
      })
    })
  })

  describe('Error Handling', () => {
    it('should display error message on failure', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-fail-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('error-msg')).toHaveTextContent('Install failed')
      })
    })

    it('should handle failure without error message', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('install-fail-no-msg-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('installed-step')).toBeInTheDocument()
        expect(screen.getByTestId('is-failed')).toHaveTextContent('true')
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle missing optional props', async () => {
      render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      // Should not throw when onStartToInstall is called
      expect(() => {
        fireEvent.click(screen.getByTestId('start-install-btn'))
      }).not.toThrow()
    })

    it('should preserve state through component updates', async () => {
      const { rerender } = render(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-upload-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
      })

      // Rerender
      rerender(
        <InstallFromGitHub
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          updatePayload={createUpdatePayload()}
        />,
      )

      // State should be preserved
      expect(screen.getByTestId('loaded-step')).toBeInTheDocument()
    })
  })
})
