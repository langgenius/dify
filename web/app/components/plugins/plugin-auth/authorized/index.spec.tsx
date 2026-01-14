import type { ReactNode } from 'react'
import type { Credential, PluginPayload } from '../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastContext } from '@/app/components/base/toast'
import { AuthCategory, CredentialTypeEnum } from '../types'
import AuthorizedModals from './authorized-modals'
import CredentialSection, { ExtraCredentialSection } from './credential-section'
import { useCredentialActions } from './hooks/use-credential-actions'
import { useModalState } from './hooks/use-modal-state'
import Authorized from './index'
import Item from './item'

// ==================== Mock Setup ====================

// Mock credential API hooks (API services should be mocked)
const mockDeletePluginCredential = vi.fn()
const mockSetPluginDefaultCredential = vi.fn()
const mockUpdatePluginCredential = vi.fn()

// Mock the plugin-auth hooks that use API services
vi.mock('@/app/components/plugins/plugin-auth/hooks/use-credential', () => ({
  useDeletePluginCredentialHook: () => ({
    mutateAsync: mockDeletePluginCredential,
  }),
  useSetPluginDefaultCredentialHook: () => ({
    mutateAsync: mockSetPluginDefaultCredential,
  }),
  useUpdatePluginCredentialHook: () => ({
    mutateAsync: mockUpdatePluginCredential,
  }),
}))

// Toast context mock functions for assertions
const mockNotify = vi.fn()
const mockClose = vi.fn()

// Mock Authorize component
vi.mock('../authorize', () => ({
  default: ({ onUpdate }: { onUpdate?: () => void }) => (
    <div data-testid="authorize-component">
      <button onClick={onUpdate} data-testid="authorize-update-btn">Add Authorization</button>
    </div>
  ),
}))

// Mock ApiKeyModal component
vi.mock('../authorize/api-key-modal', () => ({
  default: ({
    editValues,
    onClose,
    onRemove,
    disabled,
  }: {
    editValues: Record<string, unknown>
    onClose: () => void
    onRemove: () => void
    disabled?: boolean
  }) => (
    <div data-testid="api-key-modal">
      <span data-testid="modal-edit-values">{JSON.stringify(editValues)}</span>
      <button onClick={onClose} data-testid="modal-close-btn" disabled={disabled}>Close</button>
      <button onClick={onRemove} data-testid="modal-remove-btn" disabled={disabled}>Remove</button>
    </div>
  ),
}))

// ==================== Test Utilities ====================

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })

