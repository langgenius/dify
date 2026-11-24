import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import accountSettings from '@/i18n/locales/en-US/account-settings.json'
import common from '@/i18n/locales/en-US/common.json'
import navigation from '@/i18n/locales/en-US/navigation.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createDeferred } from '@/test/deferred'
import { apiError, hold, installFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { timezones } from '@/utils/timezone'
import { ACCOUNT_SETTING_TAB } from '../../constants'
import AccountSetting from '../../index'

vi.unmock('react-i18next')

async function renderPreferencesSettings({ width = 1280, timezone = 'Asia/Shanghai' } = {}) {
  await page.viewport(width, 800)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    fallbackLng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { accountSettings, common, navigation } },
  })
  const profile: GetAccountProfileResponse = {
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    avatar: '',
    avatar_url: null,
    is_password_set: false,
    timezone,
    interface_language: 'en-US',
  }
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: profile,
    currentWorkspace: { role: 'owner' },
    systemFeatures: { deployment_edition: 'CLOUD', rbac_enabled: false },
  })
  let savedProfile = profile
  const fake = installFakeApi({
    console: {
      account: {
        profile: {
          get: () => savedProfile,
          patch: ({ body }) => (savedProfile = { ...savedProfile, ...body }),
        },
      },
    },
  })
  onTestFinished(fake)
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <I18nextProvider i18n={i18n}>
        <NuqsTestingAdapter>
          <AccountSetting
            activeTab={ACCOUNT_SETTING_TAB.PREFERENCES}
            onCancelAction={vi.fn()}
            onTabChangeAction={vi.fn()}
          />
        </NuqsTestingAdapter>
      </I18nextProvider>
    </QueryClientTestProvider>,
    { wrapper: createTestNavigation({ url: '/account/settings' }).NavigationProvider },
  )
  return { screen, queryClient, profile, profileApi: fake.console.account.profile }
}

it.each(['Time Zone', 'Display Language'])(
  'keeps %s and the other profile picker in keyboard order while a save is read-only',
  async (field) => {
    // Chromium exposes lost popup return focus and disabled controls skipped by native Tab.
    const { screen, queryClient, profile, profileApi } = await renderPreferencesSettings()
    const refetch = createDeferred<GetAccountProfileResponse>()
    const save = hold(profileApi.patch)
    const appearance = screen.getByRole('combobox', { name: 'Appearance', exact: true })
    const language = screen.getByRole('combobox', { name: 'Display Language', exact: true })
    const timezone = screen.getByRole('combobox', { name: 'Time Zone', exact: true })
    const trigger = field === 'Time Zone' ? timezone : language

    async function expectProfileTabOrder(startingField: string) {
      if (startingField === 'Display Language') {
        await userEvent.tab()
        await expect.element(timezone).toHaveFocus()
      }
      await userEvent.tab({ shift: true })
      await expect.element(language).toHaveFocus()
      await userEvent.tab({ shift: true })
      await expect.element(appearance).toHaveFocus()
      await userEvent.tab()
      await expect.element(language).toHaveFocus()
      await userEvent.tab()
      await expect.element(timezone).toHaveFocus()
    }

    async function choosePreference(timezoneQuery = 'Niue') {
      await trigger.click()
      if (field === 'Time Zone') {
        const search = screen.getByRole('combobox', { name: 'Search cities or time zones...' })
        await search.fill(timezoneQuery)
        await expect
          .element(screen.getByRole('option', { name: new RegExp(timezoneQuery) }))
          .toBeVisible()
        await userEvent.keyboard('{ArrowDown}')
        await expect.element(search).toHaveAttribute('aria-activedescendant')
      } else {
        await expect.element(screen.getByRole('listbox')).toBeVisible()
        await expect.element(screen.getByRole('option', { selected: true })).toHaveFocus()
        await userEvent.keyboard('{End}')
        await expect.element(screen.getByRole('option').last()).toHaveFocus()
      }
      await userEvent.keyboard('{Enter}')
      await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
    }

    try {
      const savedLanguage = language.element().textContent
      const savedTimezone = timezone.element().textContent
      await choosePreference()
      await expect.element(trigger).toHaveFocus()
      await expect.element(language).toHaveAttribute('aria-readonly', 'true')
      await expect.element(timezone).toHaveAttribute('aria-readonly', 'true')
      await expect.poll(() => profileApi.patch.mock.calls.length).toBe(1)
      await expectProfileTabOrder(field)

      // Both popup implementations remain browsable, but neither may commit a second value.
      for (const picker of [timezone, language]) {
        await picker.click()
        await expect.element(picker).toHaveAttribute('aria-expanded', 'true')
        const option =
          picker === timezone
            ? screen.getByRole('option', {
                name: timezones.find((item) => item.value === 'Pacific/Midway')!.name,
              })
            : screen.getByRole('option').last()
        await expect.element(option).toBeVisible()
        await option.click()
        expect(profileApi.patch).toHaveBeenCalledOnce()
        expect(language.element().textContent).toBe(savedLanguage)
        expect(timezone.element().textContent).toBe(savedTimezone)
        await userEvent.keyboard('{Escape}')
        await expect.element(picker).toHaveAttribute('aria-expanded', 'false')
        await expect.element(picker).toHaveFocus()
      }

      if (field === 'Time Zone') {
        const updatedProfile = { ...profile, ...profileApi.patch.mock.calls[0]?.[0].body }
        profileApi.get.mockReturnValueOnce(refetch.promise)
        save.resolve(updatedProfile)
        await expect.poll(() => profileApi.get.mock.calls.length).toBe(1)
        await expect.element(language).toHaveAttribute('aria-readonly', 'true')
        await expect.element(timezone).toHaveAttribute('aria-readonly', 'true')
        await expectProfileTabOrder('Display Language')
        refetch.resolve(updatedProfile)
        await expect
          .element(timezone)
          .toHaveTextContent(timezones.find((item) => item.value === 'Pacific/Niue')!.name)
      } else {
        save.reject(
          apiError({
            status: 503,
            code: 'SERVICE_UNAVAILABLE',
            message: 'Unable to save language',
          }),
        )
      }
      await expect.element(language).not.toHaveAttribute('aria-readonly')
      await expect.element(timezone).not.toHaveAttribute('aria-readonly')

      // Successful saves and failed saves both unlock the next edit.
      await choosePreference('Midway')
      await expect.poll(() => profileApi.patch.mock.calls.length).toBe(2)
      await expect.element(trigger).toHaveFocus()
      await expect.element(trigger).not.toHaveAttribute('aria-readonly')
    } finally {
      await screen.unmount()
      queryClient.clear()
    }
  },
)

