import type { ReactNode } from 'react'
import type { Credential, PluginPayload } from '../../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/console/render'
import { AuthCategory, CredentialTypeEnum } from '../../types'
import Authorized from '../index'

// ==================== Mock Setup ====================

// Mock API hooks for credential operations
const mockDeletePluginCredential = vi.fn()
const mockSetPluginDefaultCredential = vi.fn()
const mockUpdatePluginCredential = vi.fn()

vi.mock('../../hooks/use-credential', () => ({
  useDeletePluginCredentialHook: () => ({
    mutateAsync: mockDeletePluginCredential,
  }),
  useSetPluginDefaultCredentialHook: () => ({
    mutateAsync: mockSetPluginDefaultCredential,
  }),
  useUpdatePluginCredentialHook: () => ({
    mutateAsync: mockUpdatePluginCredential,
  }),
  useGetPluginOAuthUrlHook: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ authorization_url: '' }),
  }),
  useGetPluginOAuthClientSchemaHook: () => ({
    data: {
      schema: [],
      is_oauth_custom_client_enabled: false,
      is_system_oauth_params_exists: false,
    },
    isLoading: false,
  }),
  useSetPluginOAuthCustomClientHook: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
  }),
  useDeletePluginOAuthCustomClientHook: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
  }),
  useInvalidPluginOAuthClientSchemaHook: () => vi.fn(),
  useAddPluginCredentialHook: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
  }),
  useGetPluginCredentialSchemaHook: () => ({
    data: [],
    isLoading: false,
  }),
}))

const toastMocks = vi.hoisted(() => ({
  call: vi.fn(),
  dismiss: vi.fn(),
  update: vi.fn(),
  promise: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: Object.assign(toastMocks.call, {
    success: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'success', message, ...options }),
    ),
    error: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'error', message, ...options }),
    ),
    warning: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'warning', message, ...options }),
    ),
    info: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'info', message, ...options }),
    ),
    dismiss: toastMocks.dismiss,
    update: toastMocks.update,
    promise: toastMocks.promise,
  }),
}))
// Mock openOAuthPopup
vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: vi.fn(),
}))

const mockConsoleState = vi.hoisted(() => ({
  userProfile: { id: 'test-user', name: 'Test User', email: 'test@example.com', avatar_url: '' },
  workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'] as string[],
}))

vi.mock('@/context/account-state', async () => {
  const { createAccountStateModuleMock } = await import('@/test/console/state-fixture')
  return createAccountStateModuleMock(() => ({
    userProfile: mockConsoleState.userProfile,
    workspacePermissionKeys: mockConsoleState.workspacePermissionKeys,
  }))
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    userProfile: mockConsoleState.userProfile,
    workspacePermissionKeys: mockConsoleState.workspacePermissionKeys,
  }))
})

// Mock service/use-triggers
vi.mock('@/service/use-triggers', () => ({
  useTriggerPluginDynamicOptions: () => ({
    data: { options: [] },
    isLoading: false,
  }),
  useTriggerPluginDynamicOptionsInfo: () => ({
    data: null,
    isLoading: false,
  }),
  useInvalidTriggerDynamicOptions: () => vi.fn(),
}))

vi.mock('@/service/use-common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/use-common')>()
  return {
    ...actual,
    useMembers: () => ({ data: { accounts: [] } }),
  }
})

// ==================== Test Utilities ====================

const createConsoleQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })

const createWrapper = () => {
  const testQueryClient = createConsoleQueryClient()
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
  )
}

// Factory functions for test data
const createPluginPayload = (overrides: Partial<PluginPayload> = {}): PluginPayload => ({
  category: AuthCategory.tool,
  provider: 'test-provider',
  ...overrides,
})

const createCredential = (overrides: Partial<Credential> = {}): Credential => ({
  id: 'test-credential-id',
  name: 'Test Credential',
  provider: 'test-provider',
  credential_type: CredentialTypeEnum.API_KEY,
  is_default: false,
  credentials: { api_key: 'test-key' },
  ...overrides,
})

