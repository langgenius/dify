import type { SandboxProvider } from '@/types/sandbox-provider'
import { useQuery } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { useAppContext } from '@/context/app-context'
import {
  useActivateSandboxProvider,
  useDeleteSandboxProviderConfig,
  useSaveSandboxProviderConfig,
} from '@/service/use-sandbox-provider'
import SandboxProviderPage from '../index'

const mockUseQuery = vi.mocked(useQuery)
const mockUseAppContext = vi.mocked(useAppContext)
const mockUseSaveSandboxProviderConfig = vi.mocked(useSaveSandboxProviderConfig)
const mockUseDeleteSandboxProviderConfig = vi.mocked(useDeleteSandboxProviderConfig)
const mockUseActivateSandboxProvider = vi.mocked(useActivateSandboxProvider)

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: vi.fn(),
  }
})

vi.mock('@/context/app-context', async () => {
  const actual = await vi.importActual<typeof import('@/context/app-context')>('@/context/app-context')
  return {
    ...actual,
    useAppContext: vi.fn(),
  }
})

vi.mock('@/service/use-sandbox-provider', () => ({
  useSaveSandboxProviderConfig: vi.fn(),
  useDeleteSandboxProviderConfig: vi.fn(),
  useActivateSandboxProvider: vi.fn(),
}))

vi.mock('@/app/components/base/form/components/base', () => ({
  BaseForm: () => <div data-testid="base-form" />,
}))

const createProvider = (overrides: Partial<SandboxProvider> = {}): SandboxProvider => ({
  provider_type: 'e2b',
  is_system_configured: false,
  is_tenant_configured: true,
  is_active: false,
  config: {},
  config_schema: [{ name: 'api_key', type: 'secret' }],
  ...overrides,
})

describe('SandboxProviderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAppContext.mockReturnValue({
      isCurrentWorkspaceManager: true,
      isLoadingCurrentWorkspace: false,
    } as ReturnType<typeof useAppContext>)
    mockUseQuery.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useQuery>)
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

  // Covers loading fallback while sandbox providers are being fetched.
  describe('loading', () => {
    it('should render the loading state while the provider list is pending', () => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
      } as unknown as ReturnType<typeof useQuery>)

      const { container } = render(<SandboxProviderPage />)
      expect(container.querySelector('[role="status"]')).toBeInTheDocument()
    })
  })

  // Covers section rendering based on provider state and user permission.
  describe('sections', () => {
    it('should render current and other providers along with the no-permission hint', () => {
      mockUseAppContext.mockReturnValue({
        isCurrentWorkspaceManager: false,
        isLoadingCurrentWorkspace: false,
      } as ReturnType<typeof useAppContext>)
      mockUseQuery.mockReturnValue({
        data: [
          createProvider({ provider_type: 'e2b', is_active: true }),
          createProvider({ provider_type: 'docker' }),
        ],
        isLoading: false,
      } as unknown as ReturnType<typeof useQuery>)

      render(<SandboxProviderPage />)

      expect(screen.getByText('common.sandboxProvider.currentProvider')).toBeInTheDocument()
      expect(screen.getByText('common.sandboxProvider.otherProvider')).toBeInTheDocument()
      expect(screen.getByText('E2B')).toBeInTheDocument()
      expect(screen.getByText('Docker')).toBeInTheDocument()
      expect(screen.getByText('common.sandboxProvider.noPermission')).toBeInTheDocument()
    })
  })

  // Covers opening the config and switch modals from card actions.
  describe('modal triggers', () => {
    it('should open config and switch modals from provider card actions', () => {
      mockUseQuery.mockReturnValue({
        data: [
          createProvider({ provider_type: 'e2b', is_active: true }),
          createProvider({ provider_type: 'docker' }),
        ],
        isLoading: false,
      } as unknown as ReturnType<typeof useQuery>)

      const { container } = render(<SandboxProviderPage />)

      const buttons = container.querySelectorAll('button')
      expect(buttons.length).toBeGreaterThanOrEqual(3)

      fireEvent.click(buttons[0])
      expect(screen.getByText('common.sandboxProvider.configModal.title')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'common.sandboxProvider.configModal.cancel' }))
      expect(screen.queryByText('common.sandboxProvider.configModal.title')).not.toBeInTheDocument()

      fireEvent.click(screen.getByText('common.sandboxProvider.setAsActive'))
      expect(screen.getByText('common.sandboxProvider.switchModal.title')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'common.sandboxProvider.switchModal.cancel' }))
      expect(screen.queryByText('common.sandboxProvider.switchModal.title')).not.toBeInTheDocument()
    })

    it('should open the config modal from an inactive provider card', () => {
      mockUseQuery.mockReturnValue({
        data: [
          createProvider({ provider_type: 'e2b', is_active: true }),
          createProvider({ provider_type: 'docker' }),
        ],
        isLoading: false,
      } as unknown as ReturnType<typeof useQuery>)

      const { container } = render(<SandboxProviderPage />)
      const buttons = container.querySelectorAll('button')

      fireEvent.click(buttons[2])

      expect(screen.getAllByText('Docker').length).toBeGreaterThan(0)
      expect(screen.getByText('common.sandboxProvider.configModal.title')).toBeInTheDocument()
    })
  })
})
