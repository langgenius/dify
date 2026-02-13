import type { DataSourceAuth, DataSourceCredential } from './types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
 * We use vi.mock to intercept internal modules and provide strictly typed mock implementations.
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
  ApiKeyModal: vi.fn(({ onClose, onUpdate, onRemove, disabled }: { onClose: () => void, onUpdate: () => void, onRemove: () => void, disabled: boolean }) => (
    <div data-testid="mock-api-key-modal" data-disabled={disabled}>
      <button data-testid="modal-close" onClick={onClose}>Close</button>
      <button data-testid="modal-update" onClick={onUpdate}>Update</button>
      <button data-testid="modal-remove" onClick={onRemove}>Remove</button>
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

  /**
   * Factory function to create mock return values for usePluginAuthAction.
   * This ensures all necessary properties are present for the component to function while testing different states.
   */
  const createMockPluginAuthActionReturn = (overrides: Partial<UsePluginAuthActionReturn> = {}): UsePluginAuthActionReturn => ({
    deleteCredentialId: null,
    doingAction: false,
    handleConfirm: vi.fn(),
    handleEdit: vi.fn(),
    handleRemove: vi.fn(),
    handleRename: vi.fn(),
    handleSetDefault: vi.fn(),
    editValues: null,
    setEditValues: vi.fn(),
    openConfirm: vi.fn(),
    closeConfirm: vi.fn(),
    pendingOperationCredentialId: { current: null },
    ...overrides,
  } as unknown as UsePluginAuthActionReturn)

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

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useDataSourceAuthUpdate).mockReturnValue({ handleAuthUpdate: mockHandleAuthUpdate })
    vi.mocked(usePluginAuthAction).mockReturnValue(createMockPluginAuthActionReturn())
    vi.mocked(useRenderI18nObject).mockReturnValue(mockRenderI18nObjectResult as unknown as UseRenderI18nObjectReturn)
    vi.mocked(useGetDataSourceOAuthUrl).mockReturnValue({ mutateAsync: mockGetPluginOAuthUrl } as unknown as UseGetDataSourceOAuthUrlReturn)
  })

  it('should render the card with provided item data and initialize hooks correctly', () => {
    render(<Card item={mockItem} />)
    expect(screen.getByText('Test Label')).toBeInTheDocument()
    expect(screen.getByText(/Test Author/)).toBeInTheDocument()
    expect(screen.getByText(/test-name/)).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('src', 'test-icon-url')
    expect(screen.getByTestId('mock-item-c1')).toBeInTheDocument()

    // Verify hooks were initialized with expected parameters
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
    const emptyItem = { ...mockItem, credentials_list: [] }
    render(<Card item={emptyItem} />)
    // Check for i18n key as mocked in vitest.setup.ts
    expect(screen.getByText(/plugin.auth.emptyAuth/)).toBeInTheDocument()
  })

  it('should handle "edit" action from Item component', () => {
    const mockReturn = createMockPluginAuthActionReturn()
    vi.mocked(usePluginAuthAction).mockReturnValue(mockReturn)
    render(<Card item={mockItem} />)
    fireEvent.click(screen.getByTestId('action-edit-c1'))
    expect(mockReturn.handleEdit).toHaveBeenCalledWith('c1', {
      apiKey: 'key1',
      __name__: 'Credential 1',
      __credential_id__: 'c1',
    })
  })

  it('should handle "delete" action from Item component', () => {
    const mockReturn = createMockPluginAuthActionReturn()
    vi.mocked(usePluginAuthAction).mockReturnValue(mockReturn)
    render(<Card item={mockItem} />)
    fireEvent.click(screen.getByTestId('action-delete-c1'))
    expect(mockReturn.openConfirm).toHaveBeenCalledWith('c1')
  })

  it('should handle "setDefault" action from Item component', () => {
    const mockReturn = createMockPluginAuthActionReturn()
    vi.mocked(usePluginAuthAction).mockReturnValue(mockReturn)
    render(<Card item={mockItem} />)
    fireEvent.click(screen.getByTestId('action-setDefault-c1'))
    expect(mockReturn.handleSetDefault).toHaveBeenCalledWith('c1')
  })

  it('should handle "rename" action from Item component', () => {
    const mockReturn = createMockPluginAuthActionReturn()
    vi.mocked(usePluginAuthAction).mockReturnValue(mockReturn)
    render(<Card item={mockItem} />)
    fireEvent.click(screen.getByTestId('action-rename-c1'))
    expect(mockReturn.handleRename).toHaveBeenCalledWith({ name: 'new name' })
  })

  it('should handle "change" action and trigger OAuth flow with authorization_url', async () => {
    mockGetPluginOAuthUrl.mockResolvedValue({ authorization_url: 'https://oauth.url' })
    render(<Card item={mockItem} />)
    fireEvent.click(screen.getByTestId('action-change-c1'))
    await waitFor(() => {
      expect(mockGetPluginOAuthUrl).toHaveBeenCalledWith('c1')
      expect(openOAuthPopup).toHaveBeenCalledWith('https://oauth.url', mockHandleAuthUpdate)
    })
  })

  it('should handle "change" action but not open popup if authorization_url is missing', async () => {
    mockGetPluginOAuthUrl.mockResolvedValue({ authorization_url: '' })
    render(<Card item={mockItem} />)
    fireEvent.click(screen.getByTestId('action-change-c1'))
    await waitFor(() => {
      expect(mockGetPluginOAuthUrl).toHaveBeenCalledWith('c1')
      expect(openOAuthPopup).not.toHaveBeenCalled()
    })
  })

  it('should show Confirm dialog when deleteCredentialId is set and handle its actions', () => {
    const mockReturn = createMockPluginAuthActionReturn({ deleteCredentialId: 'c1', doingAction: true })
    vi.mocked(usePluginAuthAction).mockReturnValue(mockReturn)
    render(<Card item={mockItem} />)
    expect(screen.getByTestId('mock-confirm')).toBeInTheDocument()
    expect(screen.getByTestId('mock-confirm')).toHaveAttribute('data-disabled', 'true')

    fireEvent.click(screen.getByTestId('confirm-cancel'))
    expect(mockReturn.closeConfirm).toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('confirm-confirm'))
    expect(mockReturn.handleConfirm).toHaveBeenCalled()
  })

  it('should show ApiKeyModal when editValues is set and handle its actions while respecting disabled combinations', () => {
    const mockReturn = createMockPluginAuthActionReturn({ editValues: { some: 'value' }, doingAction: true })
    vi.mocked(usePluginAuthAction).mockReturnValue(mockReturn)
    const { rerender } = render(<Card item={mockItem} disabled={false} />)
    expect(screen.getByTestId('mock-api-key-modal')).toBeInTheDocument()
    // disabled={disabled || doingAction} -> false || true = true
    expect(screen.getByTestId('mock-api-key-modal')).toHaveAttribute('data-disabled', 'true')

    fireEvent.click(screen.getByTestId('modal-close'))
    expect(mockReturn.setEditValues).toHaveBeenCalledWith(null)
    expect(mockReturn.pendingOperationCredentialId.current).toBeNull()

    fireEvent.click(screen.getByTestId('modal-remove'))
    expect(mockReturn.handleRemove).toHaveBeenCalled()

    // Test with disabled prop true -> true || true = true
    rerender(<Card item={mockItem} disabled={true} />)
    expect(screen.getByTestId('mock-api-key-modal')).toHaveAttribute('data-disabled', 'true')

    // Test with doingAction false and disabled false -> false || false = false
    const mockReturnNotDoing = createMockPluginAuthActionReturn({ editValues: { some: 'value' }, doingAction: false })
    vi.mocked(usePluginAuthAction).mockReturnValue(mockReturnNotDoing)
    rerender(<Card item={mockItem} disabled={false} />)
    expect(screen.getByTestId('mock-api-key-modal')).toHaveAttribute('data-disabled', 'false')
  })

  it('should handle "unknown" action from Item component without side effects', () => {
    const mockReturn = createMockPluginAuthActionReturn()
    vi.mocked(usePluginAuthAction).mockReturnValue(mockReturn)
    render(<Card item={mockItem} />)
    fireEvent.click(screen.getByTestId('action-unknown-c1'))

    expect(mockReturn.handleEdit).not.toHaveBeenCalled()
    expect(mockReturn.openConfirm).not.toHaveBeenCalled()
    expect(mockReturn.handleSetDefault).not.toHaveBeenCalled()
    expect(mockReturn.handleRename).not.toHaveBeenCalled()
    expect(mockGetPluginOAuthUrl).not.toHaveBeenCalled()
  })

  it('should call handleAuthUpdate when Configure component triggers update', () => {
    render(<Card item={mockItem} />)
    fireEvent.click(screen.getByTestId('mock-configure'))
    expect(mockHandleAuthUpdate).toHaveBeenCalled()
  })
})
