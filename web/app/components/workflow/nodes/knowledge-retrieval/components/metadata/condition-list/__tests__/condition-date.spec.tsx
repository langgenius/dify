import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createAccountProfileQueryWrapper } from '@/test/console/account-profile'
import ConditionDate from '../condition-date'

it('disables both selecting and clearing an unavailable metadata condition', async () => {
  const user = userEvent.setup()
  const changed = vi.fn()
  render(<ConditionDate value={1736947800} onChange={changed} disabled />, {
    wrapper: createAccountProfileQueryWrapper(),
  })
  const trigger = screen.getByRole('button', { name: /datePlaceholder/ })
  const clear = screen.getByRole('button', { name: 'common.operation.clear' })
  expect(trigger).toBeDisabled()
  expect(clear).toBeDisabled()
  await user.click(trigger)
  await user.click(clear)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(changed).not.toHaveBeenCalled()
})
