import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Tooltip from '../tooltip'

it('explains the citation metric with its label and value', async () => {
  const user = userEvent.setup()
  render(<Tooltip data={55} text="Characters" icon={<span aria-hidden />} />)

  await user.hover(screen.getByRole('button', { name: '55' }))

  expect(await screen.findByText('Characters 55')).toBeInTheDocument()
})
