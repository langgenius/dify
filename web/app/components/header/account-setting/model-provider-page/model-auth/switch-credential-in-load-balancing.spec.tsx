import type { CustomModel, ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import SwitchCredentialInLoadBalancing from './switch-credential-in-load-balancing'

// Mock components
vi.mock('./authorized', () => ({
  default: ({ renderTrigger, onItemClick, items }: { renderTrigger: () => React.ReactNode, onItemClick: (c: unknown) => void, items: { credentials: unknown[] }[] }) => (
    <div data-testid="authorized-mock">
      <div data-testid="trigger-container" onClick={() => onItemClick(items[0].credentials[0])}>
        {renderTrigger()}
      </div>
    </div>
  ),
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: ({ color }: { color: string }) => <div data-testid={`indicator-${color}`} />,
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children, popupContent }: { children: React.ReactNode, popupContent: string }) => (
    <div data-testid="tooltip-mock">
      {children}
      <div>{popupContent}</div>
    </div>
  ),
}))

vi.mock('@remixicon/react', () => ({
  RiArrowDownSLine: () => <div data-testid="arrow-icon" />,
}))

describe('SwitchCredentialInLoadBalancing', () => {
  const mockProvider = {
    provider: 'openai',
    allow_custom_token: true,
  } as unknown as ModelProvider

  const mockModel = {
    model: 'gpt-4',
    model_type: ModelTypeEnum.textGeneration,
  } as unknown as CustomModel

  const mockCredentials = [
    { credential_id: 'cred-1', credential_name: 'Key 1' },
    { credential_id: 'cred-2', credential_name: 'Key 2' },
  ]

  const mockSetCustomModelCredential = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render selected credential name correctly', () => {
    render(
      <SwitchCredentialInLoadBalancing
        provider={mockProvider}
        model={mockModel}
        credentials={mockCredentials}
        customModelCredential={mockCredentials[0]}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    expect(screen.getByText('Key 1')).toBeInTheDocument()
    expect(screen.getByTestId('indicator-green')).toBeInTheDocument()
  })

  it('should render auth removed status when selected credential is not in list', () => {
    render(
      <SwitchCredentialInLoadBalancing
        provider={mockProvider}
        model={mockModel}
        credentials={mockCredentials}
        customModelCredential={{ credential_id: 'dead-cred', credential_name: 'Dead Key' }}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    expect(screen.getByText(/modelProvider.auth.authRemoved/)).toBeInTheDocument()
    expect(screen.getByTestId('indicator-red')).toBeInTheDocument()
  })

  it('should render unavailable status when credentials list is empty', () => {
    render(
      <SwitchCredentialInLoadBalancing
        provider={mockProvider}
        model={mockModel}
        credentials={[]}
        customModelCredential={undefined}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    expect(screen.getByText(/auth.credentialUnavailableInButton/)).toBeInTheDocument()
    expect(screen.queryByTestId(/indicator-/)).not.toBeInTheDocument()
  })

  it('should call setCustomModelCredential when an item is selected in Authorized', () => {
    render(
      <SwitchCredentialInLoadBalancing
        provider={mockProvider}
        model={mockModel}
        credentials={mockCredentials}
        customModelCredential={mockCredentials[0]}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    fireEvent.click(screen.getByTestId('trigger-container'))
    expect(mockSetCustomModelCredential).toHaveBeenCalledWith(mockCredentials[0])
  })

  it('should show tooltip when empty and custom credentials not allowed', () => {
    const restrictedProvider = { ...mockProvider, allow_custom_token: false }
    render(
      <SwitchCredentialInLoadBalancing
        provider={restrictedProvider}
        model={mockModel}
        credentials={[]}
        customModelCredential={undefined}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    expect(screen.getByText('plugin.auth.credentialUnavailable')).toBeInTheDocument()
  })
})
