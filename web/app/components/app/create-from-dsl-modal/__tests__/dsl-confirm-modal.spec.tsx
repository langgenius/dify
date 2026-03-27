import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/app/components/base/ui/toast'
import DSLConfirmModal from '../dsl-confirm-modal'

const mockPush = vi.fn()
const mockHandleCheckPluginDependencies = vi.fn()
const mockImportAppBundle = vi.fn()
const mockGetRedirection = vi.fn()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: true,
  }),
}))

vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

vi.mock('@/service/apps', () => ({
  importAppBundle: (...args: unknown[]) => mockImportAppBundle(...args),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/utils/app-redirection', () => ({
  getRedirection: (...args: unknown[]) => mockGetRedirection(...args),
}))

describe('DSLConfirmModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandleCheckPluginDependencies.mockResolvedValue(undefined)
  })

  it('should call onConfirm directly for non-zip files', () => {
    const onConfirm = vi.fn()

    render(
      <DSLConfirmModal
        file={new File(['yaml'], 'demo.yml', { type: 'text/yaml' })}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'app.newApp.Confirm' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(mockImportAppBundle).not.toHaveBeenCalled()
  })

  it('should import zip bundles and redirect on success', async () => {
    mockImportAppBundle.mockResolvedValue({
      status: 'completed',
      app_id: 'app-1',
      app_mode: 'chat',
    })
    const onCancel = vi.fn()
    const onSuccess = vi.fn()

    render(
      <DSLConfirmModal
        file={new File(['zip'], 'demo.zip', { type: 'application/zip' })}
        onCancel={onCancel}
        onConfirm={vi.fn()}
        onSuccess={onSuccess}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'app.newApp.Confirm' }))

    await waitFor(() => {
      expect(mockImportAppBundle).toHaveBeenCalledTimes(1)
    })
    expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('app-1')
    expect(mockGetRedirection).toHaveBeenCalledWith(true, { id: 'app-1', mode: 'chat' }, mockPush)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should keep the confirm button disabled when requested', () => {
    render(
      <DSLConfirmModal
        confirmDisabled
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'app.newApp.Confirm' })).toBeDisabled()
  })

  it('should show warning and failure toasts for zip bundle edge cases', async () => {
    mockImportAppBundle.mockResolvedValueOnce({
      status: 'completed-with-warnings',
      app_id: 'app-2',
      app_mode: 'workflow',
    }).mockResolvedValueOnce({
      status: 'failed',
    })

    const warningModal = render(
      <DSLConfirmModal
        file={new File(['zip'], 'warning.zip', { type: 'application/zip' })}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'app.newApp.Confirm' }))

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith('app.newApp.caution', { description: 'app.newApp.appCreateDSLWarning' })
    })

    warningModal.unmount()

    render(
      <DSLConfirmModal
        file={new File(['zip'], 'failed.zip', { type: 'application/zip' })}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'app.newApp.Confirm' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('app.importBundleFailed')
    })
  })

  it('should surface bundle import errors and invoke cancel actions', async () => {
    const onCancel = vi.fn()
    mockImportAppBundle.mockRejectedValue(new Error('boom'))

    render(
      <DSLConfirmModal
        file={new File(['zip'], 'broken.zip', { type: 'application/zip' })}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'app.newApp.Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'app.newApp.Confirm' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('boom')
    })
  })
})
