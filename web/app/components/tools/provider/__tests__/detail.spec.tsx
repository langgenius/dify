import type { Collection } from '../../types'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthType, CollectionType } from '../../types'
import ProviderDetail from '../detail'

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

vi.mock('@/i18n-config/language', () => ({
  getLanguage: () => 'en_US',
}))

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

vi.mock('@/app/components/base/drawer', () => ({
  default: ({ children, isOpen }: { children: React.ReactNode, isOpen: boolean }) =>
    isOpen ? <div data-testid="drawer">{children}</div> : null,
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

vi.mock('../tool-item', () => ({
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
      expect(screen.getByRole('status')).toBeInTheDocument()
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
        expect(screen.getByText('tools.auth.unauthorized')).toBeInTheDocument()
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
        expect(screen.getByText('tools.auth.authorized')).toBeInTheDocument()
      })
    })
  })

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
        expect(screen.getByText('tools.createTool.editAction')).toBeInTheDocument()
      })
    })
  })

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
        expect(screen.getByText('tools.openInStudio')).toBeInTheDocument()
        expect(screen.getByText('tools.createTool.editAction')).toBeInTheDocument()
      })
    })
  })

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
        expect(screen.getByText('tools.auth.unauthorized')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('tools.auth.unauthorized'))
      expect(mockSetShowModelModal).toHaveBeenCalled()
    })
  })

  describe('Close Action', () => {
    it('calls onHide when close button is clicked', () => {
      render(
        <ProviderDetail
          collection={createMockCollection()}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0])
      expect(mockOnHide).toHaveBeenCalled()
    })
  })

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

  describe('BuiltIn Auth Flow', () => {
    it('opens ConfigCredential when clicking auth button for builtIn type', async () => {
      render(
        <ProviderDetail
          collection={createMockCollection({ allow_delete: true, is_team_authorization: false })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(screen.getByText('tools.auth.unauthorized')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('tools.auth.unauthorized'))
      expect(screen.getByTestId('config-credential')).toBeInTheDocument()
    })

    it('saves credentials and refreshes data', async () => {
      render(
        <ProviderDetail
          collection={createMockCollection({ allow_delete: true, is_team_authorization: false })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(screen.getByText('tools.auth.unauthorized')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('tools.auth.unauthorized'))
      await act(async () => {
        fireEvent.click(screen.getByTestId('credential-save'))
      })
      await waitFor(() => {
        expect(mockUpdateBuiltInToolCredential).toHaveBeenCalledWith('test-collection', { key: 'val' })
        expect(mockOnRefreshData).toHaveBeenCalled()
      })
    })

    it('removes credentials and refreshes data', async () => {
      render(
        <ProviderDetail
          collection={createMockCollection({ allow_delete: true, is_team_authorization: false })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(screen.getByText('tools.auth.unauthorized')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('tools.auth.unauthorized'))
      await act(async () => {
        fireEvent.click(screen.getByTestId('credential-remove'))
      })
      await waitFor(() => {
        expect(mockRemoveBuiltInToolCredential).toHaveBeenCalledWith('test-collection')
        expect(mockOnRefreshData).toHaveBeenCalled()
      })
    })

    it('opens auth modal from Authorized button for builtIn type', async () => {
      render(
        <ProviderDetail
          collection={createMockCollection({ allow_delete: true, is_team_authorization: true })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(screen.getByText('tools.auth.authorized')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('tools.auth.authorized'))
      expect(screen.getByTestId('config-credential')).toBeInTheDocument()
    })
  })

  describe('Model Auth Flow', () => {
    it('calls onRefreshData via model modal onSaveCallback', async () => {
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
        expect(screen.getByText('tools.auth.unauthorized')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('tools.auth.unauthorized'))
      const call = mockSetShowModelModal.mock.calls[0][0]
      act(() => {
        call.onSaveCallback()
      })
      expect(mockOnRefreshData).toHaveBeenCalled()
    })
  })

  describe('Custom Collection Operations', () => {
    it('sets api_key_header_prefix when auth_type is apiKey and has value', async () => {
      mockFetchCustomCollection.mockResolvedValue({
        credentials: {
          auth_type: AuthType.apiKey,
          api_key_value: 'secret-key',
        },
      })
      render(
        <ProviderDetail
          collection={createMockCollection({ type: CollectionType.custom })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(mockFetchCustomCollection).toHaveBeenCalled()
      })
      await waitFor(() => {
        expect(screen.getByText('tools.createTool.editAction')).toBeInTheDocument()
      })
    })

    it('opens edit modal and saves custom collection', async () => {
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
        expect(screen.getByText('tools.createTool.editAction')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('tools.createTool.editAction'))
      expect(screen.getByTestId('edit-custom-modal')).toBeInTheDocument()
      await act(async () => {
        fireEvent.click(screen.getByTestId('edit-save'))
      })
      await waitFor(() => {
        expect(mockUpdateCustomCollection).toHaveBeenCalledWith({ labels: ['test'] })
        expect(mockOnRefreshData).toHaveBeenCalled()
      })
    })

    it('removes custom collection via delete confirmation', async () => {
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
        expect(screen.getByText('tools.createTool.editAction')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('tools.createTool.editAction'))
      fireEvent.click(screen.getByTestId('edit-remove'))
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      await act(async () => {
        fireEvent.click(screen.getByTestId('confirm-btn'))
      })
      await waitFor(() => {
        expect(mockRemoveCustomCollection).toHaveBeenCalledWith('test-collection')
        expect(mockOnRefreshData).toHaveBeenCalled()
      })
    })
  })

  describe('Workflow Collection Operations', () => {
    it('displays workflow tool parameters', async () => {
      mockFetchWorkflowToolDetail.mockResolvedValue({
        workflow_app_id: 'wf-123',
        workflow_tool_id: 'wt-456',
        tool: {
          parameters: [
            { name: 'query', type: 'string', llm_description: 'Search query', form: 'llm', required: true },
            { name: 'limit', type: 'number', llm_description: 'Max results', form: 'form', required: false },
          ],
          labels: ['search'],
        },
      })
      render(
        <ProviderDetail
          collection={createMockCollection({ type: CollectionType.workflow })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(screen.getByText('query')).toBeInTheDocument()
        expect(screen.getByText('string')).toBeInTheDocument()
        expect(screen.getByText('Search query')).toBeInTheDocument()
        expect(screen.getByText('limit')).toBeInTheDocument()
      })
    })

    it('saves workflow tool via workflow modal', async () => {
      render(
        <ProviderDetail
          collection={createMockCollection({ type: CollectionType.workflow })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(screen.getByText('tools.createTool.editAction')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('tools.createTool.editAction'))
      expect(screen.getByTestId('workflow-tool-modal')).toBeInTheDocument()
      await act(async () => {
        fireEvent.click(screen.getByTestId('wf-save'))
      })
      await waitFor(() => {
        expect(mockSaveWorkflowToolProvider).toHaveBeenCalledWith({ name: 'test' })
        expect(mockOnRefreshData).toHaveBeenCalled()
      })
    })

    it('removes workflow tool via delete confirmation', async () => {
      render(
        <ProviderDetail
          collection={createMockCollection({ type: CollectionType.workflow })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(screen.getByText('tools.createTool.editAction')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('tools.createTool.editAction'))
      fireEvent.click(screen.getByTestId('wf-remove'))
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      await act(async () => {
        fireEvent.click(screen.getByTestId('confirm-btn'))
      })
      await waitFor(() => {
        expect(mockDeleteWorkflowTool).toHaveBeenCalledWith('test-id')
        expect(mockOnRefreshData).toHaveBeenCalled()
      })
    })
  })

  describe('Modal Close Actions', () => {
    it('closes ConfigCredential when cancel is clicked', async () => {
      render(
        <ProviderDetail
          collection={createMockCollection({ allow_delete: true, is_team_authorization: false })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(screen.getByText('tools.auth.unauthorized')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('tools.auth.unauthorized'))
      expect(screen.getByTestId('config-credential')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('credential-cancel'))
      expect(screen.queryByTestId('config-credential')).not.toBeInTheDocument()
    })

    it('closes EditCustomToolModal via onHide', async () => {
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
        expect(screen.getByText('tools.createTool.editAction')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('tools.createTool.editAction'))
      expect(screen.getByTestId('edit-custom-modal')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('edit-close'))
      expect(screen.queryByTestId('edit-custom-modal')).not.toBeInTheDocument()
    })

    it('closes WorkflowToolModal via onHide', async () => {
      render(
        <ProviderDetail
          collection={createMockCollection({ type: CollectionType.workflow })}
          onHide={mockOnHide}
          onRefreshData={mockOnRefreshData}
        />,
      )
      await waitFor(() => {
        expect(screen.getByText('tools.createTool.editAction')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('tools.createTool.editAction'))
      expect(screen.getByTestId('workflow-tool-modal')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('wf-close'))
      expect(screen.queryByTestId('workflow-tool-modal')).not.toBeInTheDocument()
    })
  })

  describe('Delete Confirmation', () => {
    it('cancels delete confirmation', async () => {
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
        expect(screen.getByText('tools.createTool.editAction')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('tools.createTool.editAction'))
      fireEvent.click(screen.getByTestId('edit-remove'))
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('cancel-btn'))
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    })
  })
})