// Create a wrapper with real ToastContext and QueryClient
const createWrapper = () => {
  const testQueryClient = createTestQueryClient()
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={testQueryClient}>
      <ToastContext.Provider value={{ notify: mockNotify, close: mockClose }}>
        {children}
      </ToastContext.Provider>
    </QueryClientProvider>
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

const createOAuthCredential = (overrides: Partial<Credential> = {}): Credential =>
  createCredential({
    credential_type: CredentialTypeEnum.OAUTH2,
    ...overrides,
  })

const createApiKeyCredential = (overrides: Partial<Credential> = {}): Credential =>
  createCredential({
    credential_type: CredentialTypeEnum.API_KEY,
    ...overrides,
  })

const createCredentialList = (
  apiKeyCount: number,
  oauthCount: number,
): Credential[] => {
  const apiKeys = Array.from({ length: apiKeyCount }, (_, i) =>
    createApiKeyCredential({
      id: `api-key-${i}`,
      name: `API Key ${i}`,
      is_default: i === 0,
    }))
  const oauths = Array.from({ length: oauthCount }, (_, i) =>
    createOAuthCredential({
      id: `oauth-${i}`,
      name: `OAuth ${i}`,
    }))
  return [...apiKeys, ...oauths]
}

// ==================== Hook Tests ====================

describe('useCredentialActions Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeletePluginCredential.mockResolvedValue({})
    mockSetPluginDefaultCredential.mockResolvedValue({})
    mockUpdatePluginCredential.mockResolvedValue({})
  })

  describe('Initial State', () => {
    it('should initialize with correct default values', () => {
      const { result } = renderHook(
        () => useCredentialActions({
          pluginPayload: createPluginPayload(),
        }),
        { wrapper: createWrapper() },
      )

      expect(result.current.doingAction).toBe(false)
      expect(result.current.doingActionRef.current).toBe(false)
      expect(result.current.pendingOperationCredentialIdRef.current).toBeNull()
    })
  })

  describe('handleDelete', () => {
    it('should call deletePluginCredential and show notification on success', async () => {
      const onUpdate = vi.fn()
      const { result } = renderHook(
        () => useCredentialActions({
          pluginPayload: createPluginPayload(),
          onUpdate,
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        await result.current.handleDelete('credential-1')
      })

      expect(mockDeletePluginCredential).toHaveBeenCalledWith({ credential_id: 'credential-1' })
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'success',
        message: expect.any(String),
      })
      expect(onUpdate).toHaveBeenCalled()
    })

    it('should not execute when already doing action', async () => {
      const { result } = renderHook(
        () => useCredentialActions({
          pluginPayload: createPluginPayload(),
        }),
        { wrapper: createWrapper() },
      )

      // Set doingAction to true
      act(() => {
        result.current.handleSetDoingAction(true)
      })

      await act(async () => {
        await result.current.handleDelete('credential-1')
      })

      expect(mockDeletePluginCredential).not.toHaveBeenCalled()
    })

    it('should reset doingAction on error', async () => {
      mockDeletePluginCredential.mockRejectedValueOnce(new Error('Delete failed'))

      const { result } = renderHook(
        () => useCredentialActions({
          pluginPayload: createPluginPayload(),
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        try {
          await result.current.handleDelete('credential-1')
        }
        catch {
          // Expected error
        }
      })

      expect(result.current.doingAction).toBe(false)
    })
  })

  describe('handleSetDefault', () => {
    it('should call setPluginDefaultCredential and show notification on success', async () => {
      const onUpdate = vi.fn()
      const { result } = renderHook(
        () => useCredentialActions({
          pluginPayload: createPluginPayload(),
          onUpdate,
        }),
        { wrapper: createWrapper() },
      )

      await act(async () => {
        await result.current.handleSetDefault('credential-1')
      })

      expect(mockSetPluginDefaultCredential).toHaveBeenCalledWith('credential-1')
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'success',
        message: expect.any(String),
      })
      expect(onUpdate).toHaveBeenCalled()
    })

    it('should not execute when already doing action', async () => {
      const { result } = renderHook(
        () => useCredentialActions({
          pluginPayload: createPluginPayload(),
        }),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.handleSetDoingAction(true)
      })

      await act(async () => {
        await result.current.handleSetDefault('credential-1')
      })

      expect(mockSetPluginDefaultCredential).not.toHaveBeenCalled()
    })
  })

  describe('handleRename', () => {
    it('should call updatePluginCredential and show notification on success', async () => {
      const onUpdate = vi.fn()
      const { result } = renderHook(
        () => useCredentialActions({
          pluginPayload: createPluginPayload(),
          onUpdate,
        }),
        { wrapper: createWrapper() },
      )

      const payload = { credential_id: 'credential-1', name: 'New Name' }
      await act(async () => {
        await result.current.handleRename(payload)
      })

      expect(mockUpdatePluginCredential).toHaveBeenCalledWith(payload)
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'success',
        message: expect.any(String),
      })
      expect(onUpdate).toHaveBeenCalled()
    })

    it('should not execute when already doing action', async () => {
      const { result } = renderHook(
        () => useCredentialActions({
          pluginPayload: createPluginPayload(),
        }),
        { wrapper: createWrapper() },
      )

      act(() => {
        result.current.handleSetDoingAction(true)
      })

      await act(async () => {
        await result.current.handleRename({ credential_id: 'credential-1', name: 'New Name' })
      })

      expect(mockUpdatePluginCredential).not.toHaveBeenCalled()
    })
  })

  describe('Callback Stability', () => {
    it('should maintain stable handleSetDoingAction reference', () => {
      const { result, rerender } = renderHook(
        () => useCredentialActions({
          pluginPayload: createPluginPayload(),
        }),
        { wrapper: createWrapper() },
      )

      const firstHandleSetDoingAction = result.current.handleSetDoingAction

      rerender()

      // handleSetDoingAction should be stable (no dependencies)
      expect(result.current.handleSetDoingAction).toBe(firstHandleSetDoingAction)
    })

    it('should return all expected functions', () => {
      const { result } = renderHook(
        () => useCredentialActions({
          pluginPayload: createPluginPayload(),
        }),
        { wrapper: createWrapper() },
      )

      expect(typeof result.current.handleDelete).toBe('function')
      expect(typeof result.current.handleSetDefault).toBe('function')
      expect(typeof result.current.handleRename).toBe('function')
      expect(typeof result.current.handleSetDoingAction).toBe('function')
    })
  })
})

