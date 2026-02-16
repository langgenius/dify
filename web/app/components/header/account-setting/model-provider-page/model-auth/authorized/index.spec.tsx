import type { Credential, CustomModel, ModelProvider } from '../../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { ConfigurationMethodEnum, ModelTypeEnum } from '../../declarations'
import Authorized from './index'

const mockHandleOpenModal = vi.fn()
const mockHandleActiveCredential = vi.fn()
const mockOpenConfirmDelete = vi.fn()
const mockCloseConfirmDelete = vi.fn()
const mockHandleConfirmDelete = vi.fn()

let mockDeleteCredentialId: string | null = null
let mockDoingAction = false

vi.mock('../hooks', () => ({
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

let mockPortalOpen = false

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => {
    mockPortalOpen = open
    return <div data-testid="portal" data-open={open}>{children}</div>
  },
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => (
    <div data-testid="portal-trigger" onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => {
    if (!mockPortalOpen)
      return null
    return <div data-testid="portal-content">{children}</div>
  },
}))

vi.mock('@/app/components/base/confirm', () => ({
  default: ({ isShow, onCancel, onConfirm }: { isShow: boolean, onCancel: () => void, onConfirm: () => void }) => {
    if (!isShow)
      return null
    return (
      <div data-testid="confirm-dialog">
        <button onClick={onCancel}>Cancel</button>
        <button onClick={onConfirm}>Confirm</button>
      </div>
    )
  },
}))

vi.mock('./authorized-item', () => ({
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
    mockPortalOpen = false
    mockDeleteCredentialId = null
    mockDoingAction = false
  })

  describe('Rendering', () => {
    it('should render trigger button', () => {
      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
        />,
      )

      expect(screen.getByText(/Trigger/)).toBeInTheDocument()
    })

    it('should render portal content when open', () => {
      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
          isOpen
        />,
      )

      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
      expect(screen.getByTestId('authorized-item')).toBeInTheDocument()
    })

    it('should not render portal content when closed', () => {
      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
        />,
      )

      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
    })

    it('should render Add API Key button when not model credential', () => {
      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
          isOpen
        />,
      )

      expect(screen.getByText(/addApiKey/)).toBeInTheDocument()
    })

    it('should render Add Model Credential button when is model credential', () => {
      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
          authParams={{ isModelCredential: true }}
          isOpen
        />,
      )

      expect(screen.getByText(/addModelCredential/)).toBeInTheDocument()
    })

    it('should not render add action when hideAddAction is true', () => {
      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
          hideAddAction
          isOpen
        />,
      )

      expect(screen.queryByText(/addApiKey/)).not.toBeInTheDocument()
    })

    it('should render popup title when provided', () => {
      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
          popupTitle="Select Credential"
          isOpen
        />,
      )

      expect(screen.getByText('Select Credential')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onOpenChange when trigger is clicked in controlled mode', () => {
      const onOpenChange = vi.fn()

      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
          isOpen={false}
          onOpenChange={onOpenChange}
        />,
      )

      fireEvent.click(screen.getByTestId('portal-trigger'))

      expect(onOpenChange).toHaveBeenCalledWith(true)
    })

    it('should toggle portal on trigger click', () => {
      const { rerender } = render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
        />,
      )

      fireEvent.click(screen.getByTestId('portal-trigger'))

      rerender(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
          isOpen
        />,
      )

      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })

    it('should open modal when triggerOnlyOpenModal is true', () => {
      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
          triggerOnlyOpenModal
        />,
      )

      fireEvent.click(screen.getByTestId('portal-trigger'))

      expect(mockHandleOpenModal).toHaveBeenCalled()
    })

    it('should call handleOpenModal when Add API Key is clicked', () => {
      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
          isOpen
        />,
      )

      fireEvent.click(screen.getByText(/addApiKey/))

      expect(mockHandleOpenModal).toHaveBeenCalled()
    })

    it('should call handleOpenModal with credential and model when edit is clicked', () => {
      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
          isOpen
        />,
      )

      fireEvent.click(screen.getAllByText('Edit')[0])

      expect(mockHandleOpenModal).toHaveBeenCalledWith(
        mockCredentials[0],
        mockItems[0].model,
      )
    })

    it('should pass current model fields when adding model credential', () => {
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
          isOpen
        />,
      )

      fireEvent.click(screen.getByText(/addModelCredential/))

      expect(mockHandleOpenModal).toHaveBeenCalledWith(undefined, {
        model: 'gpt-4',
        model_type: ModelTypeEnum.textGeneration,
      })
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
          isOpen
        />,
      )

      fireEvent.click(screen.getAllByText('Select')[0])

      expect(onItemClick).toHaveBeenCalledWith(mockCredentials[0], mockItems[0].model)
    })

    it('should call handleActiveCredential when onItemClick is not provided', () => {
      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
          isOpen
        />,
      )

      fireEvent.click(screen.getAllByText('Select')[0])

      expect(mockHandleActiveCredential).toHaveBeenCalledWith(mockCredentials[0], mockItems[0].model)
    })

    it('should not call onItemClick when disableItemClick is true', () => {
      const onItemClick = vi.fn()

      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
          onItemClick={onItemClick}
          disableItemClick
          isOpen
        />,
      )

      fireEvent.click(screen.getAllByText('Select')[0])

      expect(onItemClick).not.toHaveBeenCalled()
    })
  })

  describe('Delete Confirmation', () => {
    it('should show confirm dialog when deleteCredentialId is set', () => {
      mockDeleteCredentialId = 'cred-1'

      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
        />,
      )

      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    })

    it('should not show confirm dialog when deleteCredentialId is null', () => {
      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
        />,
      )

      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    })

    it('should call closeConfirmDelete when cancel is clicked', () => {
      mockDeleteCredentialId = 'cred-1'

      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
        />,
      )

      fireEvent.click(screen.getByText('Cancel'))

      expect(mockCloseConfirmDelete).toHaveBeenCalled()
    })

    it('should call handleConfirmDelete when confirm is clicked', () => {
      mockDeleteCredentialId = 'cred-1'

      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
        />,
      )

      fireEvent.click(screen.getByText('Confirm'))

      expect(mockHandleConfirmDelete).toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty items array', () => {
      render(
        <Authorized
          provider={mockProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={[]}
          renderTrigger={mockRenderTrigger}
          isOpen
        />,
      )

      expect(screen.queryByTestId('authorized-item')).not.toBeInTheDocument()
    })

    it('should not render add action when provider does not allow custom token', () => {
      const restrictedProvider = { ...mockProvider, allow_custom_token: false }

      render(
        <Authorized
          provider={restrictedProvider}
          configurationMethod={ConfigurationMethodEnum.predefinedModel}
          items={mockItems}
          renderTrigger={mockRenderTrigger}
          isOpen
        />,
      )

      expect(screen.queryByText(/addApiKey/)).not.toBeInTheDocument()
    })
  })
})
