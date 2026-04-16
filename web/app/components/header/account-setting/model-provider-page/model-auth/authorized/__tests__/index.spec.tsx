import type { Credential, CustomModel, ModelProvider } from '../../../declarations'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ConfigurationMethodEnum, ModelTypeEnum } from '../../../declarations'
import Authorized from '../index'

const mockHandleOpenModal = vi.fn()
const mockHandleActiveCredential = vi.fn()
const mockOpenConfirmDelete = vi.fn()
const mockCloseConfirmDelete = vi.fn()
const mockHandleConfirmDelete = vi.fn()

let mockDeleteCredentialId: string | null = null
let mockDoingAction = false

vi.mock('../../hooks', () => ({
  useAuth: () => ({
    openConfirmDelete: mockOpenConfirmDelete,
    closeConfirmDelete: mockCloseConfirmDelete,
    doingAction: mockDoingAction,
    handleActiveCredential: mockHandleActiveCredential,
    handleConfirmDelete: mockHandleConfirmDelete,
    deleteCredentialId: mockDeleteCredentialId,
    handleOpenModal: mockHandleOpenModal,
  }),
}))

vi.mock('../authorized-item', () => ({
  default: ({ credentials, model, onEdit, onDelete, onItemClick }: {
    credentials: Credential[]
    model?: CustomModel
    onEdit?: (credential: Credential, model?: CustomModel) => void
    onDelete?: (credential: Credential, model?: CustomModel) => void
    onItemClick?: (credential: Credential, model?: CustomModel) => void
  }) => (
    <div data-testid="authorized-item">
      {credentials.map((cred: Credential) => (
        <div key={cred.credential_id}>
          <span>{cred.credential_name}</span>
          <button onClick={() => onEdit?.(cred, model)}>Edit</button>
          <button onClick={() => onDelete?.(cred, model)}>Delete</button>
          <button onClick={() => onItemClick?.(cred, model)}>Select</button>
        </div>
      ))}
    </div>
  ),
}))

describe('Authorized', () => {
  const mockProvider: ModelProvider = {
    provider: 'openai',
    allow_custom_token: true,
  } as ModelProvider

  const mockCredentials: Credential[] = [
    { credential_id: 'cred-1', credential_name: 'API Key 1' },
    { credential_id: 'cred-2', credential_name: 'API Key 2' },
  ]

  const mockItems = [
    {
      model: {
        model: 'gpt-4',
        model_type: ModelTypeEnum.textGeneration,
      },
      credentials: mockCredentials,
    },
  ]

  const mockRenderTrigger = (open?: boolean) => (
    <button>
      Trigger
      {open ? 'Open' : 'Closed'}
    </button>
  )

  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteCredentialId = null
    mockDoingAction = false
  })

  it('should render trigger and open popup when trigger is clicked', () => {
    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /trigger\s*closed/i }))
    expect(screen.getByTestId('authorized-item'))!.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /addApiKey/i }))!.toBeInTheDocument()
  })

  it('should call handleOpenModal when triggerOnlyOpenModal is true', () => {
    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
        triggerOnlyOpenModal
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /trigger\s*closed/i }))
    expect(mockHandleOpenModal).toHaveBeenCalled()
    expect(screen.queryByTestId('authorized-item')).not.toBeInTheDocument()
  })

  it('should call onItemClick when credential is selected', () => {
    const onItemClick = vi.fn()
    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
        onItemClick={onItemClick}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /trigger\s*closed/i }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Select' })[0]!)

    expect(onItemClick).toHaveBeenCalledWith(mockCredentials[0], mockItems[0]!.model)
  })

  it('should call handleActiveCredential when onItemClick is not provided', () => {
    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /trigger\s*closed/i }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Select' })[0]!)

    expect(mockHandleActiveCredential).toHaveBeenCalledWith(mockCredentials[0], mockItems[0]!.model)
  })

  it('should call handleOpenModal with fixed model fields when adding model credential', () => {
    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.customizableModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
        authParams={{ isModelCredential: true }}
        currentCustomConfigurationModelFixedFields={{
          __model_name: 'gpt-4',
          __model_type: ModelTypeEnum.textGeneration,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /trigger\s*closed/i }))
    fireEvent.click(screen.getByText(/addModelCredential/))

    expect(mockHandleOpenModal).toHaveBeenCalledWith(undefined, {
      model: 'gpt-4',
      model_type: ModelTypeEnum.textGeneration,
    })
  })

  it('should not render add action when hideAddAction is true', () => {
    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
        hideAddAction
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /trigger\s*closed/i }))
    expect(screen.queryByRole('button', { name: /addApiKey/i })).not.toBeInTheDocument()
  })

  it('should show confirm dialog and call confirm handler when delete is confirmed', () => {
    mockDeleteCredentialId = 'cred-1'

    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /common.operation.confirm/i }))
    expect(mockHandleConfirmDelete).toHaveBeenCalled()
  })

  it('should close confirm dialog when deletion is cancelled', () => {
    mockDeleteCredentialId = 'cred-1'

    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
      />,
    )

    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /operation.cancel/i }))

    expect(mockCloseConfirmDelete).toHaveBeenCalledTimes(1)
  })

  it('should disable the confirm button while deletion is in progress', () => {
    mockDeleteCredentialId = 'cred-1'
    mockDoingAction = true

    render(
      <Authorized
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        items={mockItems}
        renderTrigger={mockRenderTrigger}
      />,
    )

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: /common.operation.confirm/i }))!.toBeDisabled()
  })
})
