import type { Credential } from '../../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import CredentialItem from './credential-item'

vi.mock('@remixicon/react', () => ({
  RiCheckLine: () => <div data-testid="check-icon" />,
  RiDeleteBinLine: () => <div data-testid="delete-icon" />,
  RiEqualizer2Line: () => <div data-testid="edit-icon" />,
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: () => <div data-testid="indicator" />,
}))

describe('CredentialItem', () => {
  const credential: Credential = {
    credential_id: 'cred-1',
    credential_name: 'Test API Key',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render credential text and indicator', () => {
    render(<CredentialItem credential={credential} />)

    expect(screen.getByText('Test API Key')).toBeInTheDocument()
    expect(screen.getByTestId('indicator')).toBeInTheDocument()
  })

  it('should render enterprise badge for enterprise credential', () => {
    render(<CredentialItem credential={{ ...credential, from_enterprise: true }} />)

    expect(screen.getByText('Enterprise')).toBeInTheDocument()
  })

  it('should call onItemClick when list item is clicked', () => {
    const onItemClick = vi.fn()

    render(<CredentialItem credential={credential} onItemClick={onItemClick} />)

    fireEvent.click(screen.getByText('Test API Key'))

    expect(onItemClick).toHaveBeenCalledWith(credential)
  })

  it('should not call onItemClick when credential is unavailable', () => {
    const onItemClick = vi.fn()

    render(<CredentialItem credential={{ ...credential, not_allowed_to_use: true }} onItemClick={onItemClick} />)

    fireEvent.click(screen.getByText('Test API Key'))

    expect(onItemClick).not.toHaveBeenCalled()
  })

  it('should call onEdit and onDelete from action buttons', () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()

    render(<CredentialItem credential={credential} onEdit={onEdit} onDelete={onDelete} />)

    fireEvent.click(screen.getByTestId('edit-icon').closest('button') as HTMLButtonElement)
    fireEvent.click(screen.getByTestId('delete-icon').closest('button') as HTMLButtonElement)

    expect(onEdit).toHaveBeenCalledWith(credential)
    expect(onDelete).toHaveBeenCalledWith(credential)
  })

  it('should block delete action for the currently selected credential when delete is disabled', () => {
    const onDelete = vi.fn()

    render(
      <CredentialItem
        credential={credential}
        onDelete={onDelete}
        disableDeleteButShowAction
        selectedCredentialId="cred-1"
        disableDeleteTip="Cannot remove selected"
      />,
    )

    fireEvent.click(screen.getByTestId('delete-icon').closest('button') as HTMLButtonElement)

    expect(onDelete).not.toHaveBeenCalled()
  })
})
