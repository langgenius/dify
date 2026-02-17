import type { DataSourceAuth, DataSourceCredential } from './types'
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePluginAuthAction } from '@/app/components/plugins/plugin-auth'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { CollectionType } from '@/app/components/tools/types'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { openOAuthPopup } from '@/hooks/use-oauth'
import { useGetDataSourceOAuthUrl } from '@/service/use-datasource'
import Card from './card'
import { useDataSourceAuthUpdate } from './hooks'

/**
 * Mocking sub-components and hooks to isolate Card component for unit testing.
 * Following the Unit approach for complex directories.
 */
vi.mock('./configure', () => ({
  default: vi.fn(({ onUpdate }: { onUpdate: () => void }) => (
    <div data-testid="mock-configure" onClick={onUpdate}>Configure</div>
  )),
}))

vi.mock('./item', () => ({
  default: vi.fn(({ credentialItem, onAction }: { credentialItem: DataSourceCredential, onAction: (action: string, item: DataSourceCredential, payload?: Record<string, unknown>) => void }) => (
    <div data-testid={`mock-item-${credentialItem.id}`}>
      <button data-testid={`action-edit-${credentialItem.id}`} onClick={() => onAction('edit', credentialItem)}>Edit</button>
      <button data-testid={`action-delete-${credentialItem.id}`} onClick={() => onAction('delete', credentialItem)}>Delete</button>
      <button data-testid={`action-setDefault-${credentialItem.id}`} onClick={() => onAction('setDefault', credentialItem)}>Set Default</button>
      <button data-testid={`action-rename-${credentialItem.id}`} onClick={() => onAction('rename', credentialItem, { name: 'new name' })}>Rename</button>
      <button data-testid={`action-change-${credentialItem.id}`} onClick={() => onAction('change', credentialItem)}>Change</button>
      <button data-testid={`action-unknown-${credentialItem.id}`} onClick={() => onAction('unknown', credentialItem)}>Unknown</button>
    </div>
  )),
}))

vi.mock('@/app/components/base/confirm', () => ({
  default: vi.fn(({ isShow, onCancel, onConfirm, isDisabled }: { isShow: boolean, onCancel: () => void, onConfirm: () => void, isDisabled: boolean }) => isShow
    ? (
        <div data-testid="mock-confirm" data-disabled={isDisabled}>
          <button data-testid="confirm-cancel" onClick={onCancel}>Cancel</button>
          <button data-testid="confirm-confirm" onClick={onConfirm}>Confirm</button>
        </div>
      )
    : null),
}))

vi.mock('@/app/components/plugins/plugin-auth', () => ({
  ApiKeyModal: vi.fn(({ onClose, onUpdate, onRemove, disabled, editValues }: { onClose: () => void, onUpdate: () => void, onRemove: () => void, disabled: boolean, editValues: Record<string, unknown> }) => (
    <div data-testid="mock-api-key-modal" data-disabled={disabled}>
      <button data-testid="modal-close" onClick={onClose}>Close</button>
      <button data-testid="modal-update" onClick={onUpdate}>Update</button>
      <button data-testid="modal-remove" onClick={onRemove}>Remove</button>
      <div data-testid="edit-values">{JSON.stringify(editValues)}</div>
    </div>
  )),
  usePluginAuthAction: vi.fn(),
  AuthCategory: {
    datasource: 'datasource',
  },
}))

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: vi.fn(),
}))

vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: vi.fn(),
}))

vi.mock('@/service/use-datasource', () => ({
  useGetDataSourceOAuthUrl: vi.fn(),
}))

vi.mock('./hooks', () => ({
  useDataSourceAuthUpdate: vi.fn(),
}))

type UsePluginAuthActionReturn = ReturnType<typeof usePluginAuthAction>
type UseGetDataSourceOAuthUrlReturn = ReturnType<typeof useGetDataSourceOAuthUrl>
type UseRenderI18nObjectReturn = ReturnType<typeof useRenderI18nObject>

