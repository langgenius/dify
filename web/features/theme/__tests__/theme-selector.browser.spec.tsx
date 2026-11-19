import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ThemeProvider } from '../provider'
import { ThemeSelector } from '../theme-selector'

beforeEach(() => localStorage.removeItem('theme'))
afterEach(() => {
  localStorage.removeItem('theme')
  document.documentElement.dataset.theme = 'light'
})

it('applies and remembers each theme through the real provider and restores menu focus', async () => {
  await page.viewport(1000, 800)
  const screen = await render(
    <ThemeProvider defaultPreference="system">
      <ThemeSelector />
    </ThemeProvider>,
  )
  const trigger = screen.getByRole('button', { name: 'common.theme.label' })
  for (const theme of ['light', 'dark', 'system'] as const) {
    await trigger.click()
    await screen.getByRole('menuitemradio', { name: `common.theme.${theme}` }).click()
    await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    await expect.poll(() => localStorage.getItem('theme')).toBe(theme)
    await expect
      .poll(() => document.documentElement.dataset.theme)
      .toBe(
        theme === 'system'
          ? matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : theme,
      )
    await userEvent.keyboard('{Enter}')
    await expect
      .element(screen.getByRole('menuitemradio', { name: `common.theme.${theme}` }))
      .toHaveAttribute('aria-checked', 'true')
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  }
})
