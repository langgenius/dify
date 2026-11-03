import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expectLoadingButton } from '@/test/button'
import RenameModal from '../rename-modal'

describe('RenameModal', () => {
  const defaultProps = {
    isShow: true,
    saveLoading: false,
    name: 'Original Name',
    onClose: vi.fn(),
    onSave: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls onClose when cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<RenameModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('calls onSave with updated name', async () => {
    const user = userEvent.setup()
    render(<RenameModal {...defaultProps} />)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Updated Name')
    await user.keyboard('{Enter}')

    expect(defaultProps.onSave).toHaveBeenCalledWith('Updated Name')
  })

  it('does not resubmit while save is pending', async () => {
    const user = userEvent.setup()
    render(<RenameModal {...defaultProps} saveLoading />)

    const save = screen.getByRole('button', { name: 'common.operation.save' })
    expectLoadingButton(save)
    await user.click(save)
    await user.click(screen.getByRole('textbox', { name: 'common.chat.conversationName' }))
    await user.keyboard('{Enter}')

    expect(defaultProps.onSave).not.toHaveBeenCalled()
  })

  it('calls onSave with initial name when unchanged', async () => {
    const user = userEvent.setup()
    render(<RenameModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(defaultProps.onSave).toHaveBeenCalledWith('Original Name')
  })

  it('keeps edited name when parent rerenders with different name prop', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<RenameModal {...defaultProps} name="First" />)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Edited')

    rerender(<RenameModal {...defaultProps} name="Second" />)
    expect(screen.getByRole('textbox')).toHaveValue('Edited')
  })

  it('retains a draft name after the dialog closes and reopens', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<RenameModal {...defaultProps} isShow />)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Changed')

    rerender(<RenameModal {...defaultProps} isShow={false} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    rerender(<RenameModal {...defaultProps} isShow />)

    expect(screen.getByRole('textbox')).toHaveValue('Changed')
  })
})
