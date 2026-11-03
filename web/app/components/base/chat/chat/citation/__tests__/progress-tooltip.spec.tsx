import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProgressTooltip from '../progress-tooltip'

it('explains the current citation score and updates it when the citation changes', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<ProgressTooltip data={0.3} />)
  await user.hover(screen.getByRole('button', { name: '0.3' }))
  expect(await screen.findByText('common.chat.citation.hitScore 0.3')).toBeInTheDocument()

  rerender(<ProgressTooltip data={0.9} />)
  expect(screen.getByRole('button', { name: '0.9' })).toBeInTheDocument()
  expect(await screen.findByText('common.chat.citation.hitScore 0.9')).toBeInTheDocument()
})
