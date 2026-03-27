import type { SandboxProvider } from '@/types/sandbox-provider'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from '@/app/components/base/ui/toast'
import { useActivateSandboxProvider } from '@/service/use-sandbox-provider'
import SwitchModal from '../switch-modal'

const mockUseActivateSandboxProvider = vi.mocked(useActivateSandboxProvider)

vi.mock('@/service/use-sandbox-provider', () => ({
  useActivateSandboxProvider: vi.fn(),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

const createProvider = (overrides: Partial<SandboxProvider> = {}): SandboxProvider => ({
  provider_type: 'e2b',
  is_system_configured: false,
  is_tenant_configured: true,
  is_active: false,
  config: {},
  config_schema: [],
  ...overrides,
})

describe('Sandbox SwitchModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseActivateSandboxProvider.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof useActivateSandboxProvider>)
  })

  // Covers close interactions without activation.
  describe('closing', () => {
    it('should close when clicking the cancel button', () => {
      const onClose = vi.fn()
      render(<SwitchModal provider={createProvider()} onClose={onClose} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.sandboxProvider.switchModal.cancel' }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  // Covers provider activation flows.
  describe('activation', () => {
    it('should activate the provider, show success toast, and close the modal', async () => {
      const mutateAsync = vi.fn().mockResolvedValue(undefined)
      const onClose = vi.fn()
      mockUseActivateSandboxProvider.mockReturnValue({
        mutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof useActivateSandboxProvider>)

      render(<SwitchModal provider={createProvider()} onClose={onClose} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.sandboxProvider.switchModal.confirm' }))

      await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({
        providerType: 'e2b',
        type: 'user',
      }))
      expect(toast.success).toHaveBeenCalledWith('common.api.success')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should disable actions while activation is pending', () => {
      mockUseActivateSandboxProvider.mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: true,
      } as unknown as ReturnType<typeof useActivateSandboxProvider>)

      render(<SwitchModal provider={createProvider()} onClose={vi.fn()} />)

      expect(screen.getByRole('button', { name: 'common.sandboxProvider.switchModal.cancel' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'common.sandboxProvider.switchModal.confirm' })).toBeDisabled()
    })
  })
})
