import { Dialog } from '@langgenius/dify-ui/dialog'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import appApi from '@/i18n/locales/en-US/app-api.json'
import billing from '@/i18n/locales/en-US/billing.json'
import common from '@/i18n/locales/en-US/common.json'
import education from '@/i18n/locales/en-US/education.json'
import { createFeaturesFixture } from '@/test/console/features-fixture'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, setupFakeApi } from '@/test/fake-api'
import { PricingContent } from '../content'

vi.unmock('react-i18next')

const fake = setupFakeApi(() => ({
  console: { features: { get: () => createFeaturesFixture() } },
}))

async function setup(options: Parameters<typeof createConsoleQueryWrapper>[0] = {}) {
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
    ...options,
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

it('defaults verified students to annual pricing as before the pricing refresh', async () => {
  const screen = await setup({
    features: { education: { enabled: true } },
    educationStatus: { is_student: true, can_redeem_discount: false },
  })
  await expect.element(screen.getByRole('switch', { name: /Bill Annually/ })).toBeChecked()
  await expect
    .element(screen.getByRole('button', { name: education.useEducationDiscount }))
    .toBeEnabled()
})

it('keeps the catalog visible after a request fails and enables purchases on retry', async () => {
  fake.console.features.get.mockRejectedValueOnce(
    apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Unavailable' }),
  )
  const screen = await setup({ features: null })
  const purchase = screen.getByRole('button', { name: 'Start Building' })
  await expect.element(screen.getByRole('alert')).toBeVisible()
  await expect.element(screen.getByText(/\$59/)).toBeVisible()
  await expect.element(purchase).toBeDisabled()
  await screen.getByRole('button', { name: 'Retry' }).click()
  await expect.element(purchase).toBeEnabled()
  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
})

it('opens and dismisses a plan explanation from the restored catalog', async () => {
  const screen = await setup()
  const explanation = billing['plansCommon.documentsTooltip']
  const trigger = screen.getByRole('button', { name: explanation }).first()
  await trigger.click()
  const popup = screen.getByRole('dialog', { name: '50 Knowledge Documents' })
  await expect.element(popup).toMatchTextContent(explanation)
  await userEvent.keyboard('{Escape}')
  await expect.element(popup).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})
