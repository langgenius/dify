import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StatusContainer from '../status-container'

describe('StatusContainer', () => {
  it('copies the supplied failure details from the status action', async () => {
    const user = userEvent.setup()
    render(
      <StatusContainer status="failed" copyContent="Execution failed">
        Execution failed
      </StatusContainer>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Execution failed')
    await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))

    expect(await navigator.clipboard.readText()).toBe('Execution failed')
  })
})
