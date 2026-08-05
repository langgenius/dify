import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import EditedBeacon from '../edited-beacon'

it('reveals the reset action on hover and invokes it', async () => {
  const onReset = vi.fn()
  const { container } = render(<EditedBeacon onReset={onReset} />)

  fireEvent.mouseEnter(container.firstElementChild!)
  fireEvent.click(await screen.findByRole('button', { name: 'common.operation.reset' }))

  expect(onReset).toHaveBeenCalledOnce()
})
