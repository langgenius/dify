import type { DataSourceAuth } from './types'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { usePluginAuthAction } from '@/app/components/plugins/plugin-auth'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { CollectionType } from '@/app/components/tools/types'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { openOAuthPopup } from '@/hooks/use-oauth'
import { useGetDataSourceOAuthUrl, useInvalidDataSourceAuth, useInvalidDataSourceListAuth, useInvalidDefaultDataSourceListAuth } from '@/service/use-datasource'
import { useInvalidDataSourceList } from '@/service/use-pipeline'
import Card from './card'
import { useDataSourceAuthUpdate } from './hooks'

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
  AddApiKeyButton: ({ onUpdate }: { onUpdate: () => void }) => <button onClick={onUpdate}>Add API Key</button>,
  AddOAuthButton: ({ onUpdate }: { onUpdate: () => void }) => <button onClick={onUpdate}>Add OAuth</button>,
}))

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: vi.fn(),
}))

vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: vi.fn(),
}))

vi.mock('@/service/use-datasource', () => ({
  useGetDataSourceOAuthUrl: vi.fn(),
  useInvalidDataSourceAuth: vi.fn(() => vi.fn()),
  useInvalidDataSourceListAuth: vi.fn(() => vi.fn()),
  useInvalidDefaultDataSourceListAuth: vi.fn(() => vi.fn()),
}))

vi.mock('./hooks', () => ({
  useDataSourceAuthUpdate: vi.fn(),
}))

vi.mock('@/service/use-pipeline', () => ({
  useInvalidDataSourceList: vi.fn(() => vi.fn()),
}))

type UsePluginAuthActionReturn = ReturnType<typeof usePluginAuthAction>
type UseGetDataSourceOAuthUrlReturn = ReturnType<typeof useGetDataSourceOAuthUrl>
type UseRenderI18nObjectReturn = ReturnType<typeof useRenderI18nObject>

