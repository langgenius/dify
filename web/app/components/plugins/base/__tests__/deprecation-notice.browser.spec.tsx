import type { ComponentProps } from 'react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import plugin from '@/i18n/locales/en-US/plugin.json'
import DeprecationNotice from '../deprecation-notice'

vi.unmock('react-i18next')

async function renderNotice(overrides: Partial<ComponentProps<typeof DeprecationNotice>> = {}) {
  const i18n = createInstance()
  await i18n.init({ lng: 'en-US', resources: { 'en-US': { plugin } }, keySeparator: false })
  return render(
    <I18nextProvider i18n={i18n}>
      <DeprecationNotice
        status="deleted"
        deprecatedReason="business_adjustments"
        alternativePluginId="better-plugin"
        alternativePluginURL="/plugins/better-plugin"
        {...overrides}
      />
      <button type="button">After notice</button>
    </I18nextProvider>,
  )
}

it('provides a keyboard-accessible replacement link with the translated deprecation reason', async () => {
  await renderNotice()
  const notice = page.getByRole('status')
  await expect.element(notice).toMatchTextContent('deprecated due to business adjustments')
  const replacement = notice.getByRole('link', { name: 'better-plugin' })
  await expect.element(replacement).toHaveAttribute('target', '_blank')
  await userEvent.tab()
  await expect.element(replacement).toHaveFocus()
  await userEvent.tab()
  await expect.element(page.getByRole('button', { name: 'After notice' })).toHaveFocus()
})

it('explains deprecation without offering a replacement when no alternative is available', async () => {
  await renderNotice({
    deprecatedReason: 'no_maintainer',
    alternativePluginId: '',
    alternativePluginURL: '',
  })
  await expect
    .element(page.getByRole('status'))
    .toHaveTextContent(
      'This integration has been deprecated due to no maintainer and will no longer be updated.',
    )
  await expect.element(page.getByRole('link')).not.toBeInTheDocument()
})

it.each(['', 'unknown_reason'])(
  'uses generic guidance for an unavailable reason (%s)',
  async (deprecatedReason) => {
    await renderNotice({ deprecatedReason, alternativePluginId: '', alternativePluginURL: '' })
    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent('This integration has been deprecated and will no longer be updated.')
  },
)

it('leaves active plugins free of deprecation guidance', async () => {
  await renderNotice({ status: 'active' })
  await expect.element(page.getByRole('status')).not.toBeInTheDocument()
  await userEvent.tab()
  await expect.element(page.getByRole('button', { name: 'After notice' })).toHaveFocus()
})
