import type { ComponentProps, ReactNode } from 'react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import appDebug from '@/i18n/locales/en-US/app-debug.json'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import GenerativeUIConfig from '../generative-ui-config'

vi.unmock('react-i18next')

beforeEach(async () => {
  await page.viewport(800, 600)
  onTestFinished(guardUnexpectedFetch())
})

async function renderConfig(overrides: Partial<ComponentProps<typeof GenerativeUIConfig>> = {}) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    interpolation: { escapeValue: false },
    resources: { 'en-US': { appDebug } },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
  )
  return render(
    <GenerativeUIConfig
      enabled={false}
      structuredOutputEnabled={false}
      readOnly={false}
      onChange={vi.fn()}
      {...overrides}
    />,
    { wrapper: Wrapper },
  )
}

it('shows the feature explanation on hover instead of beneath the switch label', async () => {
  await renderConfig()

  const control = page.getByRole('switch', { name: 'Generative UI' })
  const explanation = page.getByRole('dialog', { name: 'Generative UI' })
  await expect.element(control).toBeEnabled()
  await expect.element(page.getByText(appDebug['generativeUI.description'])).not.toBeInTheDocument()

  await page.getByRole('button', { name: 'Generative UI' }).hover()
  await expect.element(explanation).toBeVisible()
  await expect.element(explanation).toHaveTextContent(appDebug['generativeUI.description'])

  await control.hover()
  await expect.element(explanation).not.toBeInTheDocument()
})

it('keeps the structured-output explanation keyboard-accessible while the switch is disabled', async () => {
  const onChange = vi.fn()
  await renderConfig({ structuredOutputEnabled: true, onChange })

  const trigger = page.getByRole('button', { name: 'Generative UI' })
  const explanation = page.getByRole('dialog', { name: 'Generative UI' })
  await expect
    .element(page.getByRole('switch', { name: 'Generative UI' }))
    .toHaveAttribute('aria-disabled', 'true')
  await expect
    .element(page.getByText(appDebug['generativeUI.structuredOutputConflict']))
    .not.toBeInTheDocument()

  await userEvent.tab()
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(explanation).toBeVisible()
  await expect
    .element(explanation)
    .toHaveTextContent(appDebug['generativeUI.structuredOutputConflict'])
  expect(onChange).not.toHaveBeenCalled()

  await userEvent.keyboard('{Escape}')
  await expect.element(explanation).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})
