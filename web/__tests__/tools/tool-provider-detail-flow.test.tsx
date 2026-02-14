import type { Collection } from '@/app/components/tools/types'
/**
 * Integration Test: Tool Provider Detail Flow
 *
 * Tests the integration between ProviderDetail, ConfigCredential,
 * EditCustomToolModal, WorkflowToolModal, and service APIs.
 * Verifies that different provider types render correctly and
 * handle auth/edit/delete flows.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CollectionType } from '@/app/components/tools/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'auth.authorized': 'Authorized',
        'auth.unauthorized': 'Set up credentials',
        'auth.setup': 'NEEDS SETUP',
        'createTool.editAction': 'Edit',
        'createTool.deleteToolConfirmTitle': 'Delete Tool',
        'createTool.deleteToolConfirmContent': 'Are you sure?',
        'createTool.toolInput.title': 'Tool Input',
        'createTool.toolInput.required': 'Required',
        'openInStudio': 'Open in Studio',
        'api.actionSuccess': 'Action succeeded',
      }
      if (key === 'detailPanel.actionNum')
        return `${opts?.num ?? 0} actions`
      if (key === 'includeToolNum')
        return `${opts?.num ?? 0} actions`
      return map[key] ?? key
    },
  }),
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en',
}))

vi.mock('@/i18n-config/language', () => ({
  getLanguage: () => 'en_US',
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: true,
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
      { provider: 'model-provider-1', name: 'Model Provider 1' },
    ],
  }),
}))

const mockFetchBuiltInToolList = vi.fn().mockResolvedValue([
  { name: 'tool-1', description: { en_US: 'Tool 1' }, parameters: [] },
  { name: 'tool-2', description: { en_US: 'Tool 2' }, parameters: [] },
])
const mockFetchModelToolList = vi.fn().mockResolvedValue([])
const mockFetchCustomToolList = vi.fn().mockResolvedValue([])
const mockFetchCustomCollection = vi.fn().mockResolvedValue({
  credentials: { auth_type: 'none' },
  schema: '',
  schema_type: 'openapi',
})
const mockFetchWorkflowToolDetail = vi.fn().mockResolvedValue({
  workflow_app_id: 'app-123',
  tool: {
    parameters: [
      { name: 'query', llm_description: 'Search query', form: 'text', required: true, type: 'string' },
    ],
    labels: ['search'],
  },
})
const mockUpdateBuiltInToolCredential = vi.fn().mockResolvedValue({})
const mockRemoveBuiltInToolCredential = vi.fn().mockResolvedValue({})
const mockUpdateCustomCollection = vi.fn().mockResolvedValue({})
const mockRemoveCustomCollection = vi.fn().mockResolvedValue({})
const mockDeleteWorkflowTool = vi.fn().mockResolvedValue({})
const mockSaveWorkflowToolProvider = vi.fn().mockResolvedValue({})

vi.mock('@/service/tools', () => ({
  fetchBuiltInToolList: (...args: unknown[]) => mockFetchBuiltInToolList(...args),
  fetchModelToolList: (...args: unknown[]) => mockFetchModelToolList(...args),
  fetchCustomToolList: (...args: unknown[]) => mockFetchCustomToolList(...args),
  fetchCustomCollection: (...args: unknown[]) => mockFetchCustomCollection(...args),
  fetchWorkflowToolDetail: (...args: unknown[]) => mockFetchWorkflowToolDetail(...args),
  updateBuiltInToolCredential: (...args: unknown[]) => mockUpdateBuiltInToolCredential(...args),
  removeBuiltInToolCredential: (...args: unknown[]) => mockRemoveBuiltInToolCredential(...args),
  updateCustomCollection: (...args: unknown[]) => mockUpdateCustomCollection(...args),
  removeCustomCollection: (...args: unknown[]) => mockRemoveCustomCollection(...args),
  deleteWorkflowTool: (...args: unknown[]) => mockDeleteWorkflowTool(...args),
  saveWorkflowToolProvider: (...args: unknown[]) => mockSaveWorkflowToolProvider(...args),
  fetchBuiltInToolCredential: vi.fn().mockResolvedValue({}),
  fetchBuiltInToolCredentialSchema: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/service/use-tools', () => ({
  useInvalidateAllWorkflowTools: () => vi.fn(),
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/utils/var', () => ({
  basePath: '',
}))

vi.mock('@/app/components/base/drawer', () => ({
  default: ({ isOpen, children, onClose }: { isOpen: boolean, children: React.ReactNode, onClose: () => void }) => (
    isOpen
      ? (
          <div data-testid="drawer">
            {children}
            <button data-testid="drawer-close" onClick={onClose}>Close Drawer</button>
          </div>
        )
      : null
  ),
}))

vi.mock('@/app/components/base/confirm', () => ({
  default: ({ title, isShow, onConfirm, onCancel }: {
    title: string
    content: string
    isShow: boolean
    onConfirm: () => void
    onCancel: () => void
  }) => (
    isShow
      ? (
          <div data-testid="confirm-dialog">
            <span>{title}</span>
            <button data-testid="confirm-ok" onClick={onConfirm}>Confirm</button>
            <button data-testid="confirm-cancel" onClick={onCancel}>Cancel</button>
          </div>
        )
      : null
  ),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: { notify: vi.fn() },
}))

vi.mock('@/app/components/base/icons/src/vender/line/general', () => ({
  LinkExternal02: () => <span data-testid="link-icon" />,
  Settings01: () => <span data-testid="settings-icon" />,
}))

vi.mock('@remixicon/react', () => ({
  RiCloseLine: () => <span data-testid="close-icon" />,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/declarations', () => ({
  ConfigurationMethodEnum: { predefinedModel: 'predefined-model' },
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: ({ color }: { color: string }) => <span data-testid={`indicator-${color}`} />,
}))

vi.mock('@/app/components/plugins/card/base/card-icon', () => ({
  default: ({ src }: { src: string }) => <div data-testid="card-icon" data-src={typeof src === 'string' ? src : 'emoji'} />,
}))

vi.mock('@/app/components/plugins/card/base/description', () => ({
  default: ({ text }: { text: string }) => <div data-testid="description">{text}</div>,
}))

vi.mock('@/app/components/plugins/card/base/org-info', () => ({
  default: ({ orgName, packageName }: { orgName: string, packageName: string }) => (
    <div data-testid="org-info">
      {orgName}
      {' '}
      /
      {' '}
      {packageName}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/card/base/title', () => ({
  default: ({ title }: { title: string }) => <div data-testid="title">{title}</div>,
}))

vi.mock('@/app/components/tools/edit-custom-collection-modal', () => ({
  default: ({ onHide, onEdit, onRemove }: { onHide: () => void, onEdit: (data: unknown) => void, onRemove: () => void, payload: unknown }) => (
    <div data-testid="edit-custom-modal">
      <button data-testid="custom-modal-hide" onClick={onHide}>Hide</button>
      <button data-testid="custom-modal-save" onClick={() => onEdit({ name: 'updated', labels: [] })}>Save</button>
      <button data-testid="custom-modal-remove" onClick={onRemove}>Remove</button>
    </div>
  ),
}))

vi.mock('@/app/components/tools/setting/build-in/config-credentials', () => ({
  default: ({ onCancel, onSaved, onRemove }: { collection: Collection, onCancel: () => void, onSaved: (v: Record<string, unknown>) => void, onRemove: () => void }) => (
    <div data-testid="config-credential">
      <button data-testid="cred-cancel" onClick={onCancel}>Cancel</button>
      <button data-testid="cred-save" onClick={() => onSaved({ api_key: 'test-key' })}>Save</button>
      <button data-testid="cred-remove" onClick={onRemove}>Remove</button>
    </div>
  ),
}))

vi.mock('@/app/components/tools/workflow-tool', () => ({
  default: ({ onHide, onSave, onRemove }: { payload: unknown, onHide: () => void, onSave: (d: unknown) => void, onRemove: () => void }) => (
    <div data-testid="workflow-tool-modal">
      <button data-testid="wf-modal-hide" onClick={onHide}>Hide</button>
      <button data-testid="wf-modal-save" onClick={() => onSave({ name: 'updated-wf' })}>Save</button>
      <button data-testid="wf-modal-remove" onClick={onRemove}>Remove</button>
    </div>
  ),
}))

vi.mock('@/app/components/tools/provider/tool-item', () => ({
  default: ({ tool }: { tool: { name: string } }) => (
    <div data-testid={`tool-item-${tool.name}`}>{tool.name}</div>
  ),
}))

const { default: ProviderDetail } = await import('@/app/components/tools/provider/detail')

const makeCollection = (overrides: Partial<Collection> = {}): Collection => ({
  id: 'test-collection',
  name: 'test_collection',
  author: 'Dify',
  description: { en_US: 'Test collection description', zh_Hans: '测试集合描述' },
  icon: 'https://example.com/icon.png',
  label: { en_US: 'Test Collection', zh_Hans: '测试集合' },
  type: CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
  ...overrides,
})

const mockOnHide = vi.fn()
const mockOnRefreshData = vi.fn()

describe('Tool Provider Detail Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
  })

  describe('Built-in Provider', () => {
    it('renders provider detail with title, author, and description', async () => {
      const collection = makeCollection()
      render(<ProviderDetail collection={collection} onHide={mockOnHide} onRefreshData={mockOnRefreshData} />)

      await waitFor(() => {
        expect(screen.getByTestId('title')).toHaveTextContent('Test Collection')
        expect(screen.getByTestId('org-info')).toHaveTextContent('Dify')
        expect(screen.getByTestId('description')).toHaveTextContent('Test collection description')
      })
    })

    it('loads tool list from API on mount', async () => {
      const collection = makeCollection()
      render(<ProviderDetail collection={collection} onHide={mockOnHide} onRefreshData={mockOnRefreshData} />)

      await waitFor(() => {
        expect(mockFetchBuiltInToolList).toHaveBeenCalledWith('test_collection')
      })

      await waitFor(() => {
        expect(screen.getByTestId('tool-item-tool-1')).toBeInTheDocument()
        expect(screen.getByTestId('tool-item-tool-2')).toBeInTheDocument()
      })
    })

    it('shows "Set up credentials" button when not authorized and needs auth', async () => {
      const collection = makeCollection({
        allow_delete: true,
        is_team_authorization: false,
      })
      render(<ProviderDetail collection={collection} onHide={mockOnHide} onRefreshData={mockOnRefreshData} />)

      await waitFor(() => {
        expect(screen.getByText('Set up credentials')).toBeInTheDocument()
      })
    })

    it('shows "Authorized" button when authorized', async () => {
      const collection = makeCollection({
        allow_delete: true,
        is_team_authorization: true,
      })
      render(<ProviderDetail collection={collection} onHide={mockOnHide} onRefreshData={mockOnRefreshData} />)

      await waitFor(() => {
        expect(screen.getByText('Authorized')).toBeInTheDocument()
        expect(screen.getByTestId('indicator-green')).toBeInTheDocument()
      })
    })

    it('opens ConfigCredential when clicking auth button (built-in type)', async () => {
      const collection = makeCollection({
        allow_delete: true,
        is_team_authorization: false,
      })
      render(<ProviderDetail collection={collection} onHide={mockOnHide} onRefreshData={mockOnRefreshData} />)

      await waitFor(() => {
        expect(screen.getByText('Set up credentials')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Set up credentials'))
      await waitFor(() => {
        expect(screen.getByTestId('config-credential')).toBeInTheDocument()
      })
    })

    it('saves credential and refreshes data', async () => {
      const collection = makeCollection({
        allow_delete: true,
        is_team_authorization: false,
      })
      render(<ProviderDetail collection={collection} onHide={mockOnHide} onRefreshData={mockOnRefreshData} />)

      await waitFor(() => {
        expect(screen.getByText('Set up credentials')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Set up credentials'))
      await waitFor(() => {
        expect(screen.getByTestId('config-credential')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('cred-save'))
      await waitFor(() => {
        expect(mockUpdateBuiltInToolCredential).toHaveBeenCalledWith('test_collection', { api_key: 'test-key' })
        expect(mockOnRefreshData).toHaveBeenCalled()
      })
    })

    it('removes credential and refreshes data', async () => {
      const collection = makeCollection({
        allow_delete: true,
        is_team_authorization: false,
      })
      render(<ProviderDetail collection={collection} onHide={mockOnHide} onRefreshData={mockOnRefreshData} />)

      await waitFor(() => {
        fireEvent.click(screen.getByText('Set up credentials'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('config-credential')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('cred-remove'))
      await waitFor(() => {
        expect(mockRemoveBuiltInToolCredential).toHaveBeenCalledWith('test_collection')
        expect(mockOnRefreshData).toHaveBeenCalled()
      })
    })
  })

  describe('Model Provider', () => {
    it('opens model modal when clicking auth button for model type', async () => {
      const collection = makeCollection({
        id: 'model-provider-1',
        type: CollectionType.model,
        allow_delete: true,
        is_team_authorization: false,
      })
      render(<ProviderDetail collection={collection} onHide={mockOnHide} onRefreshData={mockOnRefreshData} />)

      await waitFor(() => {
        expect(screen.getByText('Set up credentials')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Set up credentials'))
      await waitFor(() => {
        expect(mockSetShowModelModal).toHaveBeenCalledWith(
          expect.objectContaining({
            payload: expect.objectContaining({
              currentProvider: expect.objectContaining({ provider: 'model-provider-1' }),
            }),
          }),
        )
      })
    })
  })

  describe('Custom Provider', () => {
    it('fetches custom collection details and shows edit button', async () => {
      const collection = makeCollection({
        type: CollectionType.custom,
        allow_delete: true,
      })
      render(<ProviderDetail collection={collection} onHide={mockOnHide} onRefreshData={mockOnRefreshData} />)

      await waitFor(() => {
        expect(mockFetchCustomCollection).toHaveBeenCalledWith('test_collection')
      })

      await waitFor(() => {
        expect(screen.getByText('Edit')).toBeInTheDocument()
      })
    })

    it('opens edit modal and saves changes', async () => {
      const collection = makeCollection({
        type: CollectionType.custom,
        allow_delete: true,
      })
      render(<ProviderDetail collection={collection} onHide={mockOnHide} onRefreshData={mockOnRefreshData} />)

      await waitFor(() => {
        expect(screen.getByText('Edit')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Edit'))
      await waitFor(() => {
        expect(screen.getByTestId('edit-custom-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('custom-modal-save'))
      await waitFor(() => {
        expect(mockUpdateCustomCollection).toHaveBeenCalled()
        expect(mockOnRefreshData).toHaveBeenCalled()
      })
    })

    it('shows delete confirmation and removes collection', async () => {
      const collection = makeCollection({
        type: CollectionType.custom,
        allow_delete: true,
      })
      render(<ProviderDetail collection={collection} onHide={mockOnHide} onRefreshData={mockOnRefreshData} />)

      await waitFor(() => {
        expect(screen.getByText('Edit')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Edit'))
      await waitFor(() => {
        expect(screen.getByTestId('edit-custom-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('custom-modal-remove'))
      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
        expect(screen.getByText('Delete Tool')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-ok'))
      await waitFor(() => {
        expect(mockRemoveCustomCollection).toHaveBeenCalledWith('test_collection')
        expect(mockOnRefreshData).toHaveBeenCalled()
      })
    })
  })

  describe('Workflow Provider', () => {
    it('fetches workflow tool detail and shows "Open in Studio" and "Edit" buttons', async () => {
      const collection = makeCollection({
        type: CollectionType.workflow,
        allow_delete: true,
      })
      render(<ProviderDetail collection={collection} onHide={mockOnHide} onRefreshData={mockOnRefreshData} />)

      await waitFor(() => {
        expect(mockFetchWorkflowToolDetail).toHaveBeenCalledWith('test-collection')
      })

      await waitFor(() => {
        expect(screen.getByText('Open in Studio')).toBeInTheDocument()
        expect(screen.getByText('Edit')).toBeInTheDocument()
      })
    })

    it('shows workflow tool parameters', async () => {
      const collection = makeCollection({
        type: CollectionType.workflow,
        allow_delete: true,
      })
      render(<ProviderDetail collection={collection} onHide={mockOnHide} onRefreshData={mockOnRefreshData} />)

      await waitFor(() => {
        expect(screen.getByText('query')).toBeInTheDocument()
        expect(screen.getByText('string')).toBeInTheDocument()
        expect(screen.getByText('Search query')).toBeInTheDocument()
      })
    })

    it('deletes workflow tool through confirmation dialog', async () => {
      const collection = makeCollection({
        type: CollectionType.workflow,
        allow_delete: true,
      })
      render(<ProviderDetail collection={collection} onHide={mockOnHide} onRefreshData={mockOnRefreshData} />)

      await waitFor(() => {
        expect(screen.getByText('Edit')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Edit'))
      await waitFor(() => {
        expect(screen.getByTestId('workflow-tool-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('wf-modal-remove'))
      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-ok'))
      await waitFor(() => {
        expect(mockDeleteWorkflowTool).toHaveBeenCalledWith('test-collection')
        expect(mockOnRefreshData).toHaveBeenCalled()
      })
    })
  })

  describe('Drawer Interaction', () => {
    it('calls onHide when closing the drawer', async () => {
      const collection = makeCollection()
      render(<ProviderDetail collection={collection} onHide={mockOnHide} onRefreshData={mockOnRefreshData} />)

      await waitFor(() => {
        expect(screen.getByTestId('drawer')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('drawer-close'))
      expect(mockOnHide).toHaveBeenCalled()
    })
  })
})
