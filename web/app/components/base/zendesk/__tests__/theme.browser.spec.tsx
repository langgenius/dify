import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ThemeProvider } from '@/features/theme/provider'
import { ThemeSelector } from '@/features/theme/theme-selector'
import { createZendeskRuntime } from '../runtime'
import { ZendeskScript } from '../script'

it('opens with the latest Dify theme and updates the existing widget on theme changes', async () => {
  const previousPreference = localStorage.getItem('theme')
  const previousTheme = document.documentElement.getAttribute('data-theme')
  const previousColorScheme = document.documentElement.style.colorScheme
  localStorage.setItem('theme', 'light')

  const api = vi.fn()
  let sdk: typeof api | undefined
  const runtime = createZendeskRuntime(() => sdk)
  const scripts: HTMLScriptElement[] = []
  const appendChild = document.body.appendChild.bind(document.body)
  // boundary: stand in for the external Zendesk script download and SDK.
  using _appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
    if (!(node instanceof HTMLScriptElement) || node.id !== 'ze-snippet') return appendChild(node)
    scripts.push(node)
    return node
  })

  try {
    await render(
      <ThemeProvider>
        <ThemeSelector />
        <button type="button" onClick={() => void runtime.open('CLOUD')}>
          Contact support
        </button>
        <ZendeskScript runtime={runtime} widgetKey="test-key" />
      </ThemeProvider>,
    )
    const themeTrigger = page.getByRole('button', { name: 'common.theme.label' })
    const selectTheme = async (theme: 'light' | 'dark') => {
      await themeTrigger.click()
      await page.getByRole('menuitemradio', { name: `common.theme.${theme}` }).click()
      await expect.poll(() => document.documentElement.dataset.theme).toBe(theme)
    }

    expect(scripts).toHaveLength(0)

    await page.getByRole('button', { name: 'Contact support' }).click()
    await expect.poll(() => scripts.length).toBe(1)
    await selectTheme('dark')
    expect(api).not.toHaveBeenCalled()
    expect(scripts).toHaveLength(1)

    sdk = api
    scripts[0]!.dispatchEvent(new Event('load'))
    await expect.poll(() => api.mock.lastCall).toEqual(['messenger', 'open'])
    expect(api).toHaveBeenNthCalledWith(1, 'messenger:set', 'customization', {
      theme: expect.objectContaining({ background: '#222225', onBackground: '#fbfbfc' }),
    })

    await selectTheme('light')
    await expect
      .poll(() => api.mock.lastCall)
      .toEqual([
        'messenger:set',
        'customization',
        { theme: expect.objectContaining({ background: '#ffffff', onBackground: '#101828' }) },
      ])
    expect(scripts).toHaveLength(1)
  } finally {
    if (previousPreference === null) localStorage.removeItem('theme')
    else localStorage.setItem('theme', previousPreference)
    if (previousTheme === null) document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', previousTheme)
    document.documentElement.style.colorScheme = previousColorScheme
  }
})
