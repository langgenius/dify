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

  it('does not offer file upload for synchronized documents', () => {
    render(<EmptyElement canAdd onClick={vi.fn()} type="sync" />)

    expect(screen.getByText(/list\.empty\.sync\.tip/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
