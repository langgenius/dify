import type { ModelProvider } from '../declarations'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { changeModelProviderPriority } from '@/service/common'
import { ConfigurationMethodEnum } from '../declarations'
import CredentialPanel from './credential-panel'

const mockEventEmitter = { emit: vi.fn() }
const mockNotify = vi.fn()
const mockUpdateModelList = vi.fn()
const mockUpdateModelProviders = vi.fn()
const mockCredentialStatus = {
  hasCredential: true,
  authorized: true,
  authRemoved: false,
  current_credential_name: 'test-credential',
  notAllowedToUse: false,
}

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    IS_CLOUD_EDITION: true,
  }
})

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
  }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: mockEventEmitter,
  }),
}))

vi.mock('@/service/common', () => ({
  changeModelProviderPriority: vi.fn(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-auth', () => ({
  ConfigProvider: () => <div data-testid="config-provider" />,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-auth/hooks', () => ({
  useCredentialStatus: () => mockCredentialStatus,
}))

vi.mock('../hooks', () => ({
  useUpdateModelList: () => mockUpdateModelList,
  useUpdateModelProviders: () => mockUpdateModelProviders,
}))

vi.mock('./priority-selector', () => ({
  default: ({ value, onSelect }: { value: string, onSelect: (key: string) => void }) => (
    <button data-testid="priority-selector" onClick={() => onSelect('custom')}>
      Priority Selector
      {' '}
      {value}
    </button>
  ),
}))

vi.mock('./priority-use-tip', () => ({
  default: () => <div data-testid="priority-use-tip">Priority Tip</div>,
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: ({ color }: { color: string }) => <div data-testid="indicator">{color}</div>,
}))

describe('CredentialPanel', () => {
  const mockProvider: ModelProvider = {
    provider: 'test-provider',
    provider_credential_schema: true,
    custom_configuration: { status: 'active' },
    system_configuration: { enabled: true },
    preferred_provider_type: 'system',
    configurate_methods: [ConfigurationMethodEnum.predefinedModel],
    supported_model_types: ['gpt-4'],
  } as unknown as ModelProvider

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(mockCredentialStatus, {
      hasCredential: true,
      authorized: true,
      authRemoved: false,
      current_credential_name: 'test-credential',
      notAllowedToUse: false,
    })
  })

  it('should show credential name and configuration actions', () => {
    render(<CredentialPanel provider={mockProvider} />)

    expect(screen.getByText('test-credential')).toBeInTheDocument()
    expect(screen.getByTestId('config-provider')).toBeInTheDocument()
    expect(screen.getByTestId('priority-selector')).toBeInTheDocument()
  })

  it('should show unauthorized status label when credential is missing', () => {
    mockCredentialStatus.hasCredential = false
    render(<CredentialPanel provider={mockProvider} />)

    expect(screen.getByText(/modelProvider\.auth\.unAuthorized/)).toBeInTheDocument()
  })

  it('should show removed credential label and priority tip for custom preference', () => {
    mockCredentialStatus.authorized = false
    mockCredentialStatus.authRemoved = true
    render(<CredentialPanel provider={{ ...mockProvider, preferred_provider_type: 'custom' } as ModelProvider} />)

    expect(screen.getByText(/modelProvider\.auth\.authRemoved/)).toBeInTheDocument()
    expect(screen.getByTestId('priority-use-tip')).toBeInTheDocument()
  })

  it('should change priority and refresh related data after success', async () => {
    const mockChangePriority = changeModelProviderPriority as ReturnType<typeof vi.fn>
    mockChangePriority.mockResolvedValue({ result: 'success' })
    render(<CredentialPanel provider={mockProvider} />)

    fireEvent.click(screen.getByTestId('priority-selector'))

    await waitFor(() => {
      expect(mockChangePriority).toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalled()
      expect(mockUpdateModelProviders).toHaveBeenCalled()
      expect(mockUpdateModelList).toHaveBeenCalledWith('gpt-4')
      expect(mockEventEmitter.emit).toHaveBeenCalled()
    })
  })

  it('should render standalone priority selector without provider schema', () => {
    const providerNoSchema = {
      ...mockProvider,
      provider_credential_schema: null,
    } as unknown as ModelProvider
    render(<CredentialPanel provider={providerNoSchema} />)
    expect(screen.getByTestId('priority-selector')).toBeInTheDocument()
    expect(screen.queryByTestId('config-provider')).not.toBeInTheDocument()
  })
})
