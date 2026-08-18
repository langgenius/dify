import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ApiAccess from '../index'

vi.mock('../card', () => ({
  default: ({ apiEnabled }: { apiEnabled: boolean }) => (
    <div>{apiEnabled ? 'API enabled' : 'API disabled'}</div>
  ),
}))

describe('ApiAccess', () => {
  it('opens the API access details', async () => {
    const user = userEvent.setup()
    render(<ApiAccess expand apiEnabled />)

    await user.click(screen.getByRole('button', { name: 'common.appMenus.apiAccess' }))

    expect(screen.getByText('API enabled')).toBeInTheDocument()
  })
})
