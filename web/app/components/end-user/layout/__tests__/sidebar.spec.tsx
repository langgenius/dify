import { render, screen } from '@testing-library/react'
import Sidebar from '../sidebar'

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/my-apps',
}))

it('links from the end-user sidebar to the existing workspace creation page', () => {
  render(<Sidebar />)

  expect(screen.getByRole('link', { name: 'app.endUser.buildYourOwnApp' })).toHaveAttribute(
    'href',
    '/create-workspace',
  )
  expect(screen.getByRole('link', { name: 'app.endUser.myApps' })).toHaveAttribute(
    'aria-current',
    'page',
  )
})
