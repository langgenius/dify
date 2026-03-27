import type { SandboxProvider } from '@/types/sandbox-provider'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { toast } from '@/app/components/base/ui/toast'
import {
  useActivateSandboxProvider,
  useDeleteSandboxProviderConfig,
  useSaveSandboxProviderConfig,
} from '@/service/use-sandbox-provider'
import ConfigModal from '../config-modal'

const mockUseSaveSandboxProviderConfig = vi.mocked(useSaveSandboxProviderConfig)
const mockUseDeleteSandboxProviderConfig = vi.mocked(useDeleteSandboxProviderConfig)
const mockUseActivateSandboxProvider = vi.mocked(useActivateSandboxProvider)

let mockFormValues = {
  isCheckValidated: true,
  values: {
    api_key: 'secret-key',
  },
}

vi.mock('@/service/use-sandbox-provider', () => ({
  useSaveSandboxProviderConfig: vi.fn(),
  useDeleteSandboxProviderConfig: vi.fn(),
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

vi.mock('@/app/components/base/form/components/base', () => ({
  BaseForm: React.forwardRef((_props: object, ref: React.ForwardedRef<{ getFormValues: () => typeof mockFormValues }>) => {
    React.useImperativeHandle(ref, () => ({
      getFormValues: () => mockFormValues,
    }))
    return <div data-testid="base-form" />
  }),
}))

const createProvider = (overrides: Partial<SandboxProvider> = {}): SandboxProvider => ({
  provider_type: 'e2b',
  is_system_configured: true,
  is_tenant_configured: false,
  is_active: false,
  config: {},
  config_schema: [
    { name: 'api_key', type: 'secret' },
  ],
  ...overrides,
})

describe('Sandbox ConfigModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFormValues = {
      isCheckValidated: true,
      values: {
        api_key: 'secret-key',
      },
    }
    mockUseSaveSandboxProviderConfig.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof useSaveSandboxProviderConfig>)
    mockUseDeleteSandboxProviderConfig.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteSandboxProviderConfig>)
    mockUseActivateSandboxProvider.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof useActivateSandboxProvider>)
  })

  // Covers the managed-mode activation shortcut for providers with system config.
  describe('managed mode', () => {
    it('should activate the managed provider when saving in managed mode', async () => {
      const activateProvider = vi.fn().mockResolvedValue(undefined)
      const onClose = vi.fn()
      mockUseActivateSandboxProvider.mockReturnValue({
        mutateAsync: activateProvider,
        isPending: false,
      } as unknown as ReturnType<typeof useActivateSandboxProvider>)

      render(<ConfigModal provider={createProvider()} onClose={onClose} />)

      expect(screen.queryByTestId('base-form')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'common.sandboxProvider.configModal.save' }))

      await waitFor(() => expect(activateProvider).toHaveBeenCalledWith({
        providerType: 'e2b',
        type: 'system',
      }))
      expect(toast.success).toHaveBeenCalledWith('common.api.saved')
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  // Covers BYOK save and revoke flows.
  describe('byok mode', () => {
    it('should switch between managed and BYOK modes for providers that support both', () => {
      render(<ConfigModal provider={createProvider()} onClose={vi.fn()} />)

      expect(screen.queryByTestId('base-form')).not.toBeInTheDocument()

      fireEvent.click(screen.getByText('common.sandboxProvider.configModal.bringYourOwnKey'))
      expect(screen.getByTestId('base-form')).toBeInTheDocument()

      fireEvent.click(screen.getByText('common.sandboxProvider.configModal.managedByDify'))
      expect(screen.queryByTestId('base-form')).not.toBeInTheDocument()
    })

    it('should save BYOK config when the form validates', async () => {
      const saveConfig = vi.fn().mockResolvedValue(undefined)
      const onClose = vi.fn()
      mockUseSaveSandboxProviderConfig.mockReturnValue({
        mutateAsync: saveConfig,
        isPending: false,
      } as unknown as ReturnType<typeof useSaveSandboxProviderConfig>)

      render(<ConfigModal provider={createProvider({ is_system_configured: false })} onClose={onClose} />)

      expect(screen.getByTestId('base-form')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'common.sandboxProvider.configModal.save' }))

      await waitFor(() => expect(saveConfig).toHaveBeenCalledWith({
        providerType: 'e2b',
        config: { api_key: 'secret-key' },
        activate: true,
      }))
      expect(toast.success).toHaveBeenCalledWith('common.api.saved')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should not save when the form validation fails', () => {
      const saveConfig = vi.fn().mockResolvedValue(undefined)
      mockFormValues = {
        isCheckValidated: false,
        values: {
          api_key: '',
        },
      }
      mockUseSaveSandboxProviderConfig.mockReturnValue({
        mutateAsync: saveConfig,
        isPending: false,
      } as unknown as ReturnType<typeof useSaveSandboxProviderConfig>)

      render(<ConfigModal provider={createProvider({ is_system_configured: false })} onClose={vi.fn()} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.sandboxProvider.configModal.save' }))
      expect(saveConfig).not.toHaveBeenCalled()
    })

    it('should revoke tenant config when revoke is available', async () => {
      const deleteConfig = vi.fn().mockResolvedValue(undefined)
      const onClose = vi.fn()
      mockUseDeleteSandboxProviderConfig.mockReturnValue({
        mutateAsync: deleteConfig,
        isPending: false,
      } as unknown as ReturnType<typeof useDeleteSandboxProviderConfig>)

      render(
        <ConfigModal
          provider={createProvider({
            is_system_configured: false,
            is_tenant_configured: true,
          })}
          onClose={onClose}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'common.sandboxProvider.configModal.revoke' }))

      await waitFor(() => expect(deleteConfig).toHaveBeenCalledWith('e2b'))
      expect(toast.success).toHaveBeenCalledWith('common.api.remove')
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