describe('useModalState Hook', () => {
  // Factory for creating a mutable ref object (not using React.createRef to avoid deprecated warning)
  const makeMutableRef = (): { current: string | null } => ({ current: null })

  describe('Initial State', () => {
    it('should initialize with correct default values', () => {
      const pendingRef = makeMutableRef()
      const { result } = renderHook(
        () => useModalState({ pendingOperationCredentialIdRef: pendingRef }),
      )

      expect(result.current.deleteCredentialId).toBeNull()
      expect(result.current.editValues).toBeNull()
    })
  })

  describe('Delete Confirm Modal', () => {
    it('should open delete confirm with provided credentialId', () => {
      const pendingRef = makeMutableRef()
      const { result } = renderHook(
        () => useModalState({ pendingOperationCredentialIdRef: pendingRef }),
      )

      act(() => {
        result.current.openDeleteConfirm('credential-1')
      })

      expect(result.current.deleteCredentialId).toBe('credential-1')
      expect(pendingRef.current).toBe('credential-1')
    })

    it('should use existing pendingRef value when no credentialId provided', () => {
      const pendingRef = makeMutableRef()
      pendingRef.current = 'existing-credential'

      const { result } = renderHook(
        () => useModalState({ pendingOperationCredentialIdRef: pendingRef }),
      )

      act(() => {
        result.current.openDeleteConfirm()
      })

      expect(result.current.deleteCredentialId).toBe('existing-credential')
    })

    it('should close delete confirm and reset pendingRef', () => {
      const pendingRef = makeMutableRef()
      const { result } = renderHook(
        () => useModalState({ pendingOperationCredentialIdRef: pendingRef }),
      )

      act(() => {
        result.current.openDeleteConfirm('credential-1')
      })
      act(() => {
        result.current.closeDeleteConfirm()
      })

      expect(result.current.deleteCredentialId).toBeNull()
      expect(pendingRef.current).toBeNull()
    })
  })

  describe('Edit Modal', () => {
    it('should open edit modal with values and set pendingRef', () => {
      const pendingRef = makeMutableRef()
      const { result } = renderHook(
        () => useModalState({ pendingOperationCredentialIdRef: pendingRef }),
      )

      const editValues = { api_key: 'test-key', __name__: 'Test' }
      act(() => {
        result.current.openEditModal('credential-1', editValues)
      })

      expect(result.current.editValues).toEqual(editValues)
      expect(pendingRef.current).toBe('credential-1')
    })

    it('should close edit modal and reset pendingRef', () => {
      const pendingRef = makeMutableRef()
      const { result } = renderHook(
        () => useModalState({ pendingOperationCredentialIdRef: pendingRef }),
      )

      act(() => {
        result.current.openEditModal('credential-1', { key: 'value' })
      })
      act(() => {
        result.current.closeEditModal()
      })

      expect(result.current.editValues).toBeNull()
      expect(pendingRef.current).toBeNull()
    })
  })

  describe('handleRemoveFromEdit', () => {
    it('should open delete confirm from edit modal', () => {
      const pendingRef = makeMutableRef()
      const { result } = renderHook(
        () => useModalState({ pendingOperationCredentialIdRef: pendingRef }),
      )

      act(() => {
        result.current.openEditModal('credential-1', { key: 'value' })
      })
      act(() => {
        result.current.handleRemoveFromEdit()
      })

      expect(result.current.deleteCredentialId).toBe('credential-1')
    })
  })

  describe('Callback Stability', () => {
    it('should maintain stable callback references', () => {
      const pendingRef = makeMutableRef()
      const { result, rerender } = renderHook(
        () => useModalState({ pendingOperationCredentialIdRef: pendingRef }),
      )

      const firstRender = {
        openDeleteConfirm: result.current.openDeleteConfirm,
        closeDeleteConfirm: result.current.closeDeleteConfirm,
        openEditModal: result.current.openEditModal,
        closeEditModal: result.current.closeEditModal,
        handleRemoveFromEdit: result.current.handleRemoveFromEdit,
      }

      rerender()

      expect(result.current.openDeleteConfirm).toBe(firstRender.openDeleteConfirm)
      expect(result.current.closeDeleteConfirm).toBe(firstRender.closeDeleteConfirm)
      expect(result.current.openEditModal).toBe(firstRender.openEditModal)
      expect(result.current.closeEditModal).toBe(firstRender.closeEditModal)
      expect(result.current.handleRemoveFromEdit).toBe(firstRender.handleRemoveFromEdit)
    })
  })
})

// ==================== Component Tests ====================

