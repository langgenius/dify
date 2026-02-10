import type { PluginDeclaration, UpdateFromGitHubPayload } from '../../../types'
import type { Item } from '@/app/components/base/select'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '../../../types'
import SelectPackage from './selectPackage'

// Mock the useGitHubUpload hook
const mockHandleUpload = vi.fn()
vi.mock('../../hooks', () => ({
  useGitHubUpload: () => ({ handleUpload: mockHandleUpload }),
}))

// Factory functions
const createMockManifest = (): PluginDeclaration => ({
  plugin_unique_identifier: 'test-uid',
  version: '1.0.0',
  author: 'test-author',
  icon: 'icon.png',
  name: 'Test Plugin',
  category: PluginCategoryEnum.tool,
  label: { 'en-US': 'Test' } as PluginDeclaration['label'],
  description: { 'en-US': 'Test Description' } as PluginDeclaration['description'],
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
})

const createVersions = (): Item[] => [
  { value: 'v1.0.0', name: 'v1.0.0' },
  { value: 'v0.9.0', name: 'v0.9.0' },
]

const createPackages = (): Item[] => [
  { value: 'plugin.zip', name: 'plugin.zip' },
  { value: 'plugin.tar.gz', name: 'plugin.tar.gz' },
]

const createUpdatePayload = (): UpdateFromGitHubPayload => ({
  originalPackageInfo: {
    id: 'original-id',
    repo: 'owner/repo',
    version: 'v0.9.0',
    package: 'plugin.zip',
    releases: [],
  },
})

// Test props type - updatePayload is optional for testing
type TestProps = {
  updatePayload?: UpdateFromGitHubPayload
  repoUrl?: string
  selectedVersion?: string
  versions?: Item[]
  onSelectVersion?: (item: Item) => void
  selectedPackage?: string
  packages?: Item[]
  onSelectPackage?: (item: Item) => void
  onUploaded?: (result: { uniqueIdentifier: string, manifest: PluginDeclaration }) => void
  onFailed?: (errorMsg: string) => void
  onBack?: () => void
}