function expectReadableText(text: Element, control: Element) {
  const bounds = control.getBoundingClientRect()
  const range = document.createRange()
  range.selectNodeContents(text)
  const fragments = range.getClientRects()
  expect(fragments.length).toBeGreaterThan(0)
  for (const fragment of fragments) {
    expect(fragment.left).toBeGreaterThanOrEqual(bounds.left - 1)
    expect(fragment.right).toBeLessThanOrEqual(bounds.right + 1)
    expect(fragment.top).toBeGreaterThanOrEqual(bounds.top - 1)
    expect(fragment.bottom).toBeLessThanOrEqual(bounds.bottom + 1)
  }
}

it('keeps full timezone options readable at 320px without changing the saved selection', async () => {
  // The real Settings sidebar and portal constrain both surfaces. DOM text alone missed clipping.
  const timezone = timezones.find((item) => item.value === 'America/Santo_Domingo')!
  const { screen, queryClient, profileApi } = await renderPreferencesSettings({
    width: 320,
    timezone: timezone.value,
  })
  try {
    const trigger = screen.getByRole('combobox', { name: 'Time Zone', exact: true })
    const savedValue = trigger.getByText(timezone.name, { exact: true })
    await expect.element(savedValue).toBeVisible()

    await trigger.click()
    const selected = screen.getByRole('option', { name: timezone.name, selected: true })
    await expect.element(selected).toBeVisible()
    expectReadableText(
      selected.getByText(timezone.name, { exact: true }).element(),
      selected.element(),
    )

    const search = screen.getByRole('combobox', { name: 'Search cities or time zones...' })
    await search.fill('Central European')
    const matches = timezones.filter((item) => item.name.includes('Central European'))
    await expect.element(screen.getByRole('option', { name: matches[0]!.name })).toBeVisible()
    for (const item of matches) {
      const option = screen.getByRole('option', { name: item.name, exact: true })
      expectReadableText(option.getByText(item.name, { exact: true }).element(), option.element())
    }

    await userEvent.keyboard('{Escape}')
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect.element(trigger).toHaveFocus()
    await expect.element(savedValue).toBeVisible()
    expect(profileApi.patch).not.toHaveBeenCalled()
  } finally {
    await screen.unmount()
    queryClient.clear()
  }
})
