import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import accountSettings from '@/i18n/locales/en-US/account-settings.json'
import appLog from '@/i18n/locales/en-US/app-log.json'
import billing from '@/i18n/locales/en-US/billing.json'
import common from '@/i18n/locales/en-US/common.json'
import contacts from '@/i18n/locales/en-US/contacts.json'
import custom from '@/i18n/locales/en-US/custom.json'
import education from '@/i18n/locales/en-US/education.json'
import navigation from '@/i18n/locales/en-US/navigation.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, hold, setupFakeApi } from '@/test/fake-api'
import { SettingsModal } from '../settings-modal'

vi.unmock('react-i18next')

const storageError = apiError({
  status: 503,
  message: 'Unable to retrieve billing information. Please try again later or contact support.',
})

const fake = setupFakeApi({
  console: {
    features: {
      vectorSpace: {
        get: () => {
          throw storageError
        },
      },
    },
  },
})

it('keeps the billing deep link usable when storage usage cannot load', async () => {
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'normal' },
    features: { billing: { subscription: { plan: 'team' } }, apps: { size: 17, limit: 50 } },
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  onTestFinished(() => queryClient.clear())
  const request = hold(fake.console.features.vectorSpace.get)
  await render(
    <Providers>
      <I18nClientProvider
        locale="en-US"
        resource={{
          'en-US': {
            accountSettings,
            appLog,
            billing,
            common,
            contacts,
            custom,
            education,
            navigation,
          },
        }}
      >
        <NuqsTestingAdapter searchParams="?settings=billing">
          <SettingsModal />
        </NuqsTestingAdapter>
      </I18nClientProvider>
    </Providers>,
  )

  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect.element(dialog.getByRole('heading', { name: 'Billing' })).toBeVisible()
  await request.arrived
  await expect.element(dialog.getByRole('progressbar', { name: 'Loading' })).toBeVisible()
  request.reject(storageError)

  const storage = dialog.getByRole('group', { name: 'Knowledge Data Storage' })
  await expect.element(storage.getByText(billing['errors.unavailable'])).toBeVisible()
  await expect.element(storage.getByRole('meter')).not.toBeInTheDocument()
  await expect.element(dialog.getByRole('heading', { name: 'Team' })).toBeVisible()
  const apps = dialog.getByRole('group', { name: 'Build Apps' })
  await expect.element(apps.getByText('17')).toBeVisible()
  await expect.element(apps.getByText('50')).toBeVisible()
})
