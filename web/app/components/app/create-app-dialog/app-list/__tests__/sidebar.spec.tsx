import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Sidebar, { AppCategories } from '../sidebar'

describe('Sidebar', () => {
  it('notifies callbacks when items are clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Sidebar current="Cat A" categories={['Cat A']} onClick={onClick} />)

    expect(screen.getByRole('button', { name: 'Cat A' })).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', { name: 'app.newAppFromTemplate.sidebar.Recommended' }),
    ).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByText('app.newAppFromTemplate.sidebar.Recommended'))
    expect(onClick).toHaveBeenCalledWith(AppCategories.RECOMMENDED)

    await user.click(screen.getByText('Cat A'))
    expect(onClick).toHaveBeenCalledWith('Cat A')

    expect(
      screen.queryByRole('button', { name: 'app.newApp.startFromBlank' }),
    ).not.toBeInTheDocument()
  })
})
