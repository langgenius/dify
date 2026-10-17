import type { ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ManageCustomModelCredentials from '../manage-custom-model-credentials'

// Mock hooks
const mockGetCustomModels = vi.fn()
vi.mock('../hooks', () => ({
  getCustomModels: () => mockGetCustomModels(),
  useAuth: () => ({
    handleOpenModal: vi.fn(),
  }),
}))

// Mock Authorized
vi.mock('../authorized', () => ({
  default: ({
    renderTrigger,
    items,
    popupTitle,
    isOpen,
    onOpenChange,
  }: {
    renderTrigger: (o?: boolean) => React.ReactNode
    items: Array<{
      model?: { model?: string }
      selectedCredential?: { credential_id?: string }
    }>
    popupTitle: string
    isOpen?: boolean
    onOpenChange?: (open: boolean) => void
  }) => (
    <div data-testid="authorized-mock">
      <div data-testid="trigger-closed">{renderTrigger()}</div>
      <div data-testid="trigger-open">{renderTrigger(true)}</div>
      <div data-testid="popup-title">{popupTitle}</div>
      <div data-testid="items-count">{items.length}</div>
      <button type="button" data-open={isOpen} onClick={() => onOpenChange?.(false)}>
        close
      </button>
      <div data-testid="items-selected">
        {items.map((item, index) => (
          <span
            key={
              item.model?.model ?? item.selectedCredential?.credential_id ?? `missing-${popupTitle}`
            }
            data-testid={`selected-${index}`}
          >
            {item.selectedCredential ? 'has-cred' : 'no-cred'}
          </span>
        ))}
      </div>
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
    mockGetCustomModels.mockReturnValue([])
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
    mockGetCustomModels.mockReturnValue(mockModels)

    render(<ManageCustomModelCredentials provider={mockProvider} />)

    expect(screen.getByTestId('authorized-mock')).toBeInTheDocument()
    expect(screen.getAllByText(/modelProvider.auth.manageCredentials/).length).toBeGreaterThan(0)
    expect(screen.getByTestId('items-count')).toHaveTextContent('2')
    expect(screen.getByTestId('popup-title')).toHaveTextContent(
      'modelProvider.auth.customModelCredentials',
    )
  })

  it('should render trigger in both open and closed states', () => {
    const mockModels = [
      {
        model: 'gpt-4',
        available_model_credentials: [{ credential_id: 'c1', credential_name: 'Key 1' }],
        current_credential_id: 'c1',
        current_credential_name: 'Key 1',
      },
    ]
    mockGetCustomModels.mockReturnValue(mockModels)

    render(<ManageCustomModelCredentials provider={mockProvider} />)

    expect(screen.getByTestId('trigger-closed')).toBeInTheDocument()
    expect(screen.getByTestId('trigger-open')).toBeInTheDocument()
  })

  it('should forward controlled open state', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    mockGetCustomModels.mockReturnValue([{ model: 'gpt-4' }])

    render(
      <ManageCustomModelCredentials provider={mockProvider} isOpen onOpenChange={onOpenChange} />,
    )

    const closeButton = screen.getByRole('button', { name: 'close' })
    expect(closeButton).toHaveAttribute('data-open', 'true')
    await user.click(closeButton)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('should pass undefined selectedCredential when model has no current_credential_id', () => {
    const mockModels = [
      {
        model: 'gpt-3.5',
        available_model_credentials: [{ credential_id: 'c1', credential_name: 'Key 1' }],
        current_credential_id: '',
        current_credential_name: '',
      },
    ]
    mockGetCustomModels.mockReturnValue(mockModels)

    render(<ManageCustomModelCredentials provider={mockProvider} />)

    expect(screen.getByTestId('selected-0')).toHaveTextContent('no-cred')
  })
})
