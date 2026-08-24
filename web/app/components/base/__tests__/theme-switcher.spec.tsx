import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ThemeSwitcher from '../theme-switcher'

const setTheme = vi.fn()

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'system', setTheme }),
}))

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['System theme', 'system'],
    ['Light theme', 'light'],
    ['Dark theme', 'dark'],
  ])('selects %s', async (name, theme) => {
    const user = userEvent.setup()
    render(<ThemeSwitcher />)

    await user.click(screen.getByRole('button', { name }))

    expect(setTheme).toHaveBeenCalledWith(theme)
  })
})
