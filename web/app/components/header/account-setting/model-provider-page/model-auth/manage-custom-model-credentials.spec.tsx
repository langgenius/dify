import type { ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { render, screen } from '@testing-library/react'
import ManageCustomModelCredentials from './manage-custom-model-credentials'

// Mock hooks
const mockUseCustomModels = vi.fn()
vi.mock('./hooks', () => ({
  useCustomModels: () => mockUseCustomModels(),
  useAuth: () => ({
    handleOpenModal: vi.fn(),
  }),
}))

// Mock Authorized
vi.mock('./authorized', () => ({
  default: ({ renderTrigger, items, popupTitle }: { renderTrigger: (o?: boolean) => React.ReactNode, items: { length: number }, popupTitle: string }) => (
    <div data-testid="authorized-mock">
      <div data-testid="trigger-container">{renderTrigger()}</div>
      <div data-testid="popup-title">{popupTitle}</div>
      <div data-testid="items-count">{items.length}</div>
    </div>
  ),
}))

describe('ManageCustomModelCredentials', () => {
  const mockProvider = {
    provider: 'openai',
  } as unknown as ModelProvider

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null when no custom models exist', () => {
    mockUseCustomModels.mockReturnValue([])
    const { container } = render(<ManageCustomModelCredentials provider={mockProvider} />)
    expect(container.firstChild).toBeNull()
  })

  it('should render authorized component when custom models exist', () => {
    const mockModels = [
      {
        model: 'gpt-4',
        available_model_credentials: [{ credential_id: 'c1', credential_name: 'Key 1' }],
        current_credential_id: 'c1',
        current_credential_name: 'Key 1',
      },
      {
        model: 'gpt-3.5',
        // testing undefined credentials branch
      },
    ]
    mockUseCustomModels.mockReturnValue(mockModels)

    render(<ManageCustomModelCredentials provider={mockProvider} />)

    expect(screen.getByTestId('authorized-mock')).toBeInTheDocument()
    expect(screen.getByText(/modelProvider.auth.manageCredentials/)).toBeInTheDocument()
    expect(screen.getByTestId('items-count')).toHaveTextContent('2')
    expect(screen.getByTestId('popup-title')).toHaveTextContent('modelProvider.auth.customModelCredentials')
  })
})
