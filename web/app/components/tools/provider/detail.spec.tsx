import type { Collection } from '../types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollectionType } from '../types'
import ProviderDetail from './detail'

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'createTool.editAction': 'Edit',
        'openInStudio': 'Open in Studio',
        'auth.authorized': 'Authorized',
        'auth.unauthorized': 'Set up credentials',
        'auth.setup': 'SETUP REQUIRED',
        'createTool.deleteToolConfirmTitle': 'Delete Tool',
        'createTool.deleteToolConfirmContent': 'Are you sure?',
        'createTool.toolInput.title': 'Tool Input',
        'api.actionSuccess': 'Action succeeded',
      }
      if (key === 'detailPanel.actionNum')
        return `${opts?.num} ${opts?.action}`
      if (key === 'includeToolNum')
        return `${opts?.num} ${opts?.action}`
      return map[key] || key
    },
  }),
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

vi.mock('@/i18n-config/language', () => ({
  getLanguage: () => 'en_US',
}))

// Mock contexts
const mockIsCurrentWorkspaceManager = vi.fn(() => true)
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: mockIsCurrentWorkspaceManager(),
  }),
}))

const mockSetShowModelModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowModelModal: mockSetShowModelModal,
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    modelProviders: [
      { provider: 'model-collection-id', name: 'TestModel' },
    ],
  }),
}))

// Mock service
const mockFetchBuiltInToolList = vi.fn().mockResolvedValue([])
const mockFetchCustomToolList = vi.fn().mockResolvedValue([])
const mockFetchModelToolList = vi.fn().mockResolvedValue([])
const mockFetchCustomCollection = vi.fn().mockResolvedValue({
  credentials: { auth_type: 'none' },
})
const mockFetchWorkflowToolDetail = vi.fn().mockResolvedValue({
  workflow_app_id: 'wf-123',
  workflow_tool_id: 'wt-456',
  tool: { parameters: [], labels: [] },
})
const mockUpdateBuiltInToolCredential = vi.fn().mockResolvedValue({})
const mockRemoveBuiltInToolCredential = vi.fn().mockResolvedValue({})
const mockUpdateCustomCollection = vi.fn().mockResolvedValue({})
const mockRemoveCustomCollection = vi.fn().mockResolvedValue({})
const mockDeleteWorkflowTool = vi.fn().mockResolvedValue({})
const mockSaveWorkflowToolProvider = vi.fn().mockResolvedValue({})

vi.mock('@/service/tools', () => ({
  fetchBuiltInToolList: (...args: unknown[]) => mockFetchBuiltInToolList(...args),
  fetchCustomToolList: (...args: unknown[]) => mockFetchCustomToolList(...args),
  fetchModelToolList: (...args: unknown[]) => mockFetchModelToolList(...args),
  fetchCustomCollection: (...args: unknown[]) => mockFetchCustomCollection(...args),
  fetchWorkflowToolDetail: (...args: unknown[]) => mockFetchWorkflowToolDetail(...args),
  updateBuiltInToolCredential: (...args: unknown[]) => mockUpdateBuiltInToolCredential(...args),
  removeBuiltInToolCredential: (...args: unknown[]) => mockRemoveBuiltInToolCredential(...args),
  updateCustomCollection: (...args: unknown[]) => mockUpdateCustomCollection(...args),
  removeCustomCollection: (...args: unknown[]) => mockRemoveCustomCollection(...args),
  deleteWorkflowTool: (...args: unknown[]) => mockDeleteWorkflowTool(...args),
  saveWorkflowToolProvider: (...args: unknown[]) => mockSaveWorkflowToolProvider(...args),
}))

vi.mock('@/service/use-tools', () => ({
  useInvalidateAllWorkflowTools: () => vi.fn(),
}))

vi.mock('@/utils/var', () => ({
  basePath: '',
}))

// Mock child components
vi.mock('@/app/components/base/drawer', () => ({
  default: ({ children, isOpen }: { children: React.ReactNode, isOpen: boolean }) =>
    isOpen ? <div data-testid="drawer">{children}</div> : null,
}))

vi.mock('@/app/components/base/action-button', () => ({
  default: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => (
    <button data-testid="action-button" onClick={onClick}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, disabled, variant }: { children: React.ReactNode, onClick?: () => void, disabled?: boolean, variant?: string }) => (
    <button data-testid={`button-${variant || 'default'}`} onClick={onClick} disabled={disabled}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/confirm', () => ({
  default: ({ isShow, onConfirm, onCancel, title }: { isShow: boolean, onConfirm: () => void, onCancel: () => void, title: string }) =>
    isShow
      ? (
          <div data-testid="confirm-dialog">
            <span>{title}</span>
            <button data-testid="confirm-btn" onClick={onConfirm}>Confirm</button>
            <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
          </div>
        )
      : null,
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading">Loading...</div>,
}))

