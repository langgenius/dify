import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IndexBar } from '../index-bar'

it('scrolls only the section matching the selected letter', async () => {
  const user = userEvent.setup()
  const a = document.createElement('section')
  const b = document.createElement('section')
  a.scrollIntoView = vi.fn()
  b.scrollIntoView = vi.fn()

  render(<IndexBar letters={['A', 'B']} itemRefs={{ current: { A: a, B: b } }} />)
  await user.click(screen.getByRole('button', { name: 'B' }))

  expect(b.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' })
  expect(a.scrollIntoView).not.toHaveBeenCalled()
})
