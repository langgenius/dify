import type { Credential, CustomModelCredential, ModelProvider } from '../../declarations'
import { render, screen } from '@testing-library/react'
import { ModelTypeEnum } from '../../declarations'
import { AuthorizedItem } from './authorized-item'

vi.mock('../../model-icon', () => ({
  default: ({ modelName }: { modelName: string }) => <div data-testid="model-icon">{modelName}</div>,
}))

vi.mock('./credential-item', () => ({
  default: ({ credential, onEdit, onDelete, onItemClick }: {
    credential: Credential
    onEdit?: (credential: Credential) => void
    onDelete?: (credential: Credential) => void
    onItemClick?: (credential: Credential) => void
  }) => (
    <div data-testid={`credential-item-${credential.credential_id}`}>
      {credential.credential_name}
      <button onClick={() => onEdit?.(credential)}>Edit</button>
      <button onClick={() => onDelete?.(credential)}>Delete</button>
      <button onClick={() => onItemClick?.(credential)}>Click</button>
    </div>
  ),
}))

describe('AuthorizedItem', () => {
  const mockProvider: ModelProvider = {
    provider: 'openai',
  } as ModelProvider

  const mockCredentials: Credential[] = [
    { credential_id: 'cred-1', credential_name: 'API Key 1' },
    { credential_id: 'cred-2', credential_name: 'API Key 2' },
  ]

  const mockModel: CustomModelCredential = {
    model: 'gpt-4',
    model_type: ModelTypeEnum.textGeneration,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render credentials list', () => {
      render(
        <AuthorizedItem
          provider={mockProvider}
          credentials={mockCredentials}
        />,
      )

      expect(screen.getByTestId('credential-item-cred-1')).toBeInTheDocument()
      expect(screen.getByTestId('credential-item-cred-2')).toBeInTheDocument()
      expect(screen.getByText('API Key 1')).toBeInTheDocument()
      expect(screen.getByText('API Key 2')).toBeInTheDocument()
    })

    it('should render model title when showModelTitle is true', () => {
      render(
        <AuthorizedItem
          provider={mockProvider}
          credentials={mockCredentials}
          model={mockModel}
          showModelTitle
        />,
      )

      expect(screen.getByTestId('model-icon')).toBeInTheDocument()
      expect(screen.getAllByText('gpt-4')).toHaveLength(2)
    })

    it('should not render model title when showModelTitle is false', () => {
      render(
        <AuthorizedItem
          provider={mockProvider}
          credentials={mockCredentials}
          model={mockModel}
        />,
      )

      expect(screen.queryByTestId('model-icon')).not.toBeInTheDocument()
    })

    it('should render custom title instead of model name', () => {
      render(
        <AuthorizedItem
          provider={mockProvider}
          credentials={mockCredentials}
          model={mockModel}
          title="Custom Title"
          showModelTitle
        />,
      )

      expect(screen.getByText('Custom Title')).toBeInTheDocument()
    })

    it('should handle empty credentials array', () => {
      const { container } = render(
        <AuthorizedItem
          provider={mockProvider}
          credentials={[]}
        />,
      )

      expect(container.querySelector('[data-testid^="credential-item-"]')).not.toBeInTheDocument()
    })
  })

  describe('Callback Propagation', () => {
    it('should pass onEdit callback to credential items', () => {
      const onEdit = vi.fn()

      render(
        <AuthorizedItem
          provider={mockProvider}
          credentials={mockCredentials}
          model={mockModel}
          onEdit={onEdit}
        />,
      )

      screen.getAllByText('Edit')[0].click()

      expect(onEdit).toHaveBeenCalledWith(mockCredentials[0], mockModel)
    })

    it('should pass onDelete callback to credential items', () => {
      const onDelete = vi.fn()

      render(
        <AuthorizedItem
          provider={mockProvider}
          credentials={mockCredentials}
          model={mockModel}
          onDelete={onDelete}
        />,
      )

      screen.getAllByText('Delete')[0].click()

      expect(onDelete).toHaveBeenCalledWith(mockCredentials[0], mockModel)
    })

    it('should pass onItemClick callback to credential items', () => {
      const onItemClick = vi.fn()

      render(
        <AuthorizedItem
          provider={mockProvider}
          credentials={mockCredentials}
          model={mockModel}
          onItemClick={onItemClick}
        />,
      )

      screen.getAllByText('Click')[0].click()

      expect(onItemClick).toHaveBeenCalledWith(mockCredentials[0], mockModel)
    })
  })
})
