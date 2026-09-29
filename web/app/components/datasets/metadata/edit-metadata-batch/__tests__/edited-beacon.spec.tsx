import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vite-plus/test'
import EditedBeacon from '../edited-beacon'

it('provides a reset action before any pointer interaction', async () => {
  const user = userEvent.setup()
  const onReset = vi.fn()
  render(<EditedBeacon onReset={onReset} />)

  await user.tab()
  expect(screen.getByRole('button', { name: 'common.operation.reset' })).toHaveFocus()
  await user.keyboard('{Enter}')

  expect(onReset).toHaveBeenCalledOnce()
})
