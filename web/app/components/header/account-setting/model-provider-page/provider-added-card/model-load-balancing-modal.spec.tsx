import type { ModelItem, ModelProvider } from '../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { ConfigurationMethodEnum } from '../declarations'
import ModelLoadBalancingModal from './model-load-balancing-modal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: vi.fn(),
  }),
}))

vi.mock('@/app/components/base/modal', () => ({
  default: ({ children, isShow, title }: { children: React.ReactNode, isShow: boolean, title: React.ReactNode }) =>
    isShow
      ? (
          <div data-testid="modal">
            <div>{title}</div>
            {children}
          </div>
        )
      : null,
}))

vi.mock('@/app/components/base/confirm', () => ({
  default: ({ isShow, title, onCancel }: { isShow: boolean, title: string, onCancel: () => void }) =>
    isShow
      ? (
          <div data-testid="confirm">
            <span>{title}</span>
            <button onClick={onCancel}>Cancel</button>
          </div>
        )
      : null,
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, className }: { children: React.ReactNode, onClick: () => void, className?: string }) =>
    <button onClick={onClick} className={className}>{children}</button>,
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading" />,
}))

const mockModelCredentialData = {
  load_balancing: { enabled: true, configs: [] },
  current_credential_id: 'cred-1',
  available_credentials: [],
  current_credential_name: 'Default',
}

const mockGetModelCredentialResult = {
  isLoading: false,
  data: mockModelCredentialData,
  refetch: vi.fn(),
}

vi.mock('@/service/use-models', () => ({
  useGetModelCredential: () => mockGetModelCredentialResult,
  useUpdateModelLoadBalancingConfig: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ result: 'success' }),
  }),
}))

vi.mock('../model-auth/hooks/use-auth', () => ({
  useAuth: () => ({
    doingAction: false,
    deleteModel: null,
    openConfirmDelete: vi.fn(),
    closeConfirmDelete: vi.fn(),
    handleConfirmDelete: vi.fn(),
  }),
}))

vi.mock('../hooks', () => ({
  useRefreshModel: () => ({ handleRefreshModel: vi.fn() }),
}))

vi.mock('./model-load-balancing-configs', () => ({
  default: () => <div data-testid="configs" />,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-auth', () => ({
  SwitchCredentialInLoadBalancing: () => <div data-testid="switch-credential" />,
}))

vi.mock('../model-icon', () => ({
  default: () => <div data-testid="model-icon" />,
}))

vi.mock('../model-name', () => ({
  default: () => <div data-testid="model-name" />,
}))

describe('ModelLoadBalancingModal', () => {
  const mockProvider = {
    provider: 'test-provider',
    provider_credential_schema: {
      credential_form_schemas: [],
    },
    model_credential_schema: {
      credential_form_schemas: [],
    },
  } as unknown as ModelProvider

  const mockModel = {
    model: 'gpt-4',
    model_type: 'llm',
    fetch_from: 'predefined-model',
  } as unknown as ModelItem

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render modal with cancel and save buttons when open', () => {
    render(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open={true}
      />,
    )
    expect(screen.getByText('operation.cancel')).toBeInTheDocument()
    expect(screen.getByText('operation.save')).toBeInTheDocument()
  })

  it('should show config load balancing title', () => {
    render(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open={true}
      />,
    )
    expect(screen.getByText('modelProvider.auth.configLoadBalancing')).toBeInTheDocument()
  })

  it('should show provider managed text for predefined model', () => {
    render(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open={true}
      />,
    )
    expect(screen.getByText('modelProvider.auth.providerManaged')).toBeInTheDocument()
  })

  it('should show remove model button for custom configuration', () => {
    render(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.customizableModel}
        model={mockModel}
        open={true}
      />,
    )
    expect(screen.getByText('modelProvider.auth.removeModel')).toBeInTheDocument()
  })

  it('should call onClose when cancel clicked', () => {
    const onClose = vi.fn()
    render(
      <ModelLoadBalancingModal
        provider={mockProvider}
        configurateMethod={ConfigurationMethodEnum.predefinedModel}
        model={mockModel}
        open={true}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByText('operation.cancel'))
    expect(onClose).toHaveBeenCalled()
  })
})
