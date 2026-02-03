import type { DataSourceAuth, DataSourceCredential } from './types'
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import Card from './card'

// Hoist mocks to ensure they are available for vi.mock calls
const {
  mockHandleEdit,
  mockHandleRemove,
  mockHandleRename,
  mockHandleSetDefault,
  mockOpenConfirm,
  mockHandleConfirm,
  mockSetEditValues,
  mockCloseConfirm,
  mockHandleAuthUpdate,
  mockMutateAsync,
  mockOpenOAuthPopup,
  mockUsePluginAuthAction,
} = vi.hoisted(() => {
  return {
    mockHandleEdit: vi.fn(),
    mockHandleRemove: vi.fn(),
    mockHandleRename: vi.fn(),
    mockHandleSetDefault: vi.fn(),
    mockOpenConfirm: vi.fn(),
    mockHandleConfirm: vi.fn(),
    mockSetEditValues: vi.fn(),
    mockCloseConfirm: vi.fn(),
    mockHandleAuthUpdate: vi.fn(),
    mockMutateAsync: vi.fn(),
    mockOpenOAuthPopup: vi.fn(),
    mockUsePluginAuthAction: vi.fn(),
  }
})

// Mocks
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (obj: string | Record<string, string>) => (typeof obj === 'string' ? obj : obj?.en || ''),
}))

vi.mock('@/app/components/base/confirm', () => ({
  default: ({ onConfirm, onCancel, title }: { onConfirm: () => void, onCancel: () => void, title: string }) => (
    <div data-testid="confirm-modal">
      <span>{title}</span>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/plugin-auth', () => ({
  ApiKeyModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="api-key-modal">
      <button onClick={onClose}>Close</button>
    </div>
  ),
  usePluginAuthAction: mockUsePluginAuthAction,
  AuthCategory: { datasource: 'datasource' },
}))

vi.mock('./configure', () => ({
  default: () => <button>Configure</button>,
}))

vi.mock('./item', () => ({
  default: ({ credentialItem, onAction }: { credentialItem: DataSourceCredential, onAction: (type: string, item: unknown, payload?: unknown) => void }) => (
    <div data-testid={`item-${credentialItem.id}`}>
      {credentialItem.name}
      <button onClick={() => onAction('edit', credentialItem)}>Edit</button>
      <button onClick={() => onAction('delete', credentialItem)}>Delete</button>
      <button onClick={() => onAction('setDefault', credentialItem)}>SetDefault</button>
      <button onClick={() => onAction('rename', credentialItem, { name: 'new name' })}>Rename</button>
      <button onClick={() => onAction('change', credentialItem)}>Change</button>
    </div>
  ),
}))

vi.mock('./hooks', () => ({
  useDataSourceAuthUpdate: () => ({ handleAuthUpdate: mockHandleAuthUpdate }),
}))

vi.mock('@/service/use-datasource', () => ({
  useGetDataSourceOAuthUrl: () => ({ mutateAsync: mockMutateAsync }),
}))

vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: mockOpenOAuthPopup,
}))