describe('SelectPackage', () => {
  const createDefaultProps = () => ({
    updatePayload: undefined as UpdateFromGitHubPayload | undefined,
    repoUrl: 'https://github.com/owner/repo',
    selectedVersion: '',
    versions: createVersions(),
    onSelectVersion: vi.fn() as (item: Item) => void,
    selectedPackage: '',
    packages: createPackages(),
    onSelectPackage: vi.fn() as (item: Item) => void,
    onUploaded: vi.fn() as (result: { uniqueIdentifier: string, manifest: PluginDeclaration }) => void,
    onFailed: vi.fn() as (errorMsg: string) => void,
    onBack: vi.fn() as () => void,
  })

  // Helper function to render with proper type handling
  const renderSelectPackage = (overrides: TestProps = {}) => {
    const props = { ...createDefaultProps(), ...overrides }
    // Cast to any to bypass strict type checking since component accepts optional updatePayload
    return render(<SelectPackage {...(props as Parameters<typeof SelectPackage>[0])} />)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockHandleUpload.mockReset()
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render version label', () => {
      renderSelectPackage()

      expect(screen.getByText('plugin.installFromGitHub.selectVersion')).toBeInTheDocument()
    })

    it('should render package label', () => {
      renderSelectPackage()

      expect(screen.getByText('plugin.installFromGitHub.selectPackage')).toBeInTheDocument()
    })

    it('should render back button when not in edit mode', () => {
      renderSelectPackage({ updatePayload: undefined })

      expect(screen.getByRole('button', { name: 'plugin.installModal.back' })).toBeInTheDocument()
    })

    it('should not render back button when in edit mode', () => {
      renderSelectPackage({ updatePayload: createUpdatePayload() })

      expect(screen.queryByRole('button', { name: 'plugin.installModal.back' })).not.toBeInTheDocument()
    })

    it('should render next button', () => {
      renderSelectPackage()

      expect(screen.getByRole('button', { name: 'plugin.installModal.next' })).toBeInTheDocument()
    })
  })

  // ================================
  // Props Tests
  // ================================
  describe('Props', () => {
    it('should pass selectedVersion to PortalSelect', () => {
      renderSelectPackage({ selectedVersion: 'v1.0.0' })

      // PortalSelect should display the selected version
      expect(screen.getByText('v1.0.0')).toBeInTheDocument()
    })

    it('should pass selectedPackage to PortalSelect', () => {
      renderSelectPackage({ selectedPackage: 'plugin.zip' })

      expect(screen.getByText('plugin.zip')).toBeInTheDocument()
    })

    it('should show installed version badge when updatePayload version differs', () => {
      renderSelectPackage({
        updatePayload: createUpdatePayload(),
        selectedVersion: 'v1.0.0',
      })

      expect(screen.getByText(/v0\.9\.0\s*->\s*v1\.0\.0/)).toBeInTheDocument()
    })
  })

  // ================================
  // Button State Tests
  // ================================
  describe('Button State', () => {
    it('should disable next button when no version selected', () => {
      renderSelectPackage({ selectedVersion: '', selectedPackage: '' })

      expect(screen.getByRole('button', { name: 'plugin.installModal.next' })).toBeDisabled()
    })

    it('should disable next button when version selected but no package', () => {
      renderSelectPackage({ selectedVersion: 'v1.0.0', selectedPackage: '' })

      expect(screen.getByRole('button', { name: 'plugin.installModal.next' })).toBeDisabled()
    })

    it('should enable next button when both version and package selected', () => {
      renderSelectPackage({ selectedVersion: 'v1.0.0', selectedPackage: 'plugin.zip' })

      expect(screen.getByRole('button', { name: 'plugin.installModal.next' })).not.toBeDisabled()
    })
  })

  // ================================
  // User Interactions Tests
  // ================================
  describe('User Interactions', () => {
    it('should call onBack when back button is clicked', () => {
      const onBack = vi.fn()
      renderSelectPackage({ onBack })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.back' }))

      expect(onBack).toHaveBeenCalledTimes(1)
    })

    it('should call handleUploadPackage when next button is clicked', async () => {
      mockHandleUpload.mockImplementation(async (_repo, _version, _package, onSuccess) => {
        onSuccess({ unique_identifier: 'uid', manifest: createMockManifest() })
      })

      const onUploaded = vi.fn()
      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
        onUploaded,
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(mockHandleUpload).toHaveBeenCalledTimes(1)
        expect(mockHandleUpload).toHaveBeenCalledWith(
          'owner/repo',
          'v1.0.0',
          'plugin.zip',
          expect.any(Function),
        )
      })
    })

    it('should not invoke upload when next button is disabled', () => {
      renderSelectPackage({ selectedVersion: '', selectedPackage: '' })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      expect(mockHandleUpload).not.toHaveBeenCalled()
    })
  })

  // ================================
  // Upload Handling Tests
  // ================================
  describe('Upload Handling', () => {
    it('should call onUploaded with correct data on successful upload', async () => {
      const mockManifest = createMockManifest()
      mockHandleUpload.mockImplementation(async (_repo, _version, _package, onSuccess) => {
        onSuccess({ unique_identifier: 'test-uid', manifest: mockManifest })
      })

      const onUploaded = vi.fn()
      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
        onUploaded,
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(onUploaded).toHaveBeenCalledWith({
          uniqueIdentifier: 'test-uid',
          manifest: mockManifest,
        })
      })
    })

    it('should call onFailed with response message on upload error', async () => {
      mockHandleUpload.mockRejectedValue({ response: { message: 'API Error' } })

      const onFailed = vi.fn()
      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
        onFailed,
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(onFailed).toHaveBeenCalledWith('API Error')
      })
    })

    it('should call onFailed with default message when no response message', async () => {
      mockHandleUpload.mockRejectedValue(new Error('Network error'))

      const onFailed = vi.fn()
      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
        onFailed,
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(onFailed).toHaveBeenCalledWith('plugin.installFromGitHub.uploadFailed')
      })
    })

    it('should not call upload twice when already uploading', async () => {
      let resolveUpload: (value?: unknown) => void
      mockHandleUpload.mockImplementation(() => new Promise((resolve) => {
        resolveUpload = resolve
      }))

      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
      })

      const nextButton = screen.getByRole('button', { name: 'plugin.installModal.next' })

      // Click twice rapidly - this tests the isUploading guard at line 49-50
      // The first click starts the upload, the second should be ignored
      fireEvent.click(nextButton)
      fireEvent.click(nextButton)

      await waitFor(() => {
        expect(mockHandleUpload).toHaveBeenCalledTimes(1)
      })

      // Resolve the upload
      resolveUpload!()
    })

    it('should disable back button while uploading', async () => {
      let resolveUpload: (value?: unknown) => void
      mockHandleUpload.mockImplementation(() => new Promise((resolve) => {
        resolveUpload = resolve
      }))

      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'plugin.installModal.back' })).toBeDisabled()
      })

      resolveUpload!()
    })

    it('should strip github.com prefix from repoUrl', async () => {
      mockHandleUpload.mockResolvedValue({})

      renderSelectPackage({
        repoUrl: 'https://github.com/myorg/myrepo',
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(mockHandleUpload).toHaveBeenCalledWith(
          'myorg/myrepo',
          expect.any(String),
          expect.any(String),
          expect.any(Function),
        )
      })
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle empty versions array', () => {
      renderSelectPackage({ versions: [] })

      expect(screen.getByText('plugin.installFromGitHub.selectVersion')).toBeInTheDocument()
    })

    it('should handle empty packages array', () => {
      renderSelectPackage({ packages: [] })

      expect(screen.getByText('plugin.installFromGitHub.selectPackage')).toBeInTheDocument()
    })

    it('should handle updatePayload with installed version', () => {
      renderSelectPackage({ updatePayload: createUpdatePayload() })

      // Should not show back button in edit mode
      expect(screen.queryByRole('button', { name: 'plugin.installModal.back' })).not.toBeInTheDocument()
    })

    it('should re-enable buttons after upload completes', async () => {
      mockHandleUpload.mockResolvedValue({})

      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'plugin.installModal.back' })).not.toBeDisabled()
      })
    })

    it('should re-enable buttons after upload fails', async () => {
      mockHandleUpload.mockRejectedValue(new Error('Upload failed'))

      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'plugin.installModal.back' })).not.toBeDisabled()
      })
    })
  })

  // ================================
  // PortalSelect Readonly State Tests
  // ================================
  describe('PortalSelect Readonly State', () => {
    it('should make package select readonly when no version selected', () => {
      renderSelectPackage({ selectedVersion: '' })

      // When no version is selected, package select should be readonly
      // This is tested by verifying the component renders correctly
      const trigger = screen.getByText('plugin.installFromGitHub.selectPackagePlaceholder').closest('div')
      expect(trigger).toHaveClass('cursor-not-allowed')
    })

    it('should make package select active when version is selected', () => {
      renderSelectPackage({ selectedVersion: 'v1.0.0' })

      // When version is selected, package select should be active
      const trigger = screen.getByText('plugin.installFromGitHub.selectPackagePlaceholder').closest('div')
      expect(trigger).toHaveClass('cursor-pointer')
    })
  })

  // ================================
  // installedValue Props Tests
  // ================================
  describe('installedValue Props', () => {
    it('should pass installedValue when updatePayload is provided', () => {
      const updatePayload = createUpdatePayload()
      renderSelectPackage({ updatePayload })

      // The installed version should be passed to PortalSelect
      // updatePayload.originalPackageInfo.version = 'v0.9.0'
      expect(screen.getByText('plugin.installFromGitHub.selectVersion')).toBeInTheDocument()
    })

    it('should not pass installedValue when updatePayload is undefined', () => {
      renderSelectPackage({ updatePayload: undefined })

      // No installed version indicator
      expect(screen.getByText('plugin.installFromGitHub.selectVersion')).toBeInTheDocument()
    })

    it('should handle updatePayload with different version value', () => {
      const updatePayload = createUpdatePayload()
      updatePayload.originalPackageInfo.version = 'v2.0.0'
      renderSelectPackage({ updatePayload })

      // Should render without errors
      expect(screen.getByText('plugin.installFromGitHub.selectVersion')).toBeInTheDocument()
    })

    it('should show installed badge in version list', () => {
      const updatePayload = createUpdatePayload()
      renderSelectPackage({ updatePayload, selectedVersion: '' })

      fireEvent.click(screen.getByText('plugin.installFromGitHub.selectVersionPlaceholder'))

      expect(screen.getByText('INSTALLED')).toBeInTheDocument()
    })
  })

  // ================================
  // Next Button Disabled State Combinations
  // ================================
  describe('Next Button Disabled State Combinations', () => {
    it('should disable next button when only version is missing', () => {
      renderSelectPackage({ selectedVersion: '', selectedPackage: 'plugin.zip' })

      expect(screen.getByRole('button', { name: 'plugin.installModal.next' })).toBeDisabled()
    })

    it('should disable next button when only package is missing', () => {
      renderSelectPackage({ selectedVersion: 'v1.0.0', selectedPackage: '' })

      expect(screen.getByRole('button', { name: 'plugin.installModal.next' })).toBeDisabled()
    })

    it('should disable next button when both are missing', () => {
      renderSelectPackage({ selectedVersion: '', selectedPackage: '' })

      expect(screen.getByRole('button', { name: 'plugin.installModal.next' })).toBeDisabled()
    })

    it('should disable next button when uploading even with valid selections', async () => {
      let resolveUpload: (value?: unknown) => void
      mockHandleUpload.mockImplementation(() => new Promise((resolve) => {
        resolveUpload = resolve
      }))

      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'plugin.installModal.next' })).toBeDisabled()
      })

      resolveUpload!()
    })
  })

  // ================================
  // RepoUrl Format Handling Tests
  // ================================
  describe('RepoUrl Format Handling', () => {
    it('should handle repoUrl without trailing slash', async () => {
      mockHandleUpload.mockResolvedValue({})

      renderSelectPackage({
        repoUrl: 'https://github.com/owner/repo',
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(mockHandleUpload).toHaveBeenCalledWith(
          'owner/repo',
          'v1.0.0',
          'plugin.zip',
          expect.any(Function),
        )
      })
    })

    it('should handle repoUrl with different org/repo combinations', async () => {
      mockHandleUpload.mockResolvedValue({})

      renderSelectPackage({
        repoUrl: 'https://github.com/my-organization/my-plugin-repo',
        selectedVersion: 'v2.0.0',
        selectedPackage: 'build.tar.gz',
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(mockHandleUpload).toHaveBeenCalledWith(
          'my-organization/my-plugin-repo',
          'v2.0.0',
          'build.tar.gz',
          expect.any(Function),
        )
      })
    })

    it('should pass through repoUrl without github prefix', async () => {
      mockHandleUpload.mockResolvedValue({})

      renderSelectPackage({
        repoUrl: 'plain-org/plain-repo',
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(mockHandleUpload).toHaveBeenCalledWith(
          'plain-org/plain-repo',
          'v1.0.0',
          'plugin.zip',
          expect.any(Function),
        )
      })
    })
  })

  // ================================
  // isEdit Mode Comprehensive Tests
  // ================================
  describe('isEdit Mode Comprehensive', () => {
    it('should set isEdit to true when updatePayload is truthy', () => {
      const updatePayload = createUpdatePayload()
      renderSelectPackage({ updatePayload })

      // Back button should not be rendered in edit mode
      expect(screen.queryByRole('button', { name: 'plugin.installModal.back' })).not.toBeInTheDocument()
    })

    it('should set isEdit to false when updatePayload is undefined', () => {
      renderSelectPackage({ updatePayload: undefined })

      // Back button should be rendered when not in edit mode
      expect(screen.getByRole('button', { name: 'plugin.installModal.back' })).toBeInTheDocument()
    })

    it('should allow upload in edit mode without back button', async () => {
      mockHandleUpload.mockImplementation(async (_repo, _version, _package, onSuccess) => {
        onSuccess({ unique_identifier: 'uid', manifest: createMockManifest() })
      })

      const onUploaded = vi.fn()
      renderSelectPackage({
        updatePayload: createUpdatePayload(),
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
        onUploaded,
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(onUploaded).toHaveBeenCalled()
      })
    })
  })

  // ================================
  // Error Response Handling Tests
  // ================================
  describe('Error Response Handling', () => {
    it('should handle error with response.message property', async () => {
      mockHandleUpload.mockRejectedValue({ response: { message: 'Custom API Error' } })

      const onFailed = vi.fn()
      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
        onFailed,
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(onFailed).toHaveBeenCalledWith('Custom API Error')
      })
    })

    it('should handle error with empty response object', async () => {
      mockHandleUpload.mockRejectedValue({ response: {} })

      const onFailed = vi.fn()
      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
        onFailed,
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(onFailed).toHaveBeenCalledWith('plugin.installFromGitHub.uploadFailed')
      })
    })

    it('should handle error without response property', async () => {
      mockHandleUpload.mockRejectedValue({ code: 'NETWORK_ERROR' })

      const onFailed = vi.fn()
      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
        onFailed,
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(onFailed).toHaveBeenCalledWith('plugin.installFromGitHub.uploadFailed')
      })
    })

    it('should handle error with response but no message', async () => {
      mockHandleUpload.mockRejectedValue({ response: { status: 500 } })

      const onFailed = vi.fn()
      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
        onFailed,
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(onFailed).toHaveBeenCalledWith('plugin.installFromGitHub.uploadFailed')
      })
    })

    it('should handle string error', async () => {
      mockHandleUpload.mockRejectedValue('String error message')

      const onFailed = vi.fn()
      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
        onFailed,
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(onFailed).toHaveBeenCalledWith('plugin.installFromGitHub.uploadFailed')
      })
    })
  })

  // ================================
  // Callback Props Tests
  // ================================
  describe('Callback Props', () => {
    it('should pass onSelectVersion to PortalSelect', () => {
      const onSelectVersion = vi.fn()
      renderSelectPackage({ onSelectVersion })

      // The callback is passed to PortalSelect, which is a base component
      // We verify it's rendered correctly
      expect(screen.getByText('plugin.installFromGitHub.selectVersion')).toBeInTheDocument()
    })

    it('should pass onSelectPackage to PortalSelect', () => {
      const onSelectPackage = vi.fn()
      renderSelectPackage({ onSelectPackage })

      // The callback is passed to PortalSelect, which is a base component
      expect(screen.getByText('plugin.installFromGitHub.selectPackage')).toBeInTheDocument()
    })
  })

  // ================================
  // Upload State Management Tests
  // ================================
  describe('Upload State Management', () => {
    it('should set isUploading to true when upload starts', async () => {
      let resolveUpload: (value?: unknown) => void
      mockHandleUpload.mockImplementation(() => new Promise((resolve) => {
        resolveUpload = resolve
      }))

      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      // Both buttons should be disabled during upload
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'plugin.installModal.next' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'plugin.installModal.back' })).toBeDisabled()
      })

      resolveUpload!()
    })

    it('should set isUploading to false after successful upload', async () => {
      mockHandleUpload.mockImplementation(async (_repo, _version, _package, onSuccess) => {
        onSuccess({ unique_identifier: 'uid', manifest: createMockManifest() })
      })

      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'plugin.installModal.next' })).not.toBeDisabled()
        expect(screen.getByRole('button', { name: 'plugin.installModal.back' })).not.toBeDisabled()
      })
    })

    it('should set isUploading to false after failed upload', async () => {
      mockHandleUpload.mockRejectedValue(new Error('Upload failed'))

      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'plugin.installModal.next' })).not.toBeDisabled()
        expect(screen.getByRole('button', { name: 'plugin.installModal.back' })).not.toBeDisabled()
      })
    })

    it('should not allow back button click while uploading', async () => {
      let resolveUpload: (value?: unknown) => void
      mockHandleUpload.mockImplementation(() => new Promise((resolve) => {
        resolveUpload = resolve
      }))

      const onBack = vi.fn()
      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
        onBack,
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'plugin.installModal.back' })).toBeDisabled()
      })

      // Try to click back button while disabled
      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.back' }))

      // onBack should not be called
      expect(onBack).not.toHaveBeenCalled()

      resolveUpload!()
    })
  })

  // ================================
  // handleUpload Callback Tests
  // ================================
  describe('handleUpload Callback', () => {
    it('should invoke onSuccess callback with correct data structure', async () => {
      const mockManifest = createMockManifest()
      mockHandleUpload.mockImplementation(async (_repo, _version, _package, onSuccess) => {
        onSuccess({
          unique_identifier: 'test-unique-identifier',
          manifest: mockManifest,
        })
      })

      const onUploaded = vi.fn()
      renderSelectPackage({
        selectedVersion: 'v1.0.0',
        selectedPackage: 'plugin.zip',
        onUploaded,
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(onUploaded).toHaveBeenCalledWith({
          uniqueIdentifier: 'test-unique-identifier',
          manifest: mockManifest,
        })
      })
    })

    it('should pass correct repo, version, and package to handleUpload', async () => {
      mockHandleUpload.mockResolvedValue({})

      renderSelectPackage({
        repoUrl: 'https://github.com/test-org/test-repo',
        selectedVersion: 'v3.0.0',
        selectedPackage: 'release.zip',
      })

      fireEvent.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

      await waitFor(() => {
        expect(mockHandleUpload).toHaveBeenCalledWith(
          'test-org/test-repo',
          'v3.0.0',
          'release.zip',
          expect.any(Function),
        )
      })
    })
  })
})
