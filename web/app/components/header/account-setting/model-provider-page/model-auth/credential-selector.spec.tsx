import { fireEvent, render, screen } from '@testing-library/react'
import CredentialSelector from './credential-selector'

vi.mock('./authorized/credential-item', () => ({
  default: ({ credential, onItemClick }: { credential: { credential_name: string }, onItemClick?: (c: unknown) => void }) => (
    <button type="button" onClick={() => onItemClick?.(credential)}>
      {credential.credential_name}
    </button>
  ),
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: () => <div data-testid="indicator" />,
}))

vi.mock('@remixicon/react', () => ({
  RiAddLine: () => <div data-testid="add-icon" />,
  RiArrowDownSLine: () => <div data-testid="arrow-icon" />,
}))

describe('CredentialSelector', () => {
  const mockCredentials = [
    { credential_id: 'cred-1', credential_name: 'Key 1' },
    { credential_id: 'cred-2', credential_name: 'Key 2' },
  ]
  const mockOnSelect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render selected credential name when selectedCredential is provided', () => {
    render(
      <CredentialSelector
        selectedCredential={mockCredentials[0]}
        credentials={mockCredentials}
        onSelect={mockOnSelect}
      />,
    )

    expect(screen.getByText('Key 1')).toBeInTheDocument()
    expect(screen.getByTestId('indicator')).toBeInTheDocument()
  })

  it('should render placeholder when selectedCredential is missing', () => {
    render(
      <CredentialSelector
        credentials={mockCredentials}
        onSelect={mockOnSelect}
      />,
    )

    expect(screen.getByText(/modelProvider.auth.selectModelCredential/)).toBeInTheDocument()
  })

  it('should call onSelect when a credential item is clicked', () => {
    render(
      <CredentialSelector
        credentials={mockCredentials}
        onSelect={mockOnSelect}
      />,
    )

    fireEvent.click(screen.getByText(/modelProvider.auth.selectModelCredential/))
    fireEvent.click(screen.getByRole('button', { name: 'Key 2' }))

    expect(mockOnSelect).toHaveBeenCalledWith(mockCredentials[1])
  })

  it('should call onSelect with add-new payload when add action is clicked', () => {
    render(
      <CredentialSelector
        credentials={mockCredentials}
        onSelect={mockOnSelect}
      />,
    )

    fireEvent.click(screen.getByText(/modelProvider.auth.selectModelCredential/))
    fireEvent.click(screen.getByText(/modelProvider.auth.addNewModelCredential/))

    expect(mockOnSelect).toHaveBeenCalledWith(expect.objectContaining({
      credential_id: '__add_new_credential',
      addNewCredential: true,
    }))
  })

  it('should not open options when disabled is true', () => {
    render(
      <CredentialSelector
        disabled
        credentials={mockCredentials}
        onSelect={mockOnSelect}
      />,
    )

    fireEvent.click(screen.getByText(/modelProvider.auth.selectModelCredential/))
    expect(screen.queryByRole('button', { name: 'Key 1' })).not.toBeInTheDocument()
  })
})
