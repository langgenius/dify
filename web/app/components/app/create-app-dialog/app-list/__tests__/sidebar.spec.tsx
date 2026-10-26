import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Sidebar, { AppCategories } from '../sidebar'

describe('Sidebar', () => {
  it('notifies callbacks when items are clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const onCreate = vi.fn()
    render(
      <Sidebar
        current="Cat A"
        categories={['Cat A']}
        onClick={onClick}
        onCreateFromBlank={onCreate}
      />,
    )

    expect(screen.getByRole('button', { name: 'Cat A' })).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', { name: 'app.newAppFromTemplate.sidebar.Recommended' }),
    ).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByText('app.newAppFromTemplate.sidebar.Recommended'))
    expect(onClick).toHaveBeenCalledWith(AppCategories.RECOMMENDED)

    await user.click(screen.getByText('Cat A'))
    expect(onClick).toHaveBeenCalledWith('Cat A')

    await user.click(screen.getByText('app.newApp.startFromBlank'))
    expect(onCreate).toHaveBeenCalled()
  })
})