vi.mock('@/app/components/base/toast', () => ({
  default: { notify: vi.fn() },
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: () => <span data-testid="indicator" />,
}))

vi.mock('@/app/components/plugins/card/base/card-icon', () => ({
  default: () => <span data-testid="card-icon" />,
}))

vi.mock('@/app/components/plugins/card/base/description', () => ({
  default: ({ text }: { text: string }) => <div data-testid="description">{text}</div>,
}))

vi.mock('@/app/components/plugins/card/base/org-info', () => ({
  default: ({ orgName }: { orgName: string }) => <span data-testid="org-info">{orgName}</span>,
}))

vi.mock('@/app/components/plugins/card/base/title', () => ({
  default: ({ title }: { title: string }) => <span data-testid="title">{title}</span>,
}))

vi.mock('./tool-item', () => ({
  default: ({ tool }: { tool: { name: string } }) => <div data-testid={`tool-${tool.name}`}>{tool.name}</div>,
}))

vi.mock('@/app/components/tools/edit-custom-collection-modal', () => ({
  default: ({ onHide, onEdit, onRemove }: { onHide: () => void, onEdit: (data: unknown) => void, onRemove: () => void }) => (
    <div data-testid="edit-custom-modal">
      <button data-testid="edit-save" onClick={() => onEdit({ labels: ['test'] })}>Save</button>
      <button data-testid="edit-remove" onClick={onRemove}>Remove</button>
      <button data-testid="edit-close" onClick={onHide}>Close</button>
    </div>
  ),
}))

vi.mock('@/app/components/tools/setting/build-in/config-credentials', () => ({
  default: ({ onCancel, onSaved, onRemove }: { onCancel: () => void, onSaved: (val: Record<string, string>) => Promise<void>, onRemove: () => Promise<void> }) => (
    <div data-testid="config-credential">
      <button data-testid="credential-save" onClick={() => onSaved({ key: 'val' })}>Save</button>
      <button data-testid="credential-remove" onClick={onRemove}>Remove</button>
      <button data-testid="credential-cancel" onClick={onCancel}>Cancel</button>
    </div>
  ),
}))

vi.mock('@/app/components/tools/workflow-tool', () => ({
  default: ({ onHide, onSave, onRemove }: { onHide: () => void, onSave: (data: unknown) => void, onRemove: () => void }) => (
    <div data-testid="workflow-tool-modal">
      <button data-testid="wf-save" onClick={() => onSave({ name: 'test' })}>Save</button>
      <button data-testid="wf-remove" onClick={onRemove}>Remove</button>
      <button data-testid="wf-close" onClick={onHide}>Close</button>
    </div>
  ),
}))

// Shared mock collection factory
const createMockCollection = (overrides?: Partial<Collection>): Collection => ({
  id: 'test-id',
  name: 'test-collection',
  author: 'Test Author',
  description: { en_US: 'A test collection', zh_Hans: '测试集合' },
  icon: 'icon-url',
  label: { en_US: 'Test Collection', zh_Hans: '测试集合' },
  type: CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: ['search'],
  ...overrides,
})

