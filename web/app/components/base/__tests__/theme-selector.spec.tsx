import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import ThemeSelector from '../theme-selector'

const setTheme = vi.fn()

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'system', setTheme }),
}))

describe('ThemeSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders its trigger in the server HTML', () => {
    const container = document.createElement('div')
    container.innerHTML = renderToString(<ThemeSelector />)

    expect(container.querySelector('button[aria-label="common.theme.theme"]')).not.toBeNull()
  })

  it.each([
    ['common.theme.light', 'light'],
    ['common.theme.dark', 'dark'],
    ['common.theme.auto', 'system'],
  ])('selects %s', async (name, theme) => {
    const user = userEvent.setup()
    render(<ThemeSelector />)

    await user.click(screen.getByRole('button', { name: 'common.theme.theme' }))
    await user.click(await screen.findByRole('menuitemradio', { name }))

    expect(setTheme).toHaveBeenCalledWith(theme)
  })
})