describe('Card Component', () => {
  const mockItem: DataSourceAuth = {
    plugin_id: 'plugin-1',
    plugin_unique_identifier: 'plugin-unique-1',
    provider: 'provider-1',
    name: 'provider-1',
    label: { en: 'Provider 1', en_US: 'Provider 1', zh_Hans: 'Provider 1' },
    description: { en: 'Description', en_US: 'Description', zh_Hans: 'Description' },
    author: 'Author',
    icon: 'icon.png',
    credentials_list: [],
    credential_schema: [],
  }

  const defaultAuthActionReturn = {
    deleteCredentialId: null,
    doingAction: false,
    handleConfirm: mockHandleConfirm,
    handleEdit: mockHandleEdit,
    handleRemove: mockHandleRemove,
    handleRename: mockHandleRename,
    handleSetDefault: mockHandleSetDefault,
    editValues: null,
    setEditValues: mockSetEditValues,
    openConfirm: mockOpenConfirm,
    closeConfirm: mockCloseConfirm,
    pendingOperationCredentialId: { current: null },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePluginAuthAction.mockReturnValue(defaultAuthActionReturn)
    mockMutateAsync.mockResolvedValue({ authorization_url: 'http://auth-url.com' })
  })

  it('renders card info correctly', () => {
    render(<Card item={mockItem} />)
    expect(screen.getByText('Provider 1')).toBeInTheDocument()
    expect(screen.getByText(/Author/)).toBeInTheDocument()
    expect(screen.getByText('auth.emptyAuth')).toBeInTheDocument()
  })

  it('renders items when credentials exist', () => {
    const itemWithCreds: DataSourceAuth = {
      ...mockItem,
      credentials_list: [{
        id: '1',
        name: 'Cred 1',
        credential: {},
        type: CredentialTypeEnum.API_KEY,
        is_default: false,
        avatar_url: '',
      }],
    }
    render(<Card item={itemWithCreds} />)
    expect(screen.queryByText('auth.emptyAuth')).not.toBeInTheDocument()
    expect(screen.getByTestId('item-1')).toBeInTheDocument()
  })

  it('handles edit action', () => {
    const itemWithCreds: DataSourceAuth = {
      ...mockItem,
      credentials_list: [{
        id: '1',
        name: 'Cred 1',
        credential: {},
        type: CredentialTypeEnum.API_KEY,
        is_default: false,
        avatar_url: '',
      }],
    }
    render(<Card item={itemWithCreds} />)
    fireEvent.click(screen.getByText('Edit'))

    expect(mockHandleEdit).toHaveBeenCalled()
  })

  it('handles delete action', () => {
    const itemWithCreds: DataSourceAuth = {
      ...mockItem,
      credentials_list: [{
        id: '1',
        name: 'Cred 1',
        credential: {},
        type: CredentialTypeEnum.API_KEY,
        is_default: false,
        avatar_url: '',
      }],
    }
    render(<Card item={itemWithCreds} />)
    fireEvent.click(screen.getByText('Delete'))
    expect(mockOpenConfirm).toHaveBeenCalledWith('1')
  })

  it('handles set default action', () => {
    const itemWithCreds: DataSourceAuth = {
      ...mockItem,
      credentials_list: [{
        id: '1',
        name: 'Cred 1',
        credential: {},
        type: CredentialTypeEnum.API_KEY,
        is_default: false,
        avatar_url: '',
      }],
    }
    render(<Card item={itemWithCreds} />)
    fireEvent.click(screen.getByText('SetDefault'))
    expect(mockHandleSetDefault).toHaveBeenCalledWith('1')
  })

  it('handles rename action', () => {
    const itemWithCreds: DataSourceAuth = {
      ...mockItem,
      credentials_list: [{
        id: '1',
        name: 'Cred 1',
        credential: {},
        type: CredentialTypeEnum.API_KEY,
        is_default: false,
        avatar_url: '',
      }],
    }
    render(<Card item={itemWithCreds} />)
    fireEvent.click(screen.getByText('Rename'))
    expect(mockHandleRename).toHaveBeenCalledWith({ name: 'new name' })
  })

  it('handles change action (OAuth)', async () => {
    const itemWithCreds: DataSourceAuth = {
      ...mockItem,
      credentials_list: [{
        id: '1',
        name: 'Cred 1',
        credential: {},
        type: CredentialTypeEnum.OAUTH2,
        is_default: false,
        avatar_url: '',
      }],
    }
    render(<Card item={itemWithCreds} />)
    fireEvent.click(screen.getByText('Change'))

    // It should call mutateAsync and then openOAuthPopup
    expect(mockMutateAsync).toHaveBeenCalledWith('1')
    // Wait for the chain to complete if needed
    // Since handleOAuth is async, we need to wait
    await vi.waitFor(() => {
      expect(mockOpenOAuthPopup).toHaveBeenCalledWith(
        'http://auth-url.com',
        mockHandleAuthUpdate,
      )
    })
  })

  it('does not open OAuth popup if authorization_url is missing', async () => {
    mockMutateAsync.mockResolvedValue({})

    const itemWithCreds: DataSourceAuth = {
      ...mockItem,
      credentials_list: [{
        id: '1',
        name: 'Cred 1',
        credential: {},
        type: CredentialTypeEnum.OAUTH2,
        is_default: false,
        avatar_url: '',
      }],
    }
    render(<Card item={itemWithCreds} />)
    fireEvent.click(screen.getByText('Change'))

    expect(mockMutateAsync).toHaveBeenCalledWith('1')

    // Wait for promise resolution
    await vi.waitFor(() => {
      expect(mockOpenOAuthPopup).not.toHaveBeenCalled()
    })
  })

  it('renders Confirm modal when deleteCredentialId is set', () => {
    mockUsePluginAuthAction.mockReturnValue({
      ...defaultAuthActionReturn,
      deleteCredentialId: '1',
    })

    render(<Card item={mockItem} />)
    expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()

    // Test confirm interaction
    fireEvent.click(screen.getByText('Confirm'))
    expect(mockHandleConfirm).toHaveBeenCalled()

    // Test cancel interaction
    fireEvent.click(screen.getByText('Cancel'))
    expect(mockCloseConfirm).toHaveBeenCalled()
  })

  it('renders ApiKeyModal when editValues is set', () => {
    mockUsePluginAuthAction.mockReturnValue({
      ...defaultAuthActionReturn,
      editValues: { some: 'value' },
    })

    render(<Card item={mockItem} />)
    expect(screen.getByTestId('api-key-modal')).toBeInTheDocument()

    // Test close interaction
    fireEvent.click(screen.getByText('Close'))
    expect(mockSetEditValues).toHaveBeenCalledWith(null)
  })
})
