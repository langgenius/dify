import { Dialog } from '@langgenius/dify-ui/dialog'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import appApi from '@/i18n/locales/en-US/app-api.json'
import billing from '@/i18n/locales/en-US/billing.json'
import common from '@/i18n/locales/en-US/common.json'
import education from '@/i18n/locales/en-US/education.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { PricingContent } from '../content'

vi.unmock('react-i18next')

async function setup() {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { appApi, billing, common, education } },
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
    features: {},
  })
  onTestFinished(() => queryClient.clear())
  return render(
    <Providers>
      <I18nextProvider i18n={i18n}>
        <Dialog>
          <PricingContent />
        </Dialog>
      </I18nextProvider>
    </Providers>,
  )
}

it('switches between the restored Cloud and Self-Hosted catalogs', async () => {
  const screen = await setup()
  const annualBilling = screen.getByRole('switch', { name: 'Bill Annually Save 17%' })
  await expect.element(annualBilling).not.toBeChecked()
  await annualBilling.click()
  for (const price of [/\$708/, /\$590/, /\$1908/, /\$1590/]) {
    await expect.element(screen.getByText(price)).toBeVisible()
  }

  await screen.getByRole('tab', { name: 'Self-Hosted' }).click()
  await expect.element(screen.getByRole('heading', { name: 'Community' })).toBeVisible()
  await expect.element(annualBilling).not.toBeInTheDocument()
  await screen.getByRole('tab', { name: 'Cloud Service' }).click()
  await expect.element(annualBilling).toBeChecked()
  await expect.element(screen.getByText(/\$590/)).toBeVisible()
})