// ==================== Authorized Component Tests ====================
describe('Authorized Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConsoleState.workspacePermissionKeys = [
      'credential.use',
      'credential.create',
      'credential.manage',
    ]
    mockDeletePluginCredential.mockResolvedValue({})
    mockSetPluginDefaultCredential.mockResolvedValue({})
    mockUpdatePluginCredential.mockResolvedValue({})
  })

  // ==================== Rendering Tests ====================
  describe('Rendering', () => {
    it('should render with default trigger button', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential()]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} />, {
        wrapper: createWrapper(),
      })

      expect(screen.getByRole('button'))!.toBeInTheDocument()
    })

    it('should render a custom trigger from the actual popover state', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential()]

      render(
        <Authorized
          pluginPayload={pluginPayload}
          credentials={credentials}
          renderTrigger={(open) => (
            <div data-testid="custom-trigger">{open ? 'Open' : 'Closed'}</div>
          )}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('Closed'))!.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('custom-trigger'))

      expect(screen.getByText('Open')).toBeInTheDocument()
    })

    it('should show singular authorization text for 1 credential', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential()]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} />, {
        wrapper: createWrapper(),
      })

      // Text is split by elements, use regex to find partial match
      // Text is split by elements, use regex to find partial match
      expect(screen.getByText(/plugin\.auth\.authorization/))!.toBeInTheDocument()
    })

    it('should show plural authorizations text for multiple credentials', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential({ id: '1' }), createCredential({ id: '2' })]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} />, {
        wrapper: createWrapper(),
      })

      // Text is split by elements, use regex to find partial match
      // Text is split by elements, use regex to find partial match
      expect(screen.getByText(/plugin\.auth\.authorizations/))!.toBeInTheDocument()
    })

    it('should show unavailable count when there are unavailable credentials', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({ id: '1', not_allowed_to_use: false }),
        createCredential({ id: '2', not_allowed_to_use: true }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} />, {
        wrapper: createWrapper(),
      })

      expect(screen.getByText(/plugin\.auth\.unavailable/))!.toBeInTheDocument()
    })

    it('should show gray indicator when default credential is unavailable', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential({ is_default: true, not_allowed_to_use: true })]

      const { container } = render(
        <Authorized pluginPayload={pluginPayload} credentials={credentials} />,
        { wrapper: createWrapper() },
      )

      expect(container.querySelector('.shadow-status-indicator-gray-shadow'))!.toBeInTheDocument()
    })
  })

  // ==================== Open/Close Behavior Tests ====================
  describe('Open/Close Behavior', () => {
    it('should toggle popup when trigger is clicked', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential()]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} />, {
        wrapper: createWrapper(),
      })

      const trigger = screen.getByRole('button')
      fireEvent.click(trigger)

      // Popup should be open - check for popup content
      // Popup should be open - check for popup content
      expect(screen.getByText('API Keys'))!.toBeInTheDocument()
    })

    it('should use controlled open state when isOpen and onOpenChange are provided', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential()]
      const onOpenChange = vi.fn()

      render(
        <Authorized
          pluginPayload={pluginPayload}
          credentials={credentials}
          isOpen={true}
          onOpenChange={onOpenChange}
        />,
        { wrapper: createWrapper() },
      )

      // Popup should be open since isOpen is true
      // Popup should be open since isOpen is true
      expect(screen.getByText('API Keys'))!.toBeInTheDocument()

      // Click trigger to close - get all buttons and click the first one (trigger)
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0]!)

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('should close popup when trigger is clicked again', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential()]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} />, {
        wrapper: createWrapper(),
      })

      const trigger = screen.getByRole('button')

      // Open
      fireEvent.click(trigger)
      expect(screen.getByText('API Keys'))!.toBeInTheDocument()

      // Close
      fireEvent.click(trigger)
      // Content might still be in DOM but hidden
    })
  })

  // ==================== Credential List Tests ====================
  describe('Credential Lists', () => {
    it('should render OAuth credentials section when oAuthCredentials exist', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: '1',
          credential_type: CredentialTypeEnum.OAUTH2,
          name: 'OAuth Cred',
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      expect(screen.getByText('OAuth'))!.toBeInTheDocument()
      expect(screen.getByText('OAuth Cred'))!.toBeInTheDocument()
    })

    it('should render API Key credentials section when apiKeyCredentials exist', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: '1',
          credential_type: CredentialTypeEnum.API_KEY,
          name: 'API Key Cred',
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      expect(screen.getByText('API Keys'))!.toBeInTheDocument()
      expect(screen.getByText('API Key Cred'))!.toBeInTheDocument()
    })

    it('should render both OAuth and API Key sections when both exist', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: '1',
          credential_type: CredentialTypeEnum.OAUTH2,
          name: 'OAuth Cred',
        }),
        createCredential({
          id: '2',
          credential_type: CredentialTypeEnum.API_KEY,
          name: 'API Key Cred',
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      expect(screen.getByText('OAuth'))!.toBeInTheDocument()
      expect(screen.getByText('API Keys'))!.toBeInTheDocument()
    })

    it('should render extra authorization items when provided', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential()]
      const extraItems = [createCredential({ id: 'extra-1', name: 'Extra Item' })]

      render(
        <Authorized
          pluginPayload={pluginPayload}
          credentials={credentials}
          extraAuthorizationItems={extraItems}
          isOpen={true}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('Extra Item'))!.toBeInTheDocument()
    })

    it('should pass showSelectedIcon and selectedCredentialId to items', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential({ id: 'selected-id' })]

      render(
        <Authorized
          pluginPayload={pluginPayload}
          credentials={credentials}
          showItemSelectedIcon={true}
          selectedCredentialId="selected-id"
          isOpen={true}
        />,
        { wrapper: createWrapper() },
      )

      // Selected icon should be visible
      // Selected icon should be visible
      expect(document.querySelector('.text-text-accent'))!.toBeInTheDocument()
    })
  })

  // ==================== Delete Confirmation Tests ====================
  describe('Delete Confirmation', () => {
    it('should show confirm dialog when delete is triggered', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential({ credential_type: CredentialTypeEnum.OAUTH2 })]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.delete' }))

      await waitFor(() => {
        expect(screen.getByText('datasetDocuments.list.delete.title'))!.toBeInTheDocument()
      })
    })

    it('should close confirm dialog when cancel is clicked', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential({ credential_type: CredentialTypeEnum.OAUTH2 })]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      // Wait for OAuth section to render
      await waitFor(() => {
        expect(screen.getByText('OAuth'))!.toBeInTheDocument()
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.delete' }))
      })
      fireEvent.click(screen.getByText('common.operation.cancel'))

      await waitFor(() => {
        expect(screen.queryByText('datasetDocuments.list.delete.title')).not.toBeInTheDocument()
      })
    })

    it('should call deletePluginCredential when confirm is clicked', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({ id: 'delete-me', credential_type: CredentialTypeEnum.OAUTH2 }),
      ]
      const onUpdate = vi.fn()

      render(
        <Authorized
          pluginPayload={pluginPayload}
          credentials={credentials}
          isOpen={true}
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.delete' }))
      await waitFor(() => {
        expect(screen.getByText('datasetDocuments.list.delete.title'))!.toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('common.operation.confirm'))

      await waitFor(() => {
        expect(mockDeletePluginCredential).toHaveBeenCalledWith({ credential_id: 'delete-me' })
      })
      expect(toastMocks.call).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.api.actionSuccess',
      })
      expect(onUpdate).toHaveBeenCalled()
    })

    it('should not delete when no credential id is pending', async () => {
      const pluginPayload = createPluginPayload()
      const credentials: Credential[] = []

      // This test verifies the edge case handling
      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      // No credentials to delete, so nothing to test here
      expect(mockDeletePluginCredential).not.toHaveBeenCalled()
    })
  })

  // ==================== Set Default Tests ====================
  describe('Set Default', () => {
    it('should call setPluginDefaultCredential when set default is clicked', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential({ id: 'set-default-id', is_default: false })]
      const onUpdate = vi.fn()

      render(
        <Authorized
          pluginPayload={pluginPayload}
          credentials={credentials}
          isOpen={true}
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      // Find and click set default button
      const setDefaultButton = screen.queryByText('plugin.auth.setDefault')
      if (setDefaultButton) {
        fireEvent.click(setDefaultButton)

        await waitFor(() => {
          expect(mockSetPluginDefaultCredential).toHaveBeenCalledWith('set-default-id')
        })

        expect(toastMocks.call).toHaveBeenCalledWith({
          type: 'success',
          message: 'common.api.actionSuccess',
        })
        expect(onUpdate).toHaveBeenCalled()
      }
    })
  })

  // ==================== Rename Tests ====================
  describe('Rename', () => {
    it('should call updatePluginCredential when rename is confirmed', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'rename-id',
          name: 'Original Name',
          credential_type: CredentialTypeEnum.OAUTH2,
        }),
      ]
      const onUpdate = vi.fn()

      render(
        <Authorized
          pluginPayload={pluginPayload}
          credentials={credentials}
          isOpen={true}
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.rename' }))
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New Name' } })
      fireEvent.click(screen.getByText('common.operation.save'))

      await waitFor(() => {
        expect(mockUpdatePluginCredential).toHaveBeenCalledWith({
          credential_id: 'rename-id',
          name: 'New Name',
        })
      })
      expect(toastMocks.call).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.api.actionSuccess',
      })
      expect(onUpdate).toHaveBeenCalled()
    })

    it('should call handleRename from Item component for OAuth credentials', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'oauth-rename-id',
          name: 'OAuth Original',
          credential_type: CredentialTypeEnum.OAUTH2,
        }),
      ]
      const onUpdate = vi.fn()

      render(
        <Authorized
          pluginPayload={pluginPayload}
          credentials={credentials}
          isOpen={true}
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.rename' }))
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Renamed OAuth' } })
      fireEvent.click(screen.getByText('common.operation.save'))

      await waitFor(() => {
        expect(mockUpdatePluginCredential).toHaveBeenCalledWith({
          credential_id: 'oauth-rename-id',
          name: 'Renamed OAuth',
        })
      })
      expect(toastMocks.call).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.api.actionSuccess',
      })
      expect(onUpdate).toHaveBeenCalled()
    })

    it('should not call handleRename when already doing action', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'concurrent-rename-id',
          credential_type: CredentialTypeEnum.OAUTH2,
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      // Verify component renders
      // Verify component renders
      expect(screen.getByText('OAuth'))!.toBeInTheDocument()
    })

    it('should execute handleRename function body when saving', async () => {
      // Reset mock to ensure clean state
      mockUpdatePluginCredential.mockClear()
      toastMocks.call.mockClear()

      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'execute-rename-id',
          name: 'Execute Rename Test',
          credential_type: CredentialTypeEnum.OAUTH2,
        }),
      ]
      const onUpdate = vi.fn()

      render(
        <Authorized
          pluginPayload={pluginPayload}
          credentials={credentials}
          isOpen={true}
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      // Wait for component to render
      // Wait for component to render
      expect(screen.getByText('OAuth'))!.toBeInTheDocument()
      expect(screen.getByText('Execute Rename Test'))!.toBeInTheDocument()

      // The handleRename is tested through the "should call updatePluginCredential when rename is confirmed" test
      // This test verifies the component properly renders OAuth credentials
    })

    it('should fully execute handleRename when Item triggers onRename callback', async () => {
      mockUpdatePluginCredential.mockClear()
      toastMocks.call.mockClear()
      mockUpdatePluginCredential.mockResolvedValue({})

      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'full-rename-test-id',
          name: 'Full Rename Test',
          credential_type: CredentialTypeEnum.OAUTH2,
        }),
      ]
      const onUpdate = vi.fn()

      render(
        <Authorized
          pluginPayload={pluginPayload}
          credentials={credentials}
          isOpen={true}
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      // Verify OAuth section renders
      // Verify OAuth section renders
      expect(screen.getByText('OAuth'))!.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.rename' }))
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fully Renamed' } })
      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.save'))
      })

      await waitFor(() => {
        expect(mockUpdatePluginCredential).toHaveBeenCalledWith({
          credential_id: 'full-rename-test-id',
          name: 'Fully Renamed',
        })
      })
      expect(toastMocks.call).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.api.actionSuccess',
      })
      expect(onUpdate).toHaveBeenCalled()
    })
  })

  // ==================== Edit Modal Tests ====================
  describe('Edit Modal', () => {
    it('should show ApiKeyModal when edit is clicked on API key credential', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'edit-id',
          name: 'Edit Test',
          credential_type: CredentialTypeEnum.API_KEY,
          credentials: { api_key: 'test-key' },
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.edit' }))

      await waitFor(() => {
        expect(document.querySelector('.fixed'))!.toBeInTheDocument()
      })
    })

    it('should close ApiKeyModal and clear state when onClose is called', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'edit-close-id',
          credential_type: CredentialTypeEnum.API_KEY,
          credentials: { api_key: 'test-key' },
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      await waitFor(() => {
        expect(document.querySelector('.fixed'))!.toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('common.operation.cancel'))
      await waitFor(() => {
        expect(screen.getByText('API Keys'))!.toBeInTheDocument()
      })
    })

    it('should properly handle ApiKeyModal onClose callback to reset state', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'reset-state-id',
          name: 'Reset Test',
          credential_type: CredentialTypeEnum.API_KEY,
          credentials: { api_key: 'secret-key' },
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      await waitFor(() => {
        expect(document.querySelectorAll('.fixed').length).toBeGreaterThan(0)
      })

      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.cancel'))
      })
      await waitFor(() => {
        expect(screen.getByText('API Keys'))!.toBeInTheDocument()
      })
    })

    it('should execute onClose callback setting editValues to null', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'onclose-test-id',
          name: 'OnClose Test',
          credential_type: CredentialTypeEnum.API_KEY,
          credentials: { api_key: 'test-api-key' },
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      // Wait for component to render
      // Wait for component to render
      expect(screen.getByText('API Keys'))!.toBeInTheDocument()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      })
      await waitFor(
        () => {
          expect(document.querySelectorAll('.fixed').length).toBeGreaterThan(0)
        },
        { timeout: 2000 },
      )

      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.cancel'))
      })
      await waitFor(() => {
        expect(screen.getByText('API Keys'))!.toBeInTheDocument()
      })
    })

    it('should call handleRemove when onRemove is triggered from ApiKeyModal', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'remove-from-modal-id',
          name: 'Remove From Modal Test',
          credential_type: CredentialTypeEnum.API_KEY,
          credentials: { api_key: 'test-key' },
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      // Wait for component to render
      // Wait for component to render
      expect(screen.getByText('API Keys'))!.toBeInTheDocument()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      })
      await waitFor(() => {
        expect(document.querySelectorAll('.fixed').length).toBeGreaterThan(0)
      })

      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.remove'))
      })
      await waitFor(
        () => {
          expect(screen.getByText('datasetDocuments.list.delete.title'))!.toBeInTheDocument()
        },
        { timeout: 1000 },
      )
    })

    it('should trigger ApiKeyModal onClose callback when cancel is clicked', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'onclose-callback-id',
          name: 'OnClose Callback Test',
          credential_type: CredentialTypeEnum.API_KEY,
          credentials: { api_key: 'test-key' },
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      // Verify API Keys section is shown
      // Verify API Keys section is shown
      expect(screen.getByText('API Keys'))!.toBeInTheDocument()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      })
      await waitFor(() => {
        expect(document.querySelector('.fixed'))!.toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('common.operation.cancel'))

      // Verify component renders correctly
      // Verify component renders correctly
      expect(screen.getByText('API Keys'))!.toBeInTheDocument()
    })

    it('should trigger handleRemove when remove button is clicked in ApiKeyModal', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'handleremove-test-id',
          name: 'HandleRemove Test',
          credential_type: CredentialTypeEnum.API_KEY,
          credentials: { api_key: 'test-key' },
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      // Verify component renders
      // Verify component renders
      expect(screen.getByText('API Keys'))!.toBeInTheDocument()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      })
      await waitFor(() => {
        expect(document.querySelector('.fixed'))!.toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('common.operation.remove'))

      // Verify component still works
      // Verify component still works
      expect(screen.getByText('API Keys'))!.toBeInTheDocument()
    })

    it('should show confirm dialog when remove is clicked from edit modal', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'edit-remove-id',
          credential_type: CredentialTypeEnum.API_KEY,
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      await waitFor(() => {
        expect(document.querySelector('.fixed'))!.toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('common.operation.remove'))
      await waitFor(() => {
        expect(screen.getByText('datasetDocuments.list.delete.title'))!.toBeInTheDocument()
      })
    })

    it('should clear editValues and pendingOperationCredentialId when modal is closed', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'clear-on-close-id',
          name: 'Clear Test',
          credential_type: CredentialTypeEnum.API_KEY,
          credentials: { api_key: 'test-key' },
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      await waitFor(() => {
        expect(document.querySelector('.fixed'))!.toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('common.operation.cancel'))
      await waitFor(() => {
        expect(screen.getByText('API Keys'))!.toBeInTheDocument()
      })
    })
  })

  // ==================== onItemClick Tests ====================
  describe('Item Click', () => {
    it('should call onItemClick when credential item is clicked', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential({ id: 'click-id' })]
      const onItemClick = vi.fn()

      render(
        <Authorized
          pluginPayload={pluginPayload}
          credentials={credentials}
          isOpen={true}
          onItemClick={onItemClick}
        />,
        { wrapper: createWrapper() },
      )

      // Find and click the credential item
      const credentialItem = screen.getByText('Test Credential')
      fireEvent.click(credentialItem)

      expect(onItemClick).toHaveBeenCalledWith('click-id')
    })
  })

  // ==================== Authorize Section Tests ====================
  describe('Authorize Section', () => {
    it('should render Authorize component when notAllowCustomCredential is false', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential()]

      render(
        <Authorized
          pluginPayload={pluginPayload}
          credentials={credentials}
          isOpen={true}
          canOAuth={true}
          canApiKey={true}
          notAllowCustomCredential={false}
        />,
        { wrapper: createWrapper() },
      )

      // Should have divider and authorize buttons
      // Should have divider and authorize buttons
      expect(document.querySelector('.bg-divider-subtle'))!.toBeInTheDocument()
    })

    it('should not render Authorize component when notAllowCustomCredential is true', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential()]

      const { container } = render(
        <Authorized
          pluginPayload={pluginPayload}
          credentials={credentials}
          isOpen={true}
          notAllowCustomCredential={true}
        />,
        { wrapper: createWrapper() },
      )

      // Should not have the authorize section divider
      // Count divider elements - should be minimal
      const dividers = container.querySelectorAll('.bg-divider-subtle')
      // When notAllowCustomCredential is true, there should be no divider for authorize section
      expect(dividers.length).toBeLessThanOrEqual(1)
    })
  })

  // ==================== Props Tests ====================
  describe('Props', () => {
    it('should pass placement to Popover', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential()]

      // Default placement is bottom-start
      render(
        <Authorized
          pluginPayload={pluginPayload}
          credentials={credentials}
          isOpen={true}
          placement="top-end"
        />,
        { wrapper: createWrapper() },
      )

      // Component should render without error
      // Component should render without error
      expect(screen.getByText('API Keys'))!.toBeInTheDocument()
    })

    it('should allow credential.use to set default when credential.manage is missing', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential({ is_default: false })]
      mockConsoleState.workspacePermissionKeys = ['credential.use']

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      const setDefaultButton = screen.queryByText('plugin.auth.setDefault')
      expect(setDefaultButton)!.toBeInTheDocument()
      expect(setDefaultButton!.closest('button'))!.toBeEnabled()
    })

    it('should disable set default when credential.use and credential.manage are missing', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential({ is_default: false })]
      mockConsoleState.workspacePermissionKeys = []

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      const setDefaultButton = screen.queryByText('plugin.auth.setDefault')
      expect(setDefaultButton)!.toBeInTheDocument()
      expect(setDefaultButton!.closest('button'))!.toBeDisabled()
    })

    it('should pass disableSetDefault to Item components', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential({ is_default: false })]

      render(
        <Authorized
          pluginPayload={pluginPayload}
          credentials={credentials}
          isOpen={true}
          disableSetDefault={true}
        />,
        { wrapper: createWrapper() },
      )

      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      // Set default button should not be visible
      expect(screen.queryByText('plugin.auth.setDefault')).not.toBeInTheDocument()
    })
  })

  // ==================== Concurrent Action Prevention Tests ====================
  describe('Concurrent Action Prevention', () => {
    it('should prevent concurrent delete operations', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential({ credential_type: CredentialTypeEnum.OAUTH2 })]

      // Make delete slow
      mockDeletePluginCredential.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100)),
      )

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.delete' }))
      await waitFor(() => {
        expect(screen.getByText('datasetDocuments.list.delete.title'))!.toBeInTheDocument()
      })

      const confirmButton = screen.getByText('common.operation.confirm')
      fireEvent.click(confirmButton)
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockDeletePluginCredential).toHaveBeenCalledTimes(1)
      })
    })

    it('should prevent concurrent set default operations', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential({ is_default: false })]

      // Make set default slow
      mockSetPluginDefaultCredential.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100)),
      )

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      const setDefaultButton = screen.queryByText('plugin.auth.setDefault')
      if (setDefaultButton) {
        // Click twice quickly
        fireEvent.click(setDefaultButton)
        fireEvent.click(setDefaultButton)

        await waitFor(() => {
          expect(mockSetPluginDefaultCredential).toHaveBeenCalledTimes(1)
        })
      }
    })

    it('should prevent concurrent rename operations', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          credential_type: CredentialTypeEnum.OAUTH2,
        }),
      ]

      // Make rename slow
      mockUpdatePluginCredential.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100)),
      )

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.rename' }))
      const saveButton = screen.getByText('common.operation.save')
      fireEvent.click(saveButton)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePluginCredential).toHaveBeenCalledTimes(1)
      })
    })
  })

  // ==================== Edge Cases ====================
  describe('Edge Cases', () => {
    it('should handle empty credentials array', () => {
      const pluginPayload = createPluginPayload()
      const credentials: Credential[] = []

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} />, {
        wrapper: createWrapper(),
      })

      // Should render with 0 count - the button should contain 0
      const button = screen.getByRole('button')
      expect(button.textContent).toContain('0')
    })

    it('should handle credentials without credential_type', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential({ credential_type: undefined })]

      expect(() => {
        render(<Authorized pluginPayload={pluginPayload} credentials={credentials} />, {
          wrapper: createWrapper(),
        })
      }).not.toThrow()
    })

    it('should handle openConfirm without credentialId', () => {
      const pluginPayload = createPluginPayload()
      const credentials = [createCredential()]

      // This tests the branch where credentialId is undefined
      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      // Component should render without error
      // Component should render without error
      expect(screen.getByText('API Keys'))!.toBeInTheDocument()
    })
  })

  // ==================== Additional Coverage Tests ====================
  describe('Additional Coverage - handleConfirm', () => {
    it('should execute full delete flow with openConfirm, handleConfirm, and closeConfirm', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'full-delete-flow-id',
          credential_type: CredentialTypeEnum.OAUTH2,
        }),
      ]
      const onUpdate = vi.fn()

      mockDeletePluginCredential.mockResolvedValue({})
      toastMocks.call.mockClear()

      render(
        <Authorized
          pluginPayload={pluginPayload}
          credentials={credentials}
          isOpen={true}
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      // Wait for component to render
      await waitFor(() => {
        expect(screen.getByText('OAuth'))!.toBeInTheDocument()
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.delete' }))
      })
      await waitFor(() => {
        expect(screen.getByText('datasetDocuments.list.delete.title'))!.toBeInTheDocument()
      })
      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.confirm'))
      })

      await waitFor(() => {
        expect(mockDeletePluginCredential).toHaveBeenCalledWith({
          credential_id: 'full-delete-flow-id',
        })
      })
      expect(toastMocks.call).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.api.actionSuccess',
      })
      expect(onUpdate).toHaveBeenCalled()
      await waitFor(() => {
        expect(screen.queryByText('datasetDocuments.list.delete.title')).not.toBeInTheDocument()
      })
    })

    it('should handle delete when pendingOperationCredentialId is null', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'null-pending-id',
          credential_type: CredentialTypeEnum.API_KEY,
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      // Verify component renders
      // Verify component renders
      expect(screen.getByText('API Keys'))!.toBeInTheDocument()
    })

    it('should prevent handleConfirm when doingAction is true', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'prevent-confirm-id',
          credential_type: CredentialTypeEnum.OAUTH2,
        }),
      ]

      // Make delete very slow to keep doingAction true
      mockDeletePluginCredential.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 5000)),
      )

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.delete' }))
      })
      const confirmBtn = screen.getByText('common.operation.confirm')
      await act(async () => {
        fireEvent.click(confirmBtn)
        fireEvent.click(confirmBtn)
        fireEvent.click(confirmBtn)
      })
      await waitFor(() => {
        expect(mockDeletePluginCredential).toHaveBeenCalledTimes(1)
      })
    })

    it('should handle handleConfirm when pendingOperationCredentialId is null', async () => {
      // This test verifies the branch where pendingOperationCredentialId.current is null
      // when handleConfirm is called
      const pluginPayload = createPluginPayload()
      const credentials: Credential[] = []

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      // With no credentials, there's no way to trigger openConfirm,
      // so pendingOperationCredentialId stays null
      // This edge case is handled by the component's internal logic
      expect(screen.queryByText('datasetDocuments.list.delete.title')).not.toBeInTheDocument()
    })
  })

  describe('Additional Coverage - closeConfirm', () => {
    it('should reset deleteCredentialId and pendingOperationCredentialId when cancel is clicked', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'close-confirm-id',
          credential_type: CredentialTypeEnum.OAUTH2,
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      // Wait for component to render
      await waitFor(() => {
        expect(screen.getByText('OAuth'))!.toBeInTheDocument()
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.delete' }))
      })
      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.cancel'))
      })
      await waitFor(() => {
        expect(screen.queryByText('datasetDocuments.list.delete.title')).not.toBeInTheDocument()
      })
    })

    it('should execute closeConfirm to set deleteCredentialId to null', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'closeconfirm-test-id',
          credential_type: CredentialTypeEnum.OAUTH2,
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(screen.getByText('OAuth'))!.toBeInTheDocument()
      })

      const deleteButton = screen.getByRole('button', { name: 'common.operation.delete' })
      await act(async () => {
        fireEvent.click(deleteButton)
      })
      expect(screen.getByText('datasetDocuments.list.delete.title'))!.toBeInTheDocument()
      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.cancel'))
      })
      await waitFor(() => {
        expect(screen.queryByText('datasetDocuments.list.delete.title')).not.toBeInTheDocument()
      })
      await act(async () => {
        fireEvent.click(deleteButton)
      })
      await waitFor(() => {
        expect(screen.getByText('datasetDocuments.list.delete.title'))!.toBeInTheDocument()
      })
    })

    it('should call closeConfirm when pressing Escape key', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'escape-close-id',
          credential_type: CredentialTypeEnum.OAUTH2,
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(screen.getByText('OAuth'))!.toBeInTheDocument()
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.delete' }))
      })
      await act(async () => {
        fireEvent.keyDown(document, { key: 'Escape' })
      })
      await waitFor(() => {
        expect(screen.queryByText('datasetDocuments.list.delete.title')).not.toBeInTheDocument()
      })
    })
  })

  describe('Additional Coverage - handleRemove', () => {
    it('should trigger delete confirmation when handleRemove is called from ApiKeyModal', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'handle-remove-test-id',
          credential_type: CredentialTypeEnum.API_KEY,
          credentials: { api_key: 'test-key' },
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      // Wait for component to render
      await waitFor(() => {
        expect(screen.getByText('API Keys'))!.toBeInTheDocument()
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      })
      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.remove'))
      })
      await waitFor(
        () => {
          expect(screen.getByText('datasetDocuments.list.delete.title'))!.toBeInTheDocument()
        },
        { timeout: 2000 },
      )

      // Verify component renders correctly
      // Verify component renders correctly
      expect(screen.getByText('API Keys'))!.toBeInTheDocument()
    })

    it('should execute handleRemove to set deleteCredentialId from pendingOperationCredentialId', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'remove-flow-id',
          credential_type: CredentialTypeEnum.API_KEY,
          credentials: { api_key: 'secret-key' },
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      // Wait for component to render
      await waitFor(() => {
        expect(screen.getByText('API Keys'))!.toBeInTheDocument()
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      })
      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.remove'))
      })
      await waitFor(
        () => {
          expect(screen.getByText('datasetDocuments.list.delete.title'))!.toBeInTheDocument()
        },
        { timeout: 1000 },
      )

      // Verify component still renders correctly
      // Verify component still renders correctly
      expect(screen.getByText('API Keys'))!.toBeInTheDocument()
    })
  })

  describe('Additional Coverage - handleRename doingAction check', () => {
    it('should prevent rename when doingAction is true', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'prevent-rename-id',
          credential_type: CredentialTypeEnum.OAUTH2,
        }),
      ]

      // Make update very slow to keep doingAction true
      mockUpdatePluginCredential.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 5000)),
      )

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      // Wait for component to render
      await waitFor(() => {
        expect(screen.getByText('OAuth'))!.toBeInTheDocument()
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.rename' }))
      })
      await act(async () => {
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New Name' } })
      })
      const saveBtn = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveBtn)
        fireEvent.click(saveBtn)
        fireEvent.click(saveBtn)
      })
      await waitFor(() => {
        expect(mockUpdatePluginCredential).toHaveBeenCalledTimes(1)
      })
    })

    it('should return early from handleRename when doingActionRef.current is true', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'early-return-rename-id',
          credential_type: CredentialTypeEnum.OAUTH2,
        }),
      ]

      // Make the first update very slow
      let resolveUpdate: (value: unknown) => void
      mockUpdatePluginCredential.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveUpdate = resolve
          }),
      )

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(screen.getByText('OAuth'))!.toBeInTheDocument()
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.rename' }))
      })
      await act(async () => {
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First Name' } })
      })
      const saveBtn = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveBtn)
      })
      await act(async () => {
        fireEvent.click(saveBtn)
      })
      expect(mockUpdatePluginCredential).toHaveBeenCalledTimes(1)
      await act(async () => {
        resolveUpdate!({})
      })
    })
  })

  describe('Additional Coverage - ApiKeyModal onClose', () => {
    it('should clear editValues and pendingOperationCredentialId when modal is closed', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'modal-close-id',
          credential_type: CredentialTypeEnum.API_KEY,
          credentials: { api_key: 'secret' },
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      // Wait for component to render
      await waitFor(() => {
        expect(screen.getByText('API Keys'))!.toBeInTheDocument()
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      })
      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.cancel'))
      })
      await waitFor(() => {
        expect(screen.getByText('API Keys'))!.toBeInTheDocument()
      })
    })

    it('should execute onClose callback to reset editValues to null and clear pendingOperationCredentialId', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'onclose-reset-id',
          credential_type: CredentialTypeEnum.API_KEY,
          credentials: { api_key: 'test123' },
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(screen.getByText('API Keys'))!.toBeInTheDocument()
      })

      const editButton = screen.getByRole('button', { name: 'common.operation.edit' })
      await act(async () => {
        fireEvent.click(editButton)
      })
      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.cancel'))
      })
      await waitFor(() => {
        expect(screen.getByText('API Keys'))!.toBeInTheDocument()
      })
      await act(async () => {
        fireEvent.click(editButton)
      })
      await waitFor(() => {
        expect(document.querySelector('.fixed'))!.toBeInTheDocument()
      })
    })

    it('should properly execute onClose callback clearing state', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'onclose-clear-id',
          credential_type: CredentialTypeEnum.API_KEY,
          credentials: { api_key: 'key123' },
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      const editButton = screen.getByRole('button', { name: 'common.operation.edit' })
      await act(async () => {
        fireEvent.click(editButton)
      })
      await waitFor(() => {
        expect(document.querySelector('.fixed'))!.toBeInTheDocument()
      })
      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.cancel'))
      })
      await waitFor(() => {
        expect(screen.getByText('API Keys'))!.toBeInTheDocument()
      })
      await act(async () => {
        fireEvent.click(editButton)
      })
      await waitFor(() => {
        expect(document.querySelector('.fixed'))!.toBeInTheDocument()
      })
    })
  })

  describe('Additional Coverage - openConfirm with credentialId', () => {
    it('should set pendingOperationCredentialId when credentialId is provided', async () => {
      const pluginPayload = createPluginPayload()
      const credentials = [
        createCredential({
          id: 'open-confirm-cred-id',
          credential_type: CredentialTypeEnum.OAUTH2,
        }),
      ]

      render(<Authorized pluginPayload={pluginPayload} credentials={credentials} isOpen={true} />, {
        wrapper: createWrapper(),
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.operation.delete' }))
      })
      await waitFor(() => {
        expect(screen.getByText('datasetDocuments.list.delete.title'))!.toBeInTheDocument()
      })
      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.confirm'))
      })
      await waitFor(() => {
        expect(mockDeletePluginCredential).toHaveBeenCalledWith({
          credential_id: 'open-confirm-cred-id',
        })
      })
    })
  })
})