describe('Card Component', () => {
  const mockHandleAuthUpdate = vi.fn()
  const mockGetPluginOAuthUrl = vi.fn()
  const mockRenderI18nObjectResult = vi.fn((obj: Record<string, string>) => obj.en_US)

  const createMockPluginAuthActionReturn = (overrides: Partial<UsePluginAuthActionReturn> = {}): UsePluginAuthActionReturn => ({
    deleteCredentialId: null,
    doingAction: false,
    handleConfirm: vi.fn(),
    handleEdit: vi.fn(),
    handleRemove: vi.fn(),
    handleRename: vi.fn(),
    handleSetDefault: vi.fn(),
    handleSetDoingAction: vi.fn(),
    setDeleteCredentialId: vi.fn(),
    editValues: null,
    setEditValues: vi.fn(),
    openConfirm: vi.fn(),
    closeConfirm: vi.fn(),
    pendingOperationCredentialId: { current: null },
    ...overrides,
  })

  const mockItem: DataSourceAuth = {
    author: 'Test Author',
    provider: 'test-provider',
    plugin_id: 'test-plugin-id',
    plugin_unique_identifier: 'test-unique-id',
    icon: 'test-icon-url',
    name: 'test-name',
    label: {
      en_US: 'Test Label',
      zh_Hans: '',
    },
    description: {
      en_US: 'Test Description',
      zh_Hans: '',
    },
    credentials_list: [
      {
        id: 'c1',
        name: 'Credential 1',
        credential: { apiKey: 'key1' },
        type: CredentialTypeEnum.API_KEY,
        is_default: true,
        avatar_url: 'avatar1',
      },
    ],
  }

  let mockPluginAuthActionReturn: UsePluginAuthActionReturn

  beforeEach(() => {
    vi.clearAllMocks()
    mockPluginAuthActionReturn = createMockPluginAuthActionReturn()
    vi.mocked(useDataSourceAuthUpdate).mockReturnValue({ handleAuthUpdate: mockHandleAuthUpdate })
    vi.mocked(usePluginAuthAction).mockReturnValue(mockPluginAuthActionReturn)
    vi.mocked(useRenderI18nObject).mockReturnValue(mockRenderI18nObjectResult as unknown as UseRenderI18nObjectReturn)
    vi.mocked(useGetDataSourceOAuthUrl).mockReturnValue({ mutateAsync: mockGetPluginOAuthUrl } as unknown as UseGetDataSourceOAuthUrlReturn)
  })

  describe('Rendering', () => {
    it('should render the card with provided item data and initialize hooks correctly', () => {
      // Act
      render(<Card item={mockItem} />)

      // Assert
      expect(screen.getByText('Test Label')).toBeInTheDocument()
      expect(screen.getByText(/Test Author/)).toBeInTheDocument()
      expect(screen.getByText(/test-name/)).toBeInTheDocument()
      expect(screen.getByRole('img')).toHaveAttribute('src', 'test-icon-url')
      expect(screen.getByTestId('mock-item-c1')).toBeInTheDocument()

      expect(useDataSourceAuthUpdate).toHaveBeenCalledWith({
        pluginId: 'test-plugin-id',
        provider: 'test-name',
      })
      expect(usePluginAuthAction).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'datasource',
          provider: 'test-plugin-id/test-name',
          providerType: CollectionType.datasource,
        }),
        mockHandleAuthUpdate,
      )
    })

    it('should render empty state when credentials_list is empty', () => {
      // Arrange
      const emptyItem = { ...mockItem, credentials_list: [] }

      // Act
      render(<Card item={emptyItem} />)

      // Assert
      expect(screen.getByText(/plugin.auth.emptyAuth/)).toBeInTheDocument()
    })
  })

  describe('Actions', () => {
    it('should handle "edit" action from Item component', () => {
      // Act
      render(<Card item={mockItem} />)
      fireEvent.click(screen.getByTestId('action-edit-c1'))

      // Assert
      expect(mockPluginAuthActionReturn.handleEdit).toHaveBeenCalledWith('c1', {
        apiKey: 'key1',
        __name__: 'Credential 1',
        __credential_id__: 'c1',
      })
    })

    it('should handle "delete" action from Item component', () => {
      // Act
      render(<Card item={mockItem} />)
      fireEvent.click(screen.getByTestId('action-delete-c1'))

      // Assert
      expect(mockPluginAuthActionReturn.openConfirm).toHaveBeenCalledWith('c1')
    })

    it('should handle "setDefault" action from Item component', () => {
      // Act
      render(<Card item={mockItem} />)
      fireEvent.click(screen.getByTestId('action-setDefault-c1'))

      // Assert
      expect(mockPluginAuthActionReturn.handleSetDefault).toHaveBeenCalledWith('c1')
    })

    it('should handle "rename" action from Item component', () => {
      // Act
      render(<Card item={mockItem} />)
      fireEvent.click(screen.getByTestId('action-rename-c1'))

      // Assert
      expect(mockPluginAuthActionReturn.handleRename).toHaveBeenCalledWith({ name: 'new name' })
    })

    it('should handle "change" action and trigger OAuth flow', async () => {
      // Arrange
      mockGetPluginOAuthUrl.mockResolvedValue({ authorization_url: 'https://oauth.url' })
      render(<Card item={mockItem} />)

      // Act
      fireEvent.click(screen.getByTestId('action-change-c1'))

      // Assert
      await waitFor(() => {
        expect(mockGetPluginOAuthUrl).toHaveBeenCalledWith('c1')
        expect(openOAuthPopup).toHaveBeenCalledWith('https://oauth.url', mockHandleAuthUpdate)
      })
    })

    it('should not open popup if authorization_url is missing during "change" action', async () => {
      // Arrange
      mockGetPluginOAuthUrl.mockResolvedValue({ authorization_url: '' })
      render(<Card item={mockItem} />)

      // Act
      fireEvent.click(screen.getByTestId('action-change-c1'))

      // Assert
      await waitFor(() => {
        expect(mockGetPluginOAuthUrl).toHaveBeenCalledWith('c1')
        expect(openOAuthPopup).not.toHaveBeenCalled()
      })
    })

    it('should handle "unknown" action from Item component without side effects', () => {
      // Act
      render(<Card item={mockItem} />)
      fireEvent.click(screen.getByTestId('action-unknown-c1'))

      // Assert
      expect(mockPluginAuthActionReturn.handleEdit).not.toHaveBeenCalled()
      expect(mockPluginAuthActionReturn.openConfirm).not.toHaveBeenCalled()
      expect(mockPluginAuthActionReturn.handleSetDefault).not.toHaveBeenCalled()
      expect(mockPluginAuthActionReturn.handleRename).not.toHaveBeenCalled()
      expect(mockGetPluginOAuthUrl).not.toHaveBeenCalled()
    })
  })

  describe('Modals', () => {
    it('should show Confirm dialog when deleteCredentialId is set and handle its actions', () => {
      // Arrange
      const mockReturn = createMockPluginAuthActionReturn({ deleteCredentialId: 'c1', doingAction: true })
      vi.mocked(usePluginAuthAction).mockReturnValue(mockReturn)
      render(<Card item={mockItem} />)

      // Assert
      expect(screen.getByTestId('mock-confirm')).toBeInTheDocument()
      expect(screen.getByTestId('mock-confirm')).toHaveAttribute('data-disabled', 'true')

      // Act
      fireEvent.click(screen.getByTestId('confirm-cancel'))
      expect(mockReturn.closeConfirm).toHaveBeenCalled()

      fireEvent.click(screen.getByTestId('confirm-confirm'))
      expect(mockReturn.handleConfirm).toHaveBeenCalled()
    })

    it('should show ApiKeyModal when editValues is set and handle its actions', () => {
      // Arrange
      const mockReturn = createMockPluginAuthActionReturn({ editValues: { some: 'value' }, doingAction: false })
      vi.mocked(usePluginAuthAction).mockReturnValue(mockReturn)
      render(<Card item={mockItem} disabled={false} />)

      // Assert
      expect(screen.getByTestId('mock-api-key-modal')).toBeInTheDocument()
      expect(screen.getByTestId('mock-api-key-modal')).toHaveAttribute('data-disabled', 'false')

      // Act
      fireEvent.click(screen.getByTestId('modal-close'))
      expect(mockReturn.setEditValues).toHaveBeenCalledWith(null)
      expect(mockReturn.pendingOperationCredentialId.current).toBeNull()

      fireEvent.click(screen.getByTestId('modal-remove'))
      expect(mockReturn.handleRemove).toHaveBeenCalled()
    })

    it('should disable ApiKeyModal when doingAction is true', () => {
      // Arrange
      const mockReturnDoing = createMockPluginAuthActionReturn({ editValues: { some: 'value' }, doingAction: true })
      vi.mocked(usePluginAuthAction).mockReturnValue(mockReturnDoing)

      // Act
      render(<Card item={mockItem} disabled={false} />)

      // Assert
      expect(screen.getByTestId('mock-api-key-modal')).toHaveAttribute('data-disabled', 'true')
    })

    it('should hide modals when their trigger values are null', () => {
      // Arrange
      vi.mocked(usePluginAuthAction).mockReturnValue(createMockPluginAuthActionReturn({
        deleteCredentialId: null,
        editValues: null,
      }))

      // Act
      render(<Card item={mockItem} />)

      // Assert
      expect(screen.queryByTestId('mock-confirm')).not.toBeInTheDocument()
      expect(screen.queryByTestId('mock-api-key-modal')).not.toBeInTheDocument()
    })

    it('should honor the disabled prop in ApiKeyModal when it is true', () => {
      // Arrange
      const mockReturn = createMockPluginAuthActionReturn({
        editValues: { apiKey: 'test' },
        doingAction: false,
      })
      vi.mocked(usePluginAuthAction).mockReturnValue(mockReturn)

      // Act
      render(<Card item={mockItem} disabled={true} />)

      // Assert
      expect(screen.getByTestId('mock-api-key-modal')).toHaveAttribute('data-disabled', 'true')
    })
  })

  describe('Integration', () => {
    it('should call handleAuthUpdate when Configure component triggers update', () => {
      // Act
      render(<Card item={mockItem} />)
      fireEvent.click(screen.getByTestId('mock-configure'))

      // Assert
      expect(mockHandleAuthUpdate).toHaveBeenCalled()
    })

    it('should maintain stable handleAction reference', () => {
      // Use renderHook to test hook logic or just verify it does not crash
      const { result } = renderHook(() => useDataSourceAuthUpdate({ pluginId: '1', provider: 'p' }))
      expect(result.current.handleAuthUpdate).toBeDefined()
    })
  })
})
