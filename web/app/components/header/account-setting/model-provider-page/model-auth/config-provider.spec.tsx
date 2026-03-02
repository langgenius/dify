import type { ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { render, screen } from '@testing-library/react'
import ConfigProvider from './config-provider'

const mockUseCredentialStatus = vi.fn()

vi.mock('./hooks', () => ({
  useCredentialStatus: () => mockUseCredentialStatus(),
}))

vi.mock('./authorized', () => ({
  default: ({ renderTrigger }: { renderTrigger: () => React.ReactNode }) => (
    <div>
      {renderTrigger()}
    </div>
  ),
}))

describe('ConfigProvider', () => {
  const baseProvider = {
    provider: 'openai',
    allow_custom_token: true,
  } as ModelProvider

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show setup label when no credential exists', () => {
    mockUseCredentialStatus.mockReturnValue({
      hasCredential: false,
      authorized: true,
      current_credential_id: '',
      current_credential_name: '',
      available_credentials: [],
    })

    render(<ConfigProvider provider={baseProvider} />)

    expect(screen.getByText(/operation.setup/i)).toBeInTheDocument()
  })

  it('should show config label when credential exists', () => {
    mockUseCredentialStatus.mockReturnValue({
      hasCredential: true,
      authorized: true,
      current_credential_id: 'cred-1',
      current_credential_name: 'Key 1',
      available_credentials: [],
    })

    render(<ConfigProvider provider={baseProvider} />)

    expect(screen.getByText(/operation.config/i)).toBeInTheDocument()
  })

  it('should still render setup label when custom credentials are not allowed', () => {
    mockUseCredentialStatus.mockReturnValue({
      hasCredential: false,
      authorized: false,
      current_credential_id: '',
      current_credential_name: '',
      available_credentials: [],
    })

    render(<ConfigProvider provider={{ ...baseProvider, allow_custom_token: false }} />)

    expect(screen.getByText(/operation.setup/i)).toBeInTheDocument()
  })
})
