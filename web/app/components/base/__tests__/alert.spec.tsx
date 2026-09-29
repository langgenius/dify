import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Alert from '../alert'

describe('Alert', () => {
  it('shows its message and can be dismissed', async () => {
    const user = userEvent.setup()
    const onHide = vi.fn()
    render(<Alert message="Connection lost" onHide={onHide} />)

    expect(screen.getByText('Connection lost')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(onHide).toHaveBeenCalledOnce()
  })
})
