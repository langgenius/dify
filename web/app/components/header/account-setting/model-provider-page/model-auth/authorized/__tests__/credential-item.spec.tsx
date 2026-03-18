import type { Credential } from '../../../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import CredentialItem from '../credential-item'

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

    const buttons = screen.getAllByRole('button')
    const editButton = buttons.find(b => b.querySelector('.i-ri-equalizer-2-line'))!
    const deleteButton = buttons.find(b => b.querySelector('.i-ri-delete-bin-line'))!

    fireEvent.click(editButton)
    fireEvent.click(deleteButton)

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

    const deleteButton = screen.getAllByRole('button')
      .find(b => b.querySelector('.i-ri-delete-bin-line'))!

    fireEvent.click(deleteButton)

    expect(onDelete).not.toHaveBeenCalled()
  })

  // All disable flags true → no action buttons rendered
  it('should hide all action buttons when disableRename, disableEdit, and disableDelete are all true', () => {
    // Act
    render(
      <CredentialItem
        credential={credential}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        disableRename
        disableEdit
        disableDelete
      />,
    )

    // Assert
    expect(screen.queryByTestId('edit-icon')).not.toBeInTheDocument()
    expect(screen.queryByTestId('delete-icon')).not.toBeInTheDocument()
  })

  // disabled=true guards: clicks on the item row and on delete should both be no-ops
  it('should not call onItemClick when disabled=true and item is clicked', () => {
    const onItemClick = vi.fn()

    render(<CredentialItem credential={credential} disabled onItemClick={onItemClick} />)

    fireEvent.click(screen.getByText('Test API Key'))

    expect(onItemClick).not.toHaveBeenCalled()
  })

  it('should not call onDelete when disabled=true and delete button is clicked', () => {
    const onDelete = vi.fn()

    render(<CredentialItem credential={credential} disabled onDelete={onDelete} />)

    const deleteButton = screen.getAllByRole('button')
      .find(b => b.querySelector('.i-ri-delete-bin-line'))!
    fireEvent.click(deleteButton)

    expect(onDelete).not.toHaveBeenCalled()
  })

  // showSelectedIcon=true: check icon area is always rendered; check icon only appears when IDs match
  it('should render check icon area when showSelectedIcon=true and selectedCredentialId matches', () => {
    const { container } = render(
      <CredentialItem
        credential={credential}
        showSelectedIcon
        selectedCredentialId="cred-1"
      />,
    )

    expect(container.querySelector('.i-ri-check-line')).toBeInTheDocument()
  })

  it('should not render check icon when showSelectedIcon=true but selectedCredentialId does not match', () => {
    render(
      <CredentialItem
        credential={credential}
        showSelectedIcon
        selectedCredentialId="other-cred"
      />,
    )

    expect(screen.queryByTestId('check-icon')).not.toBeInTheDocument()
  })
})
