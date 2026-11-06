import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditSlice } from '../edit-slice'

describe('EditSlice', () => {
  const defaultProps = {
    label: 'S1',
    text: 'Sample text content',
    onDelete: vi.fn(),
  }

  it('reveals the remove action on hover and hides it when leaving the slice', async () => {
    const user = userEvent.setup()
    render(<EditSlice {...defaultProps} />)
    expect(
      screen.queryByRole('button', { name: 'common.operation.remove' }),
    ).not.toBeInTheDocument()

    await user.hover(screen.getByText('Sample text content'))
    expect(
      await screen.findByRole('button', { name: 'common.operation.remove' }),
    ).toBeInTheDocument()
    await user.unhover(screen.getByText('Sample text content'))
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'common.operation.remove' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('removes the slice once and closes the action without activating its parent', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const parentClick = vi.fn()
    render(
      <div onClick={parentClick}>
        <EditSlice {...defaultProps} onDelete={onDelete} />
      </div>,
    )

    await user.hover(screen.getByText('Sample text content'))
    await user.click(await screen.findByRole('button', { name: 'common.operation.remove' }))

    expect(onDelete).toHaveBeenCalledOnce()
    expect(parentClick).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'common.operation.remove' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('prevents deleting a disabled slice', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(<EditSlice {...defaultProps} onDelete={onDelete} deleteDisabled />)

    await user.hover(screen.getByText('Sample text content'))
    const remove = await screen.findByRole('button', { name: 'common.operation.remove' })
    expect(remove).toBeDisabled()
    await user.click(remove)
    expect(onDelete).not.toHaveBeenCalled()
  })
})