describe('Card Component', () => {
  const mockGetPluginOAuthUrl = vi.fn()
  const mockRenderI18nObjectResult = vi.fn((obj: Record<string, string>) => obj.en_US)
  const mockInvalidateDataSourceListAuth = vi.fn()
  const mockInvalidDefaultDataSourceListAuth = vi.fn()
  const mockInvalidateDataSourceList = vi.fn()
  const mockInvalidateDataSourceAuth = vi.fn()
  const mockHandleAuthUpdate = vi.fn(() => {
    mockInvalidateDataSourceListAuth()
    mockInvalidDefaultDataSourceListAuth()
    mockInvalidateDataSourceList()
    mockInvalidateDataSourceAuth()
  })

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
    vi.mocked(useInvalidDataSourceListAuth).mockReturnValue(mockInvalidateDataSourceListAuth)
    vi.mocked(useInvalidDefaultDataSourceListAuth).mockReturnValue(mockInvalidDefaultDataSourceListAuth)
    vi.mocked(useInvalidDataSourceList).mockReturnValue(mockInvalidateDataSourceList)
    vi.mocked(useInvalidDataSourceAuth).mockReturnValue(mockInvalidateDataSourceAuth)

    vi.mocked(usePluginAuthAction).mockReturnValue(mockPluginAuthActionReturn)
    vi.mocked(useRenderI18nObject).mockReturnValue(mockRenderI18nObjectResult as unknown as UseRenderI18nObjectReturn)
    vi.mocked(useGetDataSourceOAuthUrl).mockReturnValue({ mutateAsync: mockGetPluginOAuthUrl } as unknown as UseGetDataSourceOAuthUrlReturn)
  })

  const expectAuthUpdated = () => {
    expect(mockInvalidateDataSourceListAuth).toHaveBeenCalled()
    expect(mockInvalidDefaultDataSourceListAuth).toHaveBeenCalled()
    expect(mockInvalidateDataSourceList).toHaveBeenCalled()
    expect(mockInvalidateDataSourceAuth).toHaveBeenCalled()
  }

  describe('Rendering', () => {
    it('should render the card with provided item data and initialize hooks correctly', () => {
      // Act
      render(<Card item={mockItem} />)

      // Assert
      expect(screen.getByText('Test Label')).toBeInTheDocument()
      expect(screen.getByText(/Test Author/)).toBeInTheDocument()
      expect(screen.getByText(/test-name/)).toBeInTheDocument()
      expect(screen.getByRole('img')).toHaveAttribute('src', 'test-icon-url')
      expect(screen.getByText('Credential 1')).toBeInTheDocument()

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
    const openDropdown = (text: string) => {
      const item = screen.getByText(text).closest('.flex')
      const trigger = within(item as HTMLElement).getByRole('button')
      fireEvent.click(trigger)
    }

    it('should handle "edit" action from Item component', async () => {
      // Act
      render(<Card item={mockItem} />)
      openDropdown('Credential 1')
      fireEvent.click(screen.getByText(/operation.edit/))

      // Assert
      expect(mockPluginAuthActionReturn.handleEdit).toHaveBeenCalledWith('c1', {
        apiKey: 'key1',
        __name__: 'Credential 1',
        __credential_id__: 'c1',
      })
    })

    it('should handle "delete" action from Item component', async () => {
      // Act
      render(<Card item={mockItem} />)
      openDropdown('Credential 1')
      fireEvent.click(screen.getByText(/operation.remove/))

      // Assert
      expect(mockPluginAuthActionReturn.openConfirm).toHaveBeenCalledWith('c1')
    })

    it('should handle "setDefault" action from Item component', async () => {
      // Act
      render(<Card item={mockItem} />)
      openDropdown('Credential 1')
      fireEvent.click(screen.getByText(/auth.setDefault/))

      // Assert
      expect(mockPluginAuthActionReturn.handleSetDefault).toHaveBeenCalledWith('c1')
    })

    it('should handle "rename" action from Item component', async () => {
      // Arrange
      const oAuthItem = {
        ...mockItem,
        credentials_list: [{
          ...mockItem.credentials_list[0],
          type: CredentialTypeEnum.OAUTH2,
        }],
      }
      render(<Card item={oAuthItem} />)

      // Act
      openDropdown('Credential 1')
      fireEvent.click(screen.getByText(/operation.rename/))

      // Now it should show an input
      const input = screen.getByPlaceholderText(/placeholder.input/)
      fireEvent.change(input, { target: { value: 'New Name' } })
      fireEvent.click(screen.getByText(/operation.save/))

      // Assert
      expect(mockPluginAuthActionReturn.handleRename).toHaveBeenCalledWith({
        credential_id: 'c1',
        name: 'New Name',
      })
    })

    it('should handle "change" action and trigger OAuth flow', async () => {
      // Arrange
      const oAuthItem = {
        ...mockItem,
        credentials_list: [{
          ...mockItem.credentials_list[0],
          type: CredentialTypeEnum.OAUTH2,
        }],
      }
      mockGetPluginOAuthUrl.mockResolvedValue({ authorization_url: 'https://oauth.url' })
      render(<Card item={oAuthItem} />)

      // Act
      openDropdown('Credential 1')
      fireEvent.click(screen.getByText(/dataSource.notion.changeAuthorizedPages/))

      // Assert
      await waitFor(() => {
        expect(mockGetPluginOAuthUrl).toHaveBeenCalledWith('c1')
        expect(openOAuthPopup).toHaveBeenCalledWith('https://oauth.url', mockHandleAuthUpdate)
      })
    })

    it('should not trigger OAuth flow if authorization_url is missing', async () => {
      // Arrange
      const oAuthItem = {
        ...mockItem,
        credentials_list: [{
          ...mockItem.credentials_list[0],
          type: CredentialTypeEnum.OAUTH2,
        }],
      }
      mockGetPluginOAuthUrl.mockResolvedValue({ authorization_url: '' })
      render(<Card item={oAuthItem} />)

      // Act
      openDropdown('Credential 1')
      fireEvent.click(screen.getByText(/dataSource.notion.changeAuthorizedPages/))

      // Assert
      await waitFor(() => {
        expect(mockGetPluginOAuthUrl).toHaveBeenCalledWith('c1')
      })
      expect(openOAuthPopup).not.toHaveBeenCalled()
    })
  })

  describe('Modals', () => {
    it('should show Confirm dialog when deleteCredentialId is set and handle its actions', () => {
      // Arrange
      const mockReturn = createMockPluginAuthActionReturn({ deleteCredentialId: 'c1', doingAction: false })
      vi.mocked(usePluginAuthAction).mockReturnValue(mockReturn)

      // Act
      render(<Card item={mockItem} />)

      // Assert
      expect(screen.getByText(/list.delete.title/)).toBeInTheDocument()
      const confirmButton = screen.getByText(/operation.confirm/).closest('button')
      expect(confirmButton).toBeEnabled()

      // Act - Cancel
      fireEvent.click(screen.getByText(/operation.cancel/))
      expect(mockReturn.closeConfirm).toHaveBeenCalled()

      // Act - Confirm (even if disabled in UI, fireEvent still works unless we check)
      fireEvent.click(screen.getByText(/operation.confirm/))
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
  })

  describe('Integration', () => {
    it('should call handleAuthUpdate when Configure component triggers update', async () => {
      // Arrange
      const configurableItem: DataSourceAuth = {
        ...mockItem,
        credential_schema: [{ name: 'api_key', type: FormTypeEnum.textInput, label: 'API Key', required: true }],
      }

      // Act
      render(<Card item={configurableItem} />)
      fireEvent.click(screen.getByText(/dataSource.configure/))

      // Find the add API key button and click it
      fireEvent.click(screen.getByText('Add API Key'))

      // Assert
      expectAuthUpdated()
    })
  })
})
