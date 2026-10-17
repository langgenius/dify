import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EmptyElement from '../empty-element'

describe('EmptyElement', () => {
  it('adds a document from the upload empty state', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<EmptyElement canAdd onClick={onClick} type="upload" />)

    await user.click(screen.getByRole('button', { name: /list\.addFile/i }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it.each([
    { type: 'sync' as const, canAdd: true },
    { type: 'upload' as const, canAdd: false },
  ])('does not offer upload for $type documents with canAdd=$canAdd', ({ type, canAdd }) => {
    render(<EmptyElement canAdd={canAdd} onClick={vi.fn()} type={type} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
