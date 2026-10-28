import type { Credential } from '../../../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CredentialItem from '../credential-item'

describe('CredentialItem', () => {
  const credential: Credential = {
    credential_id: 'cred-1',
    credential_name: 'Test API Key',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('selects an enterprise credential when its badge is clicked', async () => {
    const user = userEvent.setup()
    const onItemClick = vi.fn()
    const enterpriseCredential = { ...credential, from_enterprise: true }

    render(<CredentialItem credential={enterpriseCredential} onItemClick={onItemClick} />)

    await user.click(screen.getByText('Enterprise'))

    expect(onItemClick).toHaveBeenCalledWith(enterpriseCredential)
  })

  it('selects a credential with the keyboard and exposes its selected state', async () => {
    const user = userEvent.setup()
    const onItemClick = vi.fn()

    render(
      <CredentialItem
        credential={credential}
        onItemClick={onItemClick}
        showSelectedIcon
        selectedCredentialId="cred-1"
      />,
    )

    const option = screen.getByRole('button', { name: 'Test API Key' })
    expect(option).toHaveAttribute('aria-pressed', 'true')
    await user.tab()
    expect(option).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onItemClick).toHaveBeenCalledWith(credential)
  })

  it('keeps edit and delete reachable by keyboard without hovering', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    const onDelete = vi.fn()

    render(<CredentialItem credential={credential} onEdit={onEdit} onDelete={onDelete} />)

    await user.tab()
    const editButton = screen.getByRole('button', { name: 'common.operation.edit' })
    expect(editButton).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onEdit).toHaveBeenCalledWith(credential)

    await user.tab()
    const deleteButton = screen.getByRole('button', { name: 'common.operation.delete' })
    expect(deleteButton).toHaveFocus()
    await user.keyboard(' ')
    expect(onDelete).toHaveBeenCalledWith(credential)
  })

  it('should not call onItemClick when credential is unavailable', () => {
    const onItemClick = vi.fn()

    render(
      <CredentialItem
        credential={{ ...credential, not_allowed_to_use: true }}
        onItemClick={onItemClick}
      />,
    )

    fireEvent.click(screen.getByText('Test API Key'))

    expect(onItemClick).not.toHaveBeenCalled()
  })

  it('keeps the selected credential delete action focusable but disabled', async () => {
    const user = userEvent.setup()
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

    const deleteButton = screen.getByRole('button', { name: 'common.operation.delete' })

    expect(deleteButton).toHaveAttribute('aria-disabled', 'true')
    await user.tab()
    await user.tab()
    expect(deleteButton).toHaveFocus()
    await user.click(deleteButton)

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
    expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.delete' }),
    ).not.toBeInTheDocument()
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

    const deleteButton = screen.getByRole('button', { name: 'common.operation.delete' })
    expect(deleteButton).toBeDisabled()
    fireEvent.click(deleteButton)

    expect(onDelete).not.toHaveBeenCalled()
  })
})