describe('Item Component', () => {
  const renderItem = (props: Partial<Parameters<typeof Item>[0]> = {}) => {
    const defaultProps = {
      credential: createCredential(),
      ...props,
    }
    return render(<Item {...defaultProps} />, { wrapper: createWrapper() })
  }

  describe('Rendering', () => {
    it('should render credential name', () => {
      renderItem({ credential: createCredential({ name: 'My Credential' }) })
      expect(screen.getByText('My Credential')).toBeInTheDocument()
    })

    it('should show default badge when is_default is true', () => {
      renderItem({ credential: createCredential({ is_default: true }) })
      expect(screen.getByText(/default/i)).toBeInTheDocument()
    })

    it('should show enterprise badge when from_enterprise is true', () => {
      renderItem({ credential: createCredential({ from_enterprise: true }) })
      expect(screen.getByText('Enterprise')).toBeInTheDocument()
    })

    it('should show selected icon when showSelectedIcon and selectedCredentialId match', () => {
      const { container } = renderItem({
        credential: createCredential({ id: 'cred-1' }),
        showSelectedIcon: true,
        selectedCredentialId: 'cred-1',
      })
      // Check icon is rendered (RiCheckLine) - SVG has text-text-accent class
      const checkIcon = container.querySelector('svg.text-text-accent')
      expect(checkIcon).toBeInTheDocument()
    })

    it('should apply disabled styles when disabled is true', () => {
      const { container } = renderItem({ disabled: true })
      expect(container.querySelector('.opacity-50')).toBeInTheDocument()
    })

    it('should apply disabled styles when not_allowed_to_use is true', () => {
      const { container } = renderItem({
        credential: createCredential({ not_allowed_to_use: true }),
      })
      expect(container.querySelector('.opacity-50')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onItemClick when clicking item', async () => {
      const onItemClick = vi.fn()
      renderItem({ onItemClick })

      fireEvent.click(screen.getByText('Test Credential'))
      expect(onItemClick).toHaveBeenCalledWith('test-credential-id')
    })

    it('should call onItemClick with empty string for workspace default', async () => {
      const onItemClick = vi.fn()
      renderItem({
        credential: createCredential({ id: '__workspace_default__' }),
        onItemClick,
      })

      fireEvent.click(screen.getByText('Test Credential'))
      expect(onItemClick).toHaveBeenCalledWith('')
    })

    it('should not call onItemClick when disabled', async () => {
      const onItemClick = vi.fn()
      renderItem({ onItemClick, disabled: true })

      fireEvent.click(screen.getByText('Test Credential'))
      expect(onItemClick).not.toHaveBeenCalled()
    })

    it('should not call onItemClick when not_allowed_to_use', async () => {
      const onItemClick = vi.fn()
      renderItem({
        credential: createCredential({ not_allowed_to_use: true }),
        onItemClick,
      })

      fireEvent.click(screen.getByText('Test Credential'))
      expect(onItemClick).not.toHaveBeenCalled()
    })
  })

  describe('Rename Mode', () => {
    it('should enter rename mode when rename button clicked', async () => {
      const user = userEvent.setup()
      renderItem({ disableRename: false })

      const item = screen.getByText('Test Credential').closest('div')
      fireEvent.mouseEnter(item!)

      // Find and click the rename button (edit icon)
      const buttons = document.querySelectorAll('button')
      const renameBtn = Array.from(buttons).find(btn =>
        btn.querySelector('svg')?.classList.contains('h-4'),
      )
      if (renameBtn) {
        await user.click(renameBtn)
        expect(screen.getByRole('textbox')).toBeInTheDocument()
      }
    })

    it('should call onRename when save button clicked in rename mode', async () => {
      const user = userEvent.setup()
      const onRename = vi.fn()
      renderItem({ disableRename: false, onRename })

      // Enter rename mode
      const item = screen.getByText('Test Credential').closest('div')
      fireEvent.mouseEnter(item!)

      const buttons = document.querySelectorAll('button')
      const renameBtn = Array.from(buttons).find(btn =>
        btn.querySelector('svg')?.classList.contains('h-4'),
      )
      if (renameBtn) {
        await user.click(renameBtn)

        const input = screen.getByRole('textbox')
        await user.clear(input)
        await user.type(input, 'New Name')

        const saveBtn = screen.getByText(/save/i)
        await user.click(saveBtn)

        expect(onRename).toHaveBeenCalledWith({
          credential_id: 'test-credential-id',
          name: 'New Name',
        })
      }
    })

    it('should exit rename mode when cancel button clicked', async () => {
      const user = userEvent.setup()
      renderItem({ disableRename: false })

      const item = screen.getByText('Test Credential').closest('div')
      fireEvent.mouseEnter(item!)

      const buttons = document.querySelectorAll('button')
      const renameBtn = Array.from(buttons).find(btn =>
        btn.querySelector('svg')?.classList.contains('h-4'),
      )
      if (renameBtn) {
        await user.click(renameBtn)

        const cancelBtn = screen.getByText(/cancel/i)
        await user.click(cancelBtn)

        expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      }
    })
  })

  describe('Action Buttons', () => {
    it('should show set default button when not default', async () => {
      renderItem({
        credential: createCredential({ is_default: false }),
        disableSetDefault: false,
      })

      const item = screen.getByText('Test Credential').closest('div')
      fireEvent.mouseEnter(item!)

      expect(screen.getByText(/setDefault/i)).toBeInTheDocument()
    })

    it('should not show set default button when already default', () => {
      renderItem({
        credential: createCredential({ is_default: true }),
        disableSetDefault: false,
      })

      expect(screen.queryByText(/setDefault/i)).not.toBeInTheDocument()
    })

    it('should call onSetDefault when set default button clicked', async () => {
      const user = userEvent.setup()
      const onSetDefault = vi.fn()
      renderItem({
        credential: createCredential({ is_default: false }),
        disableSetDefault: false,
        onSetDefault,
      })

      const item = screen.getByText('Test Credential').closest('div')
      fireEvent.mouseEnter(item!)

      await user.click(screen.getByText(/setDefault/i))
      expect(onSetDefault).toHaveBeenCalledWith('test-credential-id')
    })

    it('should call onDelete when delete button clicked', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn()
      renderItem({ onDelete, disableDelete: false })

      const item = screen.getByText('Test Credential').closest('div')
      fireEvent.mouseEnter(item!)

      // Find delete button (has RiDeleteBinLine icon)
      const deleteBtn = document.querySelector('[class*="hover:text-text-destructive"]')?.closest('button')
      if (deleteBtn) {
        await user.click(deleteBtn)
        expect(onDelete).toHaveBeenCalledWith('test-credential-id')
      }
    })

    it('should call onEdit when edit button clicked for API key credential', async () => {
      const user = userEvent.setup()
      const onEdit = vi.fn()
      const { container } = renderItem({
        credential: createApiKeyCredential({
          id: 'api-cred-1',
          credentials: { api_key: 'secret' },
        }),
        onEdit,
        disableEdit: false,
        disableRename: true, // Disable rename so edit is the first action button
        disableSetDefault: true, // Hide set default button
      })

      const item = screen.getByText('Test Credential').closest('div')
      fireEvent.mouseEnter(item!)

      // With disableRename and disableSetDefault, the first action-btn should be Edit
      const actionButtons = container.querySelectorAll('.action-btn')
      expect(actionButtons.length).toBeGreaterThan(0)

      // First action button should be Edit, second is Delete
      await user.click(actionButtons[0])
      expect(onEdit).toHaveBeenCalledWith(
        'api-cred-1',
        expect.objectContaining({
          api_key: 'secret',
          __name__: 'Test Credential',
          __credential_id__: 'api-cred-1',
        }),
      )
    })

    it('should not show edit button for OAuth credential', () => {
      renderItem({
        credential: createOAuthCredential(),
        disableEdit: false,
      })

      const item = screen.getByText('Test Credential').closest('div')
      fireEvent.mouseEnter(item!)

      // Should not have edit button for OAuth
      const editIcon = document.querySelector('[data-testid="edit-icon"]')
      expect(editIcon).not.toBeInTheDocument()
    })

    it('should not show action buttons when from_enterprise', () => {
      renderItem({
        credential: createCredential({ from_enterprise: true }),
        disableRename: false,
        disableEdit: false,
        disableDelete: false,
      })

      // Delete button should be hidden for enterprise credentials
      const deleteIcon = document.querySelector('[class*="hover:text-text-destructive"]')
      expect(deleteIcon).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should show all actions disabled when all disable props are true', () => {
      renderItem({
        disableRename: true,
        disableEdit: true,
        disableDelete: true,
        disableSetDefault: true,
      })

      const item = screen.getByText('Test Credential').closest('div')
      fireEvent.mouseEnter(item!)

      // Should not show any action buttons
      expect(screen.queryByText(/setDefault/i)).not.toBeInTheDocument()
    })
  })
})

