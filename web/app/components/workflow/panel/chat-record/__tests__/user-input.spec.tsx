import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UserInput from '../user-input'

describe('chat-record UserInput', () => {
  it('returns null when there are no variables', () => {
    const { container } = render(<UserInput />)

    expect(container.firstChild).toBeNull()
  })

  it('toggles the variable list from the header', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <UserInput
        variables={[
          { variable: 'query' },
          { variable: 'locale' },
        ]}
        initialExpanded={false}
      />,
    )

    const header = screen.getByText('WORKFLOW.PANEL.USERINPUTFIELD')
    expect(container.querySelectorAll('.mb-2')).toHaveLength(0)

    await user.click(header)
    expect(container.querySelectorAll('.mb-2')).toHaveLength(2)

    await user.click(header)
    expect(container.querySelectorAll('.mb-2')).toHaveLength(0)
  })
})
