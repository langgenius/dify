import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ApiAccess from '../index'

vi.mock('../card', () => ({
  default: ({ apiEnabled }: { apiEnabled: boolean }) => (
    <div>{apiEnabled ? 'API enabled' : 'API disabled'}</div>
  ),
}))

describe('ApiAccess', () => {
  it.each([true, false])(
    'opens named API access details by keyboard when expanded=%s',
    async (expand) => {
      const user = userEvent.setup()
      render(<ApiAccess expand={expand} apiEnabled />)

      const trigger = screen.getByRole('button', { name: 'common.appMenus.apiAccess' })
      expect(trigger).not.toHaveAttribute('data-popup-open')

      await user.tab()
      expect(trigger).toHaveFocus()
      await user.keyboard('{Enter}')

      expect(trigger).toHaveAttribute('data-popup-open', '')

      expect(screen.getByText('API enabled')).toBeInTheDocument()
    },
  )
})