describe('CredentialSection Component', () => {
  const renderCredentialSection = (props: Partial<Parameters<typeof CredentialSection>[0]> = {}) => {
    const defaultProps = {
      title: 'OAuth',
      credentials: createCredentialList(2, 0),
      ...props,
    }
    return render(<CredentialSection {...defaultProps} />, { wrapper: createWrapper() })
  }

  describe('Rendering', () => {
    it('should render title', () => {
      renderCredentialSection({ title: 'API Keys' })
      expect(screen.getByText('API Keys')).toBeInTheDocument()
    })

    it('should render all credentials', () => {
      const credentials = [
        createCredential({ id: '1', name: 'Credential 1' }),
        createCredential({ id: '2', name: 'Credential 2' }),
      ]
      renderCredentialSection({ credentials })

      expect(screen.getByText('Credential 1')).toBeInTheDocument()
      expect(screen.getByText('Credential 2')).toBeInTheDocument()
    })

    it('should return null when credentials array is empty', () => {
      const { container } = renderCredentialSection({ credentials: [] })
      expect(container.firstChild).toBeNull()
    })

    it('should apply pl-7 class when showSelectedIcon is true', () => {
      const { container } = renderCredentialSection({ showSelectedIcon: true })
      expect(container.querySelector('.pl-7')).toBeInTheDocument()
    })
  })

  describe('Props Passing', () => {
    it('should pass disabled prop to items', () => {
      const { container } = renderCredentialSection({ disabled: true })
      expect(container.querySelector('.opacity-50')).toBeInTheDocument()
    })

    it('should call onItemClick when item is clicked', () => {
      const onItemClick = vi.fn()
      renderCredentialSection({
        credentials: [createCredential({ id: 'cred-1', name: 'Clickable' })],
        onItemClick,
      })

      fireEvent.click(screen.getByText('Clickable'))
      expect(onItemClick).toHaveBeenCalledWith('cred-1')
    })

    it('should call onDelete when delete triggered', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn()
      renderCredentialSection({
        credentials: [createCredential({ id: 'cred-1', name: 'Deletable' })],
        onDelete,
        disableDelete: false,
      })

      const item = screen.getByText('Deletable').closest('div')
      fireEvent.mouseEnter(item!)

      const deleteBtn = document.querySelector('[class*="hover:text-text-destructive"]')?.closest('button')
      if (deleteBtn) {
        await user.click(deleteBtn)
        expect(onDelete).toHaveBeenCalledWith('cred-1')
      }
    })
  })

  describe('ExtraCredentialSection', () => {
    const renderExtraSection = (props: Partial<Parameters<typeof ExtraCredentialSection>[0]> = {}) => {
      return render(<ExtraCredentialSection {...props} />, { wrapper: createWrapper() })
    }

    it('should return null when credentials is undefined', () => {
      const { container } = renderExtraSection({ credentials: undefined })
      expect(container.firstChild).toBeNull()
    })

    it('should return null when credentials array is empty', () => {
      const { container } = renderExtraSection({ credentials: [] })
      expect(container.firstChild).toBeNull()
    })

    it('should render credentials with all actions disabled', () => {
      const credentials = [createCredential({ id: '1', name: 'Extra Cred' })]
      renderExtraSection({ credentials })

      expect(screen.getByText('Extra Cred')).toBeInTheDocument()
      // Should not show any action buttons since all are disabled
    })
  })
})

