import type { Dependency, PluginDeclaration } from '../../../types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '../../../types'
import Uploading from './uploading'

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

const createMockDependencies = (): Dependency[] => [
  {
    type: 'package',
    value: {
      unique_identifier: 'dep-1',
      manifest: createMockManifest({ name: 'Dep Plugin 1' }),
    },
  },
]

const createMockFile = (name: string = 'test-plugin.difypkg'): File => {
  return new File(['test content'], name, { type: 'application/octet-stream' })
}

// Mock external dependencies
const mockUploadFile = vi.fn()
vi.mock('@/service/plugins', () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}))

vi.mock('../../../card', () => ({
  default: ({ payload, isLoading, loadingFileName }: {
    payload: { name: string }
    isLoading?: boolean
    loadingFileName?: string
  }) => (
    <div data-testid="card">
      <span data-testid="card-name">{payload?.name}</span>
      <span data-testid="card-is-loading">{isLoading ? 'true' : 'false'}</span>
      <span data-testid="card-loading-filename">{loadingFileName || 'null'}</span>
    </div>
  ),
}))

describe('Uploading', () => {
  const defaultProps = {
    isBundle: false,
    file: createMockFile(),
    onCancel: vi.fn(),
    onPackageUploaded: vi.fn(),
    onBundleUploaded: vi.fn(),
    onFailed: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUploadFile.mockReset()
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render uploading message with file name', () => {
      render(<Uploading {...defaultProps} />)

      expect(screen.getByText(/plugin.installModal.uploadingPackage/)).toBeInTheDocument()
    })

    it('should render loading spinner', () => {
      render(<Uploading {...defaultProps} />)

      // The spinner has animate-spin-slow class
      const spinner = document.querySelector('.animate-spin-slow')
      expect(spinner).toBeInTheDocument()
    })

    it('should render card with loading state', () => {
      render(<Uploading {...defaultProps} />)

      expect(screen.getByTestId('card-is-loading')).toHaveTextContent('true')
    })

    it('should render card with file name', () => {
      const file = createMockFile('my-plugin.difypkg')
      render(<Uploading {...defaultProps} file={file} />)

      expect(screen.getByTestId('card-name')).toHaveTextContent('my-plugin.difypkg')
      expect(screen.getByTestId('card-loading-filename')).toHaveTextContent('my-plugin.difypkg')
    })

    it('should render cancel button', () => {
      render(<Uploading {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeInTheDocument()
    })

    it('should render disabled install button', () => {
      render(<Uploading {...defaultProps} />)

      const installButton = screen.getByRole('button', { name: 'plugin.installModal.install' })
      expect(installButton).toBeDisabled()
    })
  })

  // ================================
  // Upload Behavior Tests
  // ================================
  describe('Upload Behavior', () => {
    it('should call uploadFile on mount', async () => {
      mockUploadFile.mockResolvedValue({})

      render(<Uploading {...defaultProps} />)

      await waitFor(() => {
        expect(mockUploadFile).toHaveBeenCalledWith(defaultProps.file, false)
      })
    })

    it('should call uploadFile with isBundle=true for bundle files', async () => {
      mockUploadFile.mockResolvedValue({})

      render(<Uploading {...defaultProps} isBundle />)

      await waitFor(() => {
        expect(mockUploadFile).toHaveBeenCalledWith(defaultProps.file, true)
      })
    })

    it('should call onFailed when upload fails with error message', async () => {
      const errorMessage = 'Upload failed: file too large'
      mockUploadFile.mockRejectedValue({
        response: { message: errorMessage },
      })

      const onFailed = vi.fn()
      render(<Uploading {...defaultProps} onFailed={onFailed} />)

      await waitFor(() => {
        expect(onFailed).toHaveBeenCalledWith(errorMessage)
      })
    })

    // NOTE: The uploadFile API has an unconventional contract where it always rejects.
    // Success vs failure is determined by whether response.message exists:
    // - If response.message exists → treated as failure (calls onFailed)
    // - If response.message is absent → treated as success (calls onPackageUploaded/onBundleUploaded)
    // This explains why we use mockRejectedValue for "success" scenarios below.

    it('should call onPackageUploaded when upload rejects without error message (success case)', async () => {
      const mockResult = {
        unique_identifier: 'test-uid',
        manifest: createMockManifest(),
      }
      mockUploadFile.mockRejectedValue({
        response: mockResult,
      })

      const onPackageUploaded = vi.fn()
      render(
        <Uploading
          {...defaultProps}
          isBundle={false}
          onPackageUploaded={onPackageUploaded}
        />,
      )

      await waitFor(() => {
        expect(onPackageUploaded).toHaveBeenCalledWith({
          uniqueIdentifier: mockResult.unique_identifier,
          manifest: mockResult.manifest,
        })
      })
    })

    it('should call onBundleUploaded when upload rejects without error message (success case)', async () => {
      const mockDependencies = createMockDependencies()
      mockUploadFile.mockRejectedValue({
        response: mockDependencies,
      })

      const onBundleUploaded = vi.fn()
      render(
        <Uploading
          {...defaultProps}
          isBundle
          onBundleUploaded={onBundleUploaded}
        />,
      )

      await waitFor(() => {
        expect(onBundleUploaded).toHaveBeenCalledWith(mockDependencies)
      })
    })
  })

  // ================================
  // Cancel Button Tests
  // ================================
  describe('Cancel Button', () => {
    it('should call onCancel when cancel button is clicked', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      render(<Uploading {...defaultProps} onCancel={onCancel} />)

      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })

  // ================================
  // File Name Display Tests
  // ================================
  describe('File Name Display', () => {
    it('should display correct file name for package file', () => {
      const file = createMockFile('custom-plugin.difypkg')
      render(<Uploading {...defaultProps} file={file} />)

      expect(screen.getByTestId('card-name')).toHaveTextContent('custom-plugin.difypkg')
    })

    it('should display correct file name for bundle file', () => {
      const file = createMockFile('custom-bundle.difybndl')
      render(<Uploading {...defaultProps} file={file} isBundle />)

      expect(screen.getByTestId('card-name')).toHaveTextContent('custom-bundle.difybndl')
    })

    it('should display file name in uploading message', () => {
      const file = createMockFile('special-plugin.difypkg')
      render(<Uploading {...defaultProps} file={file} />)

      // The message includes the file name as a parameter
      expect(screen.getByText(/plugin\.installModal\.uploadingPackage/)).toHaveTextContent('special-plugin.difypkg')
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle empty response gracefully', async () => {
      mockUploadFile.mockRejectedValue({
        response: {},
      })

      const onPackageUploaded = vi.fn()
      render(<Uploading {...defaultProps} onPackageUploaded={onPackageUploaded} />)

      await waitFor(() => {
        expect(onPackageUploaded).toHaveBeenCalledWith({
          uniqueIdentifier: undefined,
          manifest: undefined,
        })
      })
    })

    it('should handle response with only unique_identifier', async () => {
      mockUploadFile.mockRejectedValue({
        response: { unique_identifier: 'only-uid' },
      })

      const onPackageUploaded = vi.fn()
      render(<Uploading {...defaultProps} onPackageUploaded={onPackageUploaded} />)

      await waitFor(() => {
        expect(onPackageUploaded).toHaveBeenCalledWith({
          uniqueIdentifier: 'only-uid',
          manifest: undefined,
        })
      })
    })

    it('should handle file with special characters in name', () => {
      const file = createMockFile('my plugin (v1.0).difypkg')
      render(<Uploading {...defaultProps} file={file} />)

      expect(screen.getByTestId('card-name')).toHaveTextContent('my plugin (v1.0).difypkg')
    })
  })

  // ================================
  // Props Variations Tests
  // ================================
  describe('Props Variations', () => {
    it('should work with different file types', () => {
      const files = [
        createMockFile('plugin-a.difypkg'),
        createMockFile('plugin-b.zip'),
        createMockFile('bundle.difybndl'),
      ]

      files.forEach((file) => {
        const { unmount } = render(<Uploading {...defaultProps} file={file} />)
        expect(screen.getByTestId('card-name')).toHaveTextContent(file.name)
        unmount()
      })
    })

    it('should pass isBundle=false to uploadFile for package files', async () => {
      mockUploadFile.mockResolvedValue({})

      render(<Uploading {...defaultProps} isBundle={false} />)

      await waitFor(() => {
        expect(mockUploadFile).toHaveBeenCalledWith(expect.anything(), false)
      })
    })

    it('should pass isBundle=true to uploadFile for bundle files', async () => {
      mockUploadFile.mockResolvedValue({})

      render(<Uploading {...defaultProps} isBundle />)

      await waitFor(() => {
        expect(mockUploadFile).toHaveBeenCalledWith(expect.anything(), true)
      })
    })
  })
})
