import type { CustomModel, ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import SwitchCredentialInLoadBalancing from '../switch-credential-in-load-balancing'

// Mock components
vi.mock('../authorized', () => ({
  default: ({ renderTrigger, onItemClick, items }: { renderTrigger: () => React.ReactNode, onItemClick: (c: unknown) => void, items: { credentials: unknown[] }[] }) => (
    <div data-testid="authorized-mock">
      <div data-testid="trigger-container" onClick={() => onItemClick(items[0]!.credentials[0])}>
        {renderTrigger()}
      </div>
    </div>
  ),
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: ({ color }: { color: string }) => <div data-testid={`indicator-${color}`} />,
}))

vi.mock('@remixicon/react', () => ({
  RiArrowDownSLine: () => <div data-testid="arrow-icon" />,
  RiQuestionLine: () => <div data-testid="question-icon" />,
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

    expect(screen.getByText('Key 1'))!.toBeInTheDocument()
    expect(screen.getByTestId('indicator-green'))!.toBeInTheDocument()
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

    expect(screen.getByText(/modelProvider.auth.authRemoved/))!.toBeInTheDocument()
    expect(screen.getByTestId('indicator-red'))!.toBeInTheDocument()
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

    expect(screen.getByText(/auth.credentialUnavailableInButton/))!.toBeInTheDocument()
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

    fireEvent.mouseEnter(screen.getByText(/auth.credentialUnavailableInButton/))
    expect(screen.getByText('plugin.auth.credentialUnavailable'))!.toBeInTheDocument()
  })

  // Empty credentials with allowed custom: no tooltip but still shows unavailable text
  it('should show unavailable status without tooltip when custom credentials are allowed', () => {
    // Act
    render(
      <SwitchCredentialInLoadBalancing
        provider={mockProvider}
        model={mockModel}
        credentials={[]}
        customModelCredential={undefined}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    // Assert
    // Assert
    expect(screen.getByText(/auth.credentialUnavailableInButton/))!.toBeInTheDocument()
    expect(screen.queryByText('plugin.auth.credentialUnavailable')).not.toBeInTheDocument()
  })

  // not_allowed_to_use=true: indicator is red and destructive button text is shown
  it('should show red indicator and unavailable button text when credential has not_allowed_to_use=true', () => {
    const unavailableCredential = { credential_id: 'cred-1', credential_name: 'Key 1', not_allowed_to_use: true }

    render(
      <SwitchCredentialInLoadBalancing
        provider={mockProvider}
        model={mockModel}
        credentials={[unavailableCredential]}
        customModelCredential={unavailableCredential}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    expect(screen.getByTestId('indicator-red'))!.toBeInTheDocument()
    expect(screen.getByText(/auth.credentialUnavailableInButton/))!.toBeInTheDocument()
  })

  // from_enterprise=true on the selected credential: Enterprise badge appears in the trigger
  it('should show Enterprise badge when selected credential has from_enterprise=true', () => {
    const enterpriseCredential = { credential_id: 'cred-1', credential_name: 'Enterprise Key', from_enterprise: true }

    render(
      <SwitchCredentialInLoadBalancing
        provider={mockProvider}
        model={mockModel}
        credentials={[enterpriseCredential]}
        customModelCredential={enterpriseCredential}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    expect(screen.getByText('Enterprise'))!.toBeInTheDocument()
  })

  // non-empty credentials with allow_custom_token=false: no tooltip (tooltip only for empty+notAllowCustom)
  it('should not show unavailable tooltip when credentials are non-empty and allow_custom_token=false', () => {
    const restrictedProvider = { ...mockProvider, allow_custom_token: false }

    render(
      <SwitchCredentialInLoadBalancing
        provider={restrictedProvider}
        model={mockModel}
        credentials={mockCredentials}
        customModelCredential={mockCredentials[0]}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    fireEvent.mouseEnter(screen.getByText('Key 1'))
    expect(screen.queryByText('plugin.auth.credentialUnavailable')).not.toBeInTheDocument()
    expect(screen.getByText('Key 1'))!.toBeInTheDocument()
  })

  it('should pass undefined currentCustomConfigurationModelFixedFields when model is undefined', () => {
    render(
      <SwitchCredentialInLoadBalancing
        provider={mockProvider}
        // @ts-expect-error testing runtime handling when model is omitted
        model={undefined}
        credentials={mockCredentials}
        customModelCredential={mockCredentials[0]}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    // Component still renders (Authorized receives undefined currentCustomConfigurationModelFixedFields)
    // Component still renders (Authorized receives undefined currentCustomConfigurationModelFixedFields)
    expect(screen.getByTestId('authorized-mock'))!.toBeInTheDocument()
    expect(screen.getByText('Key 1'))!.toBeInTheDocument()
  })

  it('should treat undefined credentials as empty list', () => {
    render(
      <SwitchCredentialInLoadBalancing
        provider={mockProvider}
        model={mockModel}
        credentials={undefined}
        customModelCredential={undefined}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    // credentials is undefined → empty=true → unavailable text shown
    // credentials is undefined → empty=true → unavailable text shown
    expect(screen.getByText(/auth.credentialUnavailableInButton/))!.toBeInTheDocument()
    expect(screen.queryByTestId(/indicator-/)).not.toBeInTheDocument()
  })

  it('should render nothing for credential_name when it is empty string', () => {
    const credWithEmptyName = { credential_id: 'cred-1', credential_name: '' }

    render(
      <SwitchCredentialInLoadBalancing
        provider={mockProvider}
        model={mockModel}
        credentials={[credWithEmptyName]}
        customModelCredential={credWithEmptyName}
        setCustomModelCredential={mockSetCustomModelCredential}
      />,
    )

    // indicator-green shown (not authRemoved, not unavailable, not empty)
    // indicator-green shown (not authRemoved, not unavailable, not empty)
    expect(screen.getByTestId('indicator-green'))!.toBeInTheDocument()
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    // credential_name is empty so nothing printed for name
    expect(screen.queryByText('Key 1')).not.toBeInTheDocument()
  })
})
