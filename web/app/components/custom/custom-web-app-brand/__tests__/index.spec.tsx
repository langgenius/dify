import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useWebAppBrand from '../hooks/use-web-app-brand'
import CustomWebAppBrand from '../index'

vi.mock('../hooks/use-web-app-brand', () => ({
  default: vi.fn(),
}))

const mockUseWebAppBrand = vi.mocked(useWebAppBrand)

const createHookState = (overrides: Partial<ReturnType<typeof useWebAppBrand>> = {}): ReturnType<typeof useWebAppBrand> => ({
  fileId: '',
  imgKey: 100,
  uploadProgress: 0,
  uploading: false,
  webappLogo: 'https://example.com/replace.png',
  webappBrandRemoved: false,
  uploadDisabled: false,
  workspaceLogo: 'https://example.com/workspace-logo.png',
  isSandbox: false,
  isCurrentWorkspaceManager: true,
  handleApply: vi.fn(),
  handleCancel: vi.fn(),
  handleChange: vi.fn(),
  handleRestore: vi.fn(),
  handleSwitch: vi.fn(),
  ...overrides,
})

const renderComponent = (overrides: Partial<ReturnType<typeof useWebAppBrand>> = {}) => {
  const hookState = createHookState(overrides)
  mockUseWebAppBrand.mockReturnValue(hookState)
  return {
    hookState,
    ...render(<CustomWebAppBrand />),
  }
}

describe('CustomWebAppBrand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Integration coverage for the root component with the hook mocked at the boundary.
  describe('Rendering', () => {
    it('should render the upload controls and preview cards with restore action', () => {
      renderComponent()

      expect(screen.getByText('custom.webapp.removeBrand')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'custom.restore' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'custom.change' })).toBeInTheDocument()
      expect(screen.getByText('Chatflow App')).toBeInTheDocument()
      expect(screen.getByText('Workflow App')).toBeInTheDocument()
    })

    it('should hide the restore action when uploads are disabled or no logo is configured', () => {
      renderComponent({
        uploadDisabled: true,
        webappLogo: '',
      })

      expect(screen.queryByRole('button', { name: 'custom.restore' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'custom.upload' })).toBeDisabled()
    })

    it('should show the uploading button and failure message when upload state requires it', () => {
      renderComponent({
        uploading: true,
        uploadProgress: -1,
      })

      expect(screen.getByRole('button', { name: 'custom.uploading' })).toBeDisabled()
      expect(screen.getByText('custom.uploadedFail')).toBeInTheDocument()
    })

    it('should show apply and cancel actions when a new file is ready', () => {
      renderComponent({
        fileId: 'new-logo',
      })

      expect(screen.getByRole('button', { name: 'custom.apply' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeInTheDocument()
    })

    it('should disable the switch when sandbox restrictions are active', () => {
      renderComponent({
        isSandbox: true,
      })

      expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
    })

    it('should default the switch to unchecked when brand removal state is missing', () => {
      const { container } = renderComponent({
        webappBrandRemoved: undefined,
      })

      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
      expect(container.querySelector('.opacity-30')).not.toBeInTheDocument()
    })

    it('should dim the upload row when brand removal is enabled', () => {
      const { container } = renderComponent({
        webappBrandRemoved: true,
        uploadDisabled: true,
      })

      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
      expect(container.querySelector('.opacity-30')).toBeInTheDocument()
    })
  })

  // User interactions delegated to the hook callbacks.
  describe('Interactions', () => {
    it('should delegate switch changes to the hook handler', () => {
      const { hookState } = renderComponent()

      fireEvent.click(screen.getByRole('switch'))

      expect(hookState.handleSwitch).toHaveBeenCalledWith(true)
    })

    it('should delegate file input changes and reset the native input value on click', () => {
      const { container, hookState } = renderComponent()
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['logo'], 'logo.png', { type: 'image/png' })

      Object.defineProperty(fileInput, 'value', {
        configurable: true,
        value: 'stale-selection',
        writable: true,
      })

      fireEvent.click(fileInput)
      fireEvent.change(fileInput, {
        target: { files: [file] },
      })

      expect(fileInput.value).toBe('')
      expect(hookState.handleChange).toHaveBeenCalledTimes(1)
    })

    it('should delegate restore, cancel, and apply actions to the hook handlers', () => {
      const { hookState } = renderComponent({
        fileId: 'new-logo',
      })

      fireEvent.click(screen.getByRole('button', { name: 'custom.restore' }))
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      fireEvent.click(screen.getByRole('button', { name: 'custom.apply' }))

      expect(hookState.handleRestore).toHaveBeenCalledTimes(1)
      expect(hookState.handleCancel).toHaveBeenCalledTimes(1)
      expect(hookState.handleApply).toHaveBeenCalledTimes(1)
    })
  })
})
