import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConfigCredential from './config-credentials'

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'auth.setupModalTitle': 'Set up credentials',
        'auth.setupModalTitleDescription': 'Configure your credentials',
        'operation.cancel': 'Cancel',
        'operation.save': 'Save',
        'operation.remove': 'Remove',
        'howToGet': 'How to get',
      }
      if (key === 'errorMsg.fieldRequired')
        return `${opts?.field} is required`
      return map[key] || key
    },
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))

// Mock services
const mockFetchCredentialSchema = vi.fn()
const mockFetchCredentialValue = vi.fn()

vi.mock('@/service/tools', () => ({
  fetchBuiltInToolCredentialSchema: (...args: unknown[]) => mockFetchCredentialSchema(...args),
  fetchBuiltInToolCredential: (...args: unknown[]) => mockFetchCredentialValue(...args),
}))

// Mock to-form-schema utils
vi.mock('../../utils/to-form-schema', () => ({
  toolCredentialToFormSchemas: (schemas: unknown[]) => (schemas as Record<string, unknown>[]).map(s => ({
    ...s,
    variable: s.name,
    show_on: [],
  })),
  addDefaultValue: (value: Record<string, unknown>, _schemas: unknown[]) => ({ ...value }),
}))

// Mock child components
vi.mock('@/app/components/base/drawer-plus', () => ({
  default: ({ body, title, onHide }: { body: React.ReactNode, title: string, onHide: () => void }) => (
    <div data-testid="drawer">
      <span data-testid="drawer-title">{title}</span>
      <button data-testid="drawer-close" onClick={onHide}>Close</button>
      {body}
    </div>
  ),
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading">Loading...</div>,
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, disabled, loading, variant }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    loading?: boolean
    variant?: string
  }) => (
    <button
      data-testid={`btn-${variant || 'default'}`}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {children}
    </button>
  ),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: { notify: vi.fn() },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-modal/Form', () => ({
  default: ({ value, onChange }: { value: Record<string, string>, onChange: (v: Record<string, string>) => void }) => (
    <div data-testid="form">
      <input
        data-testid="form-input"
        value={value.api_key || ''}
        onChange={e => onChange({ ...value, api_key: e.target.value })}
      />
    </div>
  ),
}))

const createMockCollection = (overrides?: Record<string, unknown>) => ({
  id: 'test-collection',
  name: 'test-tool',
  author: 'Test',
  description: { en_US: 'Test', zh_Hans: '测试' },
  icon: '',
  label: { en_US: 'Test', zh_Hans: '测试' },
  type: 'builtin',
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
  ...overrides,
})

describe('ConfigCredential', () => {
  const mockOnCancel = vi.fn()
  const mockOnSaved = vi.fn().mockResolvedValue(undefined)
  const mockOnRemove = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchCredentialSchema.mockResolvedValue([
      { name: 'api_key', label: { en_US: 'API Key' }, type: 'secret-input', required: true },
    ])
    mockFetchCredentialValue.mockResolvedValue({ api_key: 'sk-existing' })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows loading state initially then renders form', async () => {
    render(
      <ConfigCredential
        collection={createMockCollection() as never}
        onCancel={mockOnCancel}
        onSaved={mockOnSaved}
      />,
    )
    expect(screen.getByTestId('loading')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId('form')).toBeInTheDocument()
    })
  })

  it('renders drawer with correct title', async () => {
    render(
      <ConfigCredential
        collection={createMockCollection() as never}
        onCancel={mockOnCancel}
        onSaved={mockOnSaved}
      />,
    )
    expect(screen.getByTestId('drawer-title')).toHaveTextContent('Set up credentials')
  })

  it('calls onCancel when cancel button is clicked', async () => {
    render(
      <ConfigCredential
        collection={createMockCollection() as never}
        onCancel={mockOnCancel}
        onSaved={mockOnSaved}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('form')).toBeInTheDocument()
    })
    const cancelBtn = screen.getByText('Cancel')
    fireEvent.click(cancelBtn)
    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('calls onSaved with credential values when save is clicked', async () => {
    render(
      <ConfigCredential
        collection={createMockCollection() as never}
        onCancel={mockOnCancel}
        onSaved={mockOnSaved}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('form')).toBeInTheDocument()
    })
    const saveBtn = screen.getByText('Save')
    fireEvent.click(saveBtn)
    await waitFor(() => {
      expect(mockOnSaved).toHaveBeenCalledWith(expect.objectContaining({ api_key: 'sk-existing' }))
    })
  })

  it('shows remove button when team is authorized and isHideRemoveBtn is false', async () => {
    render(
      <ConfigCredential
        collection={createMockCollection({ is_team_authorization: true }) as never}
        onCancel={mockOnCancel}
        onSaved={mockOnSaved}
        onRemove={mockOnRemove}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('form')).toBeInTheDocument()
    })
    expect(screen.getByText('Remove')).toBeInTheDocument()
  })

  it('hides remove button when isHideRemoveBtn is true', async () => {
    render(
      <ConfigCredential
        collection={createMockCollection({ is_team_authorization: true }) as never}
        onCancel={mockOnCancel}
        onSaved={mockOnSaved}
        onRemove={mockOnRemove}
        isHideRemoveBtn
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('form')).toBeInTheDocument()
    })
    expect(screen.queryByText('Remove')).not.toBeInTheDocument()
  })

  it('fetches credential schema for the collection name', async () => {
    render(
      <ConfigCredential
        collection={createMockCollection() as never}
        onCancel={mockOnCancel}
        onSaved={mockOnSaved}
      />,
    )
    await waitFor(() => {
      expect(mockFetchCredentialSchema).toHaveBeenCalledWith('test-tool')
      expect(mockFetchCredentialValue).toHaveBeenCalledWith('test-tool')
    })
  })
})
