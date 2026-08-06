import type { ModelProvider } from '../../../declarations'
import type { CredentialPanelState } from '../../use-credential-panel-state'
import { screen } from '@testing-library/react'
import { render } from '@/test/console/render'
import DropdownContent from '../dropdown-content'

const mockOpenConfirmDelete = vi.fn()
const mockCloseConfirmDelete = vi.fn()
const mockHandleConfirmDelete = vi.fn()
const mockHandleOpenModal = vi.fn()

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
  }))
})

vi.mock('../../../model-auth/hooks', () => ({
  useAuth: () => ({
    openConfirmDelete: mockOpenConfirmDelete,
    closeConfirmDelete: mockCloseConfirmDelete,
    doingAction: false,
    handleConfirmDelete: mockHandleConfirmDelete,
    deleteCredentialId: 'cred-1',
    handleOpenModal: mockHandleOpenModal,
  }),
}))

vi.mock('../use-activate-credential', () => ({
  useActivateCredential: () => ({
    selectedCredentialId: 'cred-1',
    isActivating: false,
    activate: vi.fn(),
  }),
}))

vi.mock('../api-key-section', () => ({
  default: ({ credentials }: { credentials: unknown[] }) => (
    <div>
      <span>{`credentials:${credentials.length}`}</span>
    </div>
  ),
}))

vi.mock('../credits-exhausted-alert', () => ({
  default: () => <div>credits alert</div>,
}))

vi.mock('../credits-fallback-alert', () => ({
  default: () => <div>fallback alert</div>,
}))

vi.mock('../usage-priority-section', () => ({
  default: () => <div>priority section</div>,
}))

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider =>
  ({
    provider: 'test',
    custom_configuration: {
      available_credentials: undefined,
    },
    system_configuration: {
      enabled: true,
      quota_configurations: [],
      current_quota_type: 'trial',
    },
    configurate_methods: [],
    supported_model_types: [],
    ...overrides,
  }) as unknown as ModelProvider

const createState = (overrides: Partial<CredentialPanelState> = {}): CredentialPanelState => ({
  variant: 'api-active',
  priority: 'apiKey',
  supportsCredits: true,
  showPrioritySwitcher: false,
  hasCredentials: false,
  isCreditsExhausted: false,
  credentialName: undefined,
  credits: 0,
  ...overrides,
})

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: [],
  }))
})

describe('DropdownContent dialog branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fall back to an empty credential list when the provider has no credentials', () => {
    render(
      <DropdownContent
        provider={createProvider()}
        state={createState()}
        isChangingPriority={false}
        onChangePriority={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('credentials:0')).toBeInTheDocument()
  })
})
