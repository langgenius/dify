import { fireEvent, render, screen } from '@testing-library/react'
import CredentialSelector from './credential-selector'

// Mock components
vi.mock('./authorized/credential-item', () => ({
  default: ({ credential, onItemClick }: { credential: { credential_name: string }, onItemClick: (c: unknown) => void }) => (
    <div data-testid="credential-item" onClick={() => onItemClick(credential)}>
      {credential.credential_name}
    </div>
  ),
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: () => <div data-testid="indicator" />,
}))

vi.mock('@remixicon/react', () => ({
  RiAddLine: () => <div data-testid="add-icon" />,
  RiArrowDownSLine: () => <div data-testid="arrow-icon" />,
}))

// Mock portal components
vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => (
    <div data-testid="portal" data-open={open}>{children}</div>
  ),
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => (
    <div data-testid="portal-trigger" onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode, open?: boolean }) => {
    // We should only render children if open or if we want to test they are hidden
    // The real component might handle this with CSS or conditional rendering.
    // Let's use conditional rendering in the mock to avoid "multiple elements" errors.
    return <div data-testid="portal-content">{children}</div>
  },
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

  it('should render selected credential name', () => {
    render(
      <CredentialSelector
        selectedCredential={mockCredentials[0]}
        credentials={mockCredentials}
        onSelect={mockOnSelect}
      />,
    )

    // Use getAllByText and take the first one (the one in the trigger)
    expect(screen.getAllByText('Key 1')[0]).toBeInTheDocument()
    expect(screen.getByTestId('indicator')).toBeInTheDocument()
  })

  it('should render placeholder when no credential selected', () => {
    render(
      <CredentialSelector
        credentials={mockCredentials}
        onSelect={mockOnSelect}
      />,
    )

    expect(screen.getByText(/modelProvider.auth.selectModelCredential/)).toBeInTheDocument()
  })

  it('should open portal on click', () => {
    render(
      <CredentialSelector
        credentials={mockCredentials}
        onSelect={mockOnSelect}
      />,
    )

    fireEvent.click(screen.getByTestId('portal-trigger'))
    expect(screen.getByTestId('portal')).toHaveAttribute('data-open', 'true')
    expect(screen.getAllByTestId('credential-item')).toHaveLength(2)
  })

  it('should call onSelect when a credential is clicked', () => {
    render(
      <CredentialSelector
        credentials={mockCredentials}
        onSelect={mockOnSelect}
      />,
    )

    fireEvent.click(screen.getByTestId('portal-trigger'))
    fireEvent.click(screen.getByText('Key 2'))

    expect(mockOnSelect).toHaveBeenCalledWith(mockCredentials[1])
  })

  it('should call onSelect with add new credential data when clicking add button', () => {
    render(
      <CredentialSelector
        credentials={mockCredentials}
        onSelect={mockOnSelect}
      />,
    )

    fireEvent.click(screen.getByTestId('portal-trigger'))
    fireEvent.click(screen.getByText(/modelProvider.auth.addNewModelCredential/))

    expect(mockOnSelect).toHaveBeenCalledWith(expect.objectContaining({
      credential_id: '__add_new_credential',
      addNewCredential: true,
    }))
  })

  it('should not open portal when disabled', () => {
    render(
      <CredentialSelector
        disabled
        credentials={mockCredentials}
        onSelect={mockOnSelect}
      />,
    )

    fireEvent.click(screen.getByTestId('portal-trigger'))
    expect(screen.getByTestId('portal')).toHaveAttribute('data-open', 'false')
  })
})