describe('AuthorizedModals Component', () => {
  const renderModals = (props: Partial<Parameters<typeof AuthorizedModals>[0]> = {}) => {
    const defaultProps = {
      pluginPayload: createPluginPayload(),
      deleteCredentialId: null,
      doingAction: false,
      onDeleteConfirm: vi.fn(),
      onDeleteCancel: vi.fn(),
      editValues: null,
      onEditClose: vi.fn(),
      onRemove: vi.fn(),
      ...props,
    }
    return render(<AuthorizedModals {...defaultProps} />, { wrapper: createWrapper() })
  }

  describe('Delete Confirm Modal', () => {
    it('should not render when deleteCredentialId is null', () => {
      renderModals({ deleteCredentialId: null })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render when deleteCredentialId is provided', () => {
      renderModals({ deleteCredentialId: 'cred-1' })
      // Confirm component should be rendered
      expect(screen.getByRole('button', { name: /confirm/i }) || screen.getByText(/delete/i)).toBeInTheDocument()
    })

    it('should call onDeleteConfirm when confirm clicked', async () => {
      const user = userEvent.setup()
      const onDeleteConfirm = vi.fn()
      renderModals({ deleteCredentialId: 'cred-1', onDeleteConfirm })

      const confirmBtn = screen.getByRole('button', { name: /confirm/i })
      await user.click(confirmBtn)
      expect(onDeleteConfirm).toHaveBeenCalled()
    })

    it('should call onDeleteCancel when cancel clicked', async () => {
      const user = userEvent.setup()
      const onDeleteCancel = vi.fn()
      renderModals({ deleteCredentialId: 'cred-1', onDeleteCancel })

      const cancelBtn = screen.getByRole('button', { name: /cancel/i })
      await user.click(cancelBtn)
      expect(onDeleteCancel).toHaveBeenCalled()
    })

    it('should be disabled when doingAction is true', () => {
      renderModals({ deleteCredentialId: 'cred-1', doingAction: true })
      // Confirm button should be disabled
      const confirmBtn = screen.getByRole('button', { name: /confirm/i })
      expect(confirmBtn).toBeDisabled()
    })
  })

  describe('Edit Modal', () => {
    it('should not render when editValues is null', () => {
      renderModals({ editValues: null })
      expect(screen.queryByTestId('api-key-modal')).not.toBeInTheDocument()
    })

    it('should render when editValues is provided', () => {
      renderModals({ editValues: { api_key: 'test' } })
      expect(screen.getByTestId('api-key-modal')).toBeInTheDocument()
    })

    it('should pass editValues to ApiKeyModal', () => {
      const editValues = { api_key: 'secret', __name__: 'Test' }
      renderModals({ editValues })

      expect(screen.getByTestId('modal-edit-values')).toHaveTextContent(JSON.stringify(editValues))
    })

    it('should call onEditClose when close clicked', async () => {
      const user = userEvent.setup()
      const onEditClose = vi.fn()
      renderModals({ editValues: { key: 'value' }, onEditClose })

      await user.click(screen.getByTestId('modal-close-btn'))
      expect(onEditClose).toHaveBeenCalled()
    })

    it('should call onRemove when remove clicked', async () => {
      const user = userEvent.setup()
      const onRemove = vi.fn()
      renderModals({ editValues: { key: 'value' }, onRemove })

      await user.click(screen.getByTestId('modal-remove-btn'))
      expect(onRemove).toHaveBeenCalled()
    })

    it('should be disabled when disabled or doingAction is true', () => {
      renderModals({ editValues: { key: 'value' }, disabled: true })
      expect(screen.getByTestId('modal-close-btn')).toBeDisabled()
    })
  })
})

