import type { ReactNode } from 'react'
import type { ModelProvider } from '../../../declarations'
import type { CredentialPanelState } from '../../use-credential-panel-state'
import { act, fireEvent, render, screen } from '@testing-library/react'
import DropdownContent from '../dropdown-content'

type AlertDialogProps = {
  children: ReactNode
  onOpenChange?: (open: boolean) => void
}

let latestOnOpenChange: AlertDialogProps['onOpenChange']
const mockOpenConfirmDelete = vi.fn()
const mockCloseConfirmDelete = vi.fn()
const mockHandleConfirmDelete = vi.fn()
const mockHandleOpenModal = vi.fn()

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

vi.mock('@/app/components/base/ui/alert-dialog', () => ({
  AlertDialog: ({ children, onOpenChange }: AlertDialogProps) => {
    latestOnOpenChange = onOpenChange
    return <div>{children}</div>
  },
  AlertDialogActions: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogCancelButton: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  AlertDialogConfirmButton: ({ children, onClick }: { children: ReactNode, onClick?: () => void }) => <button type="button" onClick={onClick}>{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: () => <div />,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('../api-key-section', () => ({
  default: ({ credentials, onDelete }: { credentials: unknown[], onDelete: (credential?: unknown) => void }) => (
    <div>
      <span>{`credentials:${credentials.length}`}</span>
      <button type="button" onClick={() => onDelete(undefined)}>delete-undefined</button>
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

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider => ({
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
} as unknown as ModelProvider)

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

describe('DropdownContent dialog branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestOnOpenChange = undefined
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

  it('should ignore delete requests without a credential payload', () => {
    render(
      <DropdownContent
        provider={createProvider()}
        state={createState()}
        isChangingPriority={false}
        onChangePriority={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'delete-undefined' }))

    expect(mockOpenConfirmDelete).not.toHaveBeenCalled()
  })

  it('should only close the confirm dialog when the alert dialog reports closed', () => {
    render(
      <DropdownContent
        provider={createProvider()}
        state={createState()}
        isChangingPriority={false}
        onChangePriority={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    act(() => {
      latestOnOpenChange?.(true)
      latestOnOpenChange?.(false)
    })

    expect(mockCloseConfirmDelete).toHaveBeenCalledTimes(1)
  })
})