describe('ProviderDetail', () => {
  const mockOnHide = vi.fn()
  const mockOnRefreshData = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchBuiltInToolList.mockResolvedValue([
      { name: 'tool-1', label: { en_US: 'Tool 1' }, description: { en_US: 'desc' }, parameters: [], labels: [], author: '', output_schema: {} },
      { name: 'tool-2', label: { en_US: 'Tool 2' }, description: { en_US: 'desc' }, parameters: [], labels: [], author: '', output_schema: {} },
    ])
    mockFetchCustomToolList.mockResolvedValue([])
    mockFetchModelToolList.mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
  })

  // ─── Rendering Tests ──────────────────────────────────────────────
  describe('Rendering', () => {
    it('renders title, org info and description for a builtIn collection', async () => {
      render(
        <ProviderDetail
          collection={createMockCollection()}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      expect(screen.getByTestId('title')).toHaveTextContent('Test Collection')
      expect(screen.getByTestId('org-info')).toHaveTextContent('Test Author')
      expect(screen.getByTestId('description')).toHaveTextContent('A test collection')
    })

    it('shows loading state initially', () => {
      render(
        <ProviderDetail
          collection={createMockCollection()}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      expect(screen.getByTestId('loading')).toBeInTheDocument()
    })

    it('renders tool list after loading for builtIn type', async () => {
      render(
        <ProviderDetail
          collection={createMockCollection()}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(screen.getByTestId('tool-tool-1')).toBeInTheDocument()
        expect(screen.getByTestId('tool-tool-2')).toBeInTheDocument()
      })
    })

    it('hides description when description is empty', () => {
      render(
        <ProviderDetail
          collection={createMockCollection({ description: { en_US: '', zh_Hans: '' } })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      expect(screen.queryByTestId('description')).not.toBeInTheDocument()
    })
  })

  // ─── BuiltIn Collection Auth ──────────────────────────────────────
  describe('BuiltIn Collection Auth', () => {
    it('shows "Set up credentials" button when not authorized and allow_delete', async () => {
      render(
        <ProviderDetail
          collection={createMockCollection({ allow_delete: true, is_team_authorization: false })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(screen.getByText('Set up credentials')).toBeInTheDocument()
      })
    })

    it('shows "Authorized" button when authorized and allow_delete', async () => {
      render(
        <ProviderDetail
          collection={createMockCollection({ allow_delete: true, is_team_authorization: true })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(screen.getByText('Authorized')).toBeInTheDocument()
      })
    })
  })

  // ─── Custom Collection ────────────────────────────────────────────
  describe('Custom Collection', () => {
    it('fetches custom collection and shows edit button', async () => {
      mockFetchCustomCollection.mockResolvedValue({
        credentials: { auth_type: 'none' },
      })
      render(
        <ProviderDetail
          collection={createMockCollection({ type: CollectionType.custom })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(mockFetchCustomCollection).toHaveBeenCalledWith('test-collection')
      })
      await waitFor(() => {
        expect(screen.getByText('Edit')).toBeInTheDocument()
      })
    })
  })

  // ─── Workflow Collection ──────────────────────────────────────────
  describe('Workflow Collection', () => {
    it('fetches workflow tool detail and shows workflow buttons', async () => {
      render(
        <ProviderDetail
          collection={createMockCollection({ type: CollectionType.workflow })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(mockFetchWorkflowToolDetail).toHaveBeenCalledWith('test-id')
      })
      await waitFor(() => {
        expect(screen.getByText('Open in Studio')).toBeInTheDocument()
        expect(screen.getByText('Edit')).toBeInTheDocument()
      })
    })
  })

  // ─── Model Collection ─────────────────────────────────────────────
  describe('Model Collection', () => {
    it('opens model modal when clicking auth button for model type', async () => {
      mockFetchModelToolList.mockResolvedValue([
        { name: 'model-tool-1', label: { en_US: 'MT1' }, description: { en_US: '' }, parameters: [], labels: [], author: '', output_schema: {} },
      ])
      render(
        <ProviderDetail
          collection={createMockCollection({
            id: 'model-collection-id',
            type: CollectionType.model,
            is_team_authorization: false,
            allow_delete: true,
          })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(screen.getByText('Set up credentials')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('Set up credentials'))
      expect(mockSetShowModelModal).toHaveBeenCalled()
    })
  })

  // ─── Close Action ─────────────────────────────────────────────────
  describe('Close Action', () => {
    it('calls onHide when close button is clicked', () => {
      render(
        <ProviderDetail
          collection={createMockCollection()}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      fireEvent.click(screen.getByTestId('action-button'))
      expect(mockOnHide).toHaveBeenCalled()
    })
  })

  // ─── Fetch by Type ────────────────────────────────────────────────
  describe('API calls by collection type', () => {
    it('calls fetchBuiltInToolList for builtIn type', async () => {
      render(
        <ProviderDetail
          collection={createMockCollection({ type: CollectionType.builtIn })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(mockFetchBuiltInToolList).toHaveBeenCalledWith('test-collection')
      })
    })

    it('calls fetchModelToolList for model type', async () => {
      render(
        <ProviderDetail
          collection={createMockCollection({ type: CollectionType.model })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(mockFetchModelToolList).toHaveBeenCalledWith('test-collection')
      })
    })

    it('calls fetchCustomToolList for custom type', async () => {
      render(
        <ProviderDetail
          collection={createMockCollection({ type: CollectionType.custom })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(mockFetchCustomToolList).toHaveBeenCalledWith('test-collection')
      })
    })
  })
})