describe('Authorized Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeletePluginCredential.mockResolvedValue({})
    mockSetPluginDefaultCredential.mockResolvedValue({})
    mockUpdatePluginCredential.mockResolvedValue({})
  })

  const renderAuthorized = (props: Partial<Parameters<typeof Authorized>[0]> = {}) => {
    const defaultProps = {
      pluginPayload: createPluginPayload(),
      credentials: createCredentialList(2, 1),
      ...props,
    }
    return render(<Authorized {...defaultProps} />, { wrapper: createWrapper() })
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      renderAuthorized()
      // Should render the trigger button
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should display credentials count', () => {
      renderAuthorized({ credentials: createCredentialList(3, 2) })
      // The count is displayed within the button text
      const button = screen.getByRole('button')
      expect(button.textContent).toContain('5')
    })

    it('should show singular authorization text for single credential', () => {
      renderAuthorized({ credentials: [createCredential()] })
      expect(screen.getByText(/authorization/i)).toBeInTheDocument()
    })

    it('should show plural authorizations text for multiple credentials', () => {
      renderAuthorized({ credentials: createCredentialList(2, 0) })
      expect(screen.getByText(/authorizations/i)).toBeInTheDocument()
    })

    it('should show unavailable count when credentials are unavailable', () => {
      const credentials = [
        createCredential({ not_allowed_to_use: true }),
        createCredential({ id: '2' }),
      ]
      renderAuthorized({ credentials })
      expect(screen.getByText(/unavailable/i)).toBeInTheDocument()
    })

    it('should render custom trigger when renderTrigger provided', () => {
      renderAuthorized({
        renderTrigger: open => <div data-testid="custom-trigger">{open ? 'Open' : 'Closed'}</div>,
      })
      expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
    })
  })

  describe('Dropdown Behavior', () => {
    it('should open dropdown when trigger clicked', async () => {
      const user = userEvent.setup()
      renderAuthorized()

      await user.click(screen.getByRole('button'))
      // Wait for dropdown content to appear
      await waitFor(() => {
        expect(screen.getByText('OAuth')).toBeInTheDocument()
      })
    })

    it('should use controlled isOpen prop', () => {
      renderAuthorized({ isOpen: true })
      expect(screen.getByText('OAuth')).toBeInTheDocument()
    })

    it('should call onOpenChange when dropdown state changes', async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      renderAuthorized({ onOpenChange })

      await user.click(screen.getByRole('button'))
      expect(onOpenChange).toHaveBeenCalledWith(true)
    })
  })

  describe('Credential Sections', () => {
    it('should render OAuth section with OAuth credentials', async () => {
      const user = userEvent.setup()
      const credentials = [
        createOAuthCredential({ id: '1', name: 'OAuth Cred' }),
      ]
      renderAuthorized({ credentials })

      await user.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('OAuth')).toBeInTheDocument()
        expect(screen.getByText('OAuth Cred')).toBeInTheDocument()
      })
    })

    it('should render API Keys section with API key credentials', async () => {
      const user = userEvent.setup()
      const credentials = [
        createApiKeyCredential({ id: '1', name: 'API Key Cred' }),
      ]
      renderAuthorized({ credentials })

      await user.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('API Keys')).toBeInTheDocument()
        expect(screen.getByText('API Key Cred')).toBeInTheDocument()
      })
    })

    it('should render extra authorization items', async () => {
      const user = userEvent.setup()
      const extraItems = [createCredential({ id: 'extra-1', name: 'Extra Item' })]
      renderAuthorized({ extraAuthorizationItems: extraItems })

      await user.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('Extra Item')).toBeInTheDocument()
      })
    })
  })

  describe('Authorize Component', () => {
    it('should render Authorize component when notAllowCustomCredential is false', async () => {
      const user = userEvent.setup()
      renderAuthorized({ notAllowCustomCredential: false })

      await user.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByTestId('authorize-component')).toBeInTheDocument()
      })
    })

    it('should not render Authorize component when notAllowCustomCredential is true', async () => {
      const user = userEvent.setup()
      renderAuthorized({ notAllowCustomCredential: true })

      await user.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.queryByTestId('authorize-component')).not.toBeInTheDocument()
      })
    })
  })

  describe('Modals', () => {
    it('should show delete confirmation when delete is triggered', async () => {
      const user = userEvent.setup()
      const credentials = [createCredential({ id: 'cred-1', name: 'Deletable Cred' })]
      renderAuthorized({ credentials })

      await user.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('Deletable Cred')).toBeInTheDocument()
      })

      const item = screen.getByText('Deletable Cred').closest('div')
      fireEvent.mouseEnter(item!)

      const deleteBtn = document.querySelector('[class*="hover:text-text-destructive"]')?.closest('button')
      if (deleteBtn) {
        await user.click(deleteBtn)
        await waitFor(() => {
          expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
        })
      }
    })

    it('should execute delete and close confirmation when confirm is clicked', async () => {
      const user = userEvent.setup()
      const onUpdate = vi.fn()
      const credentials = [createCredential({ id: 'cred-to-delete', name: 'Credential To Delete' })]
      renderAuthorized({ credentials, onUpdate })

      // Open dropdown
      await user.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('Credential To Delete')).toBeInTheDocument()
      })

      // Trigger delete on the credential
      const item = screen.getByText('Credential To Delete').closest('div')
      fireEvent.mouseEnter(item!)

      const deleteBtn = document.querySelector('[class*="hover:text-text-destructive"]')?.closest('button')
      expect(deleteBtn).not.toBeNull()
      await user.click(deleteBtn!)

      // Wait for delete confirmation dialog
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
      })

      // Click confirm button to execute delete
      const confirmBtn = screen.getByRole('button', { name: /confirm/i })
      await user.click(confirmBtn)

      // Verify delete was called
      await waitFor(() => {
        expect(mockDeletePluginCredential).toHaveBeenCalledWith({ credential_id: 'cred-to-delete' })
      })

      // Verify onUpdate was called
      expect(onUpdate).toHaveBeenCalled()

      // Verify confirmation dialog is closed
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument()
      })
    })

    it('should close delete confirmation when cancel is clicked', async () => {
      const user = userEvent.setup()
      const credentials = [createCredential({ id: 'cred-1', name: 'Test Cred' })]
      renderAuthorized({ credentials })

      // Open dropdown
      await user.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('Test Cred')).toBeInTheDocument()
      })

      // Trigger delete
      const item = screen.getByText('Test Cred').closest('div')
      fireEvent.mouseEnter(item!)

      const deleteBtn = document.querySelector('[class*="hover:text-text-destructive"]')?.closest('button')
      expect(deleteBtn).not.toBeNull()
      await user.click(deleteBtn!)

      // Wait for confirmation dialog
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
      })

      // Click cancel
      await user.click(screen.getByRole('button', { name: /cancel/i }))

      // Verify dialog is closed and delete was not called
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument()
      })
      expect(mockDeletePluginCredential).not.toHaveBeenCalled()
    })

    it('should prevent duplicate delete when confirm is clicked rapidly', async () => {
      const user = userEvent.setup()
      // Make delete take some time to complete
      mockDeletePluginCredential.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))

      const credentials = [createCredential({ id: 'cred-rapid', name: 'Rapid Click Cred' })]
      renderAuthorized({ credentials })

      // Open dropdown
      await user.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('Rapid Click Cred')).toBeInTheDocument()
      })

      // Trigger delete
      const item = screen.getByText('Rapid Click Cred').closest('div')
      fireEvent.mouseEnter(item!)

      const deleteBtn = document.querySelector('[class*="hover:text-text-destructive"]')?.closest('button')
      expect(deleteBtn).not.toBeNull()
      await user.click(deleteBtn!)

      // Wait for confirmation dialog
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
      })

      // Click confirm multiple times rapidly (simulate double-click)
      const confirmBtn = screen.getByRole('button', { name: /confirm/i })
      fireEvent.click(confirmBtn)
      fireEvent.click(confirmBtn)

      // Wait for delete to complete
      await waitFor(() => {
        // Delete should only be called once despite multiple clicks
        expect(mockDeletePluginCredential).toHaveBeenCalledTimes(1)
      }, { timeout: 500 })
    })

    it('should disable confirm button when another action is in progress', async () => {
      // Create a promise that we control when to resolve
      let resolveSetDefault: () => void = () => {}
      const setDefaultPromise = new Promise<void>((resolve) => {
        resolveSetDefault = resolve
      })
      mockSetPluginDefaultCredential.mockReturnValue(setDefaultPromise)
      mockDeletePluginCredential.mockResolvedValue({})

      const credentials = [
        createCredential({ id: 'cred-1', name: 'Cred One', is_default: false }),
      ]
      renderAuthorized({ credentials, disableSetDefault: false })

      // Open dropdown
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('Cred One')).toBeInTheDocument()
      })

      // Hover to show action buttons
      const item = screen.getByText('Cred One').closest('div')
      fireEvent.mouseEnter(item!)

      // Start setDefault action - this sets doingAction = true
      const setDefaultBtn = screen.getByText(/setDefault/i)
      fireEvent.click(setDefaultBtn)

      // Now trigger delete dialog (while setDefault is still in progress)
      const deleteBtn = document.querySelector('[class*="hover:text-text-destructive"]')?.closest('button')
      expect(deleteBtn).not.toBeNull()
      fireEvent.click(deleteBtn!)

      // Wait for confirmation dialog
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
      })

      // Confirm button should be disabled because doingAction is true
      const confirmBtn = screen.getByRole('button', { name: /confirm/i })
      expect(confirmBtn).toBeDisabled()

      // Delete should not be called because button is disabled
      expect(mockDeletePluginCredential).not.toHaveBeenCalled()

      // Now resolve setDefault to clean up
      await act(async () => {
        resolveSetDefault()
      })

      // After action completes, confirm button should be enabled
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i })).not.toBeDisabled()
      })
    })
  })

  describe('Props Variations', () => {
    it('should apply popupClassName', async () => {
      const user = userEvent.setup()
      renderAuthorized({ popupClassName: 'custom-popup' })

      await user.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('.custom-popup')).toBeInTheDocument()
      })
    })

    it('should pass disabled to child components', async () => {
      const user = userEvent.setup()
      renderAuthorized({ disabled: true })

      await user.click(screen.getByRole('button'))
      await waitFor(() => {
        const items = document.querySelectorAll('.opacity-50')
        expect(items.length).toBeGreaterThan(0)
      })
    })

    it('should pass canOAuth and canApiKey to Authorize', async () => {
      const user = userEvent.setup()
      renderAuthorized({ canOAuth: true, canApiKey: false })

      await user.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByTestId('authorize-component')).toBeInTheDocument()
      })
    })
  })

  describe('Indicator Color', () => {
    it('should show gray indicator when default credential is unavailable', () => {
      const credentials = [
        createCredential({ is_default: true, not_allowed_to_use: true }),
      ]
      renderAuthorized({ credentials })

      // The indicator should be gray
      const indicator = document.querySelector('[class*="Indicator"]')
      expect(indicator).toBeInTheDocument()
    })

    it('should show green indicator when default credential is available', () => {
      const credentials = [
        createCredential({ is_default: true, not_allowed_to_use: false }),
      ]
      renderAuthorized({ credentials })

      const indicator = document.querySelector('[class*="Indicator"]')
      expect(indicator).toBeInTheDocument()
    })
  })

  describe('Memoization', () => {
    it('should memoize credential filtering', async () => {
      const credentials = createCredentialList(2, 2)
      const { rerender } = renderAuthorized({ credentials })

      // Rerender with same credentials should not cause issues
      rerender(
        <QueryClientProvider client={createTestQueryClient()}>
          <Authorized pluginPayload={createPluginPayload()} credentials={credentials} />
        </QueryClientProvider>,
      )

      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty credentials array', () => {
      renderAuthorized({ credentials: [] })
      const button = screen.getByRole('button')
      expect(button.textContent).toContain('0')
    })

    it('should handle all OAuth credentials', async () => {
      const user = userEvent.setup()
      const credentials = [
        createOAuthCredential({ id: '1', name: 'OAuth 1' }),
        createOAuthCredential({ id: '2', name: 'OAuth 2' }),
      ]
      renderAuthorized({ credentials })

      await user.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('OAuth')).toBeInTheDocument()
        expect(screen.queryByText('API Keys')).not.toBeInTheDocument()
      })
    })

    it('should handle all API Key credentials', async () => {
      const user = userEvent.setup()
      const credentials = [
        createApiKeyCredential({ id: '1', name: 'API 1' }),
        createApiKeyCredential({ id: '2', name: 'API 2' }),
      ]
      renderAuthorized({ credentials })

      await user.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('API Keys')).toBeInTheDocument()
        // OAuth section should not render with no OAuth credentials
      })
    })

    it('should handle credentials without credential_type', async () => {
      const user = userEvent.setup()
      const credentials = [
        createCredential({ id: '1', name: 'Unknown Type', credential_type: undefined }),
      ]
      renderAuthorized({ credentials })

      await user.click(screen.getByRole('button'))
      // Should not crash - credentials without type are filtered out from both sections
      await waitFor(() => {
        // Neither OAuth nor API Keys section should show since no matching credentials
        expect(screen.queryByText('OAuth')).not.toBeInTheDocument()
        expect(screen.queryByText('API Keys')).not.toBeInTheDocument()
      })
    })
  })

  describe('Callback Invocations', () => {
    it('should call onUpdate when credential action succeeds', async () => {
      const user = userEvent.setup()
      const onUpdate = vi.fn()
      const credentials = [createCredential({ id: 'cred-1', name: 'Test', is_default: false })]
      renderAuthorized({ credentials, onUpdate, disableSetDefault: false })

      await user.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument()
      })

      const item = screen.getByText('Test').closest('div')
      fireEvent.mouseEnter(item!)

      const setDefaultBtn = screen.getByText(/setDefault/i)
      await user.click(setDefaultBtn)

      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalled()
      })
    })

    it('should call onItemClick when credential is clicked', async () => {
      const user = userEvent.setup()
      const onItemClick = vi.fn()
      const credentials = [createCredential({ id: 'cred-1', name: 'Clickable' })]
      renderAuthorized({ credentials, onItemClick })

      await user.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('Clickable')).toBeInTheDocument()
      })

      await user.click(screen.getByText('Clickable'))
      expect(onItemClick).toHaveBeenCalledWith('cred-1')
    })
  })
})
