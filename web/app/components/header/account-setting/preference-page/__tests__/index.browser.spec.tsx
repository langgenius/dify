import type {
  GetAccountProfileResponse,
  PatchAccountProfileData,
} from '@dify/contracts/api/console/account/types.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createDeferred } from '@/test/deferred'
import { timezones } from '@/utils/timezone'
import { ACCOUNT_SETTING_TAB } from '../../constants'
import AccountSetting from '../../index'

const profileRequests = vi.hoisted(() => ({
  update:
    vi.fn<(input: Pick<PatchAccountProfileData, 'body'>) => Promise<GetAccountProfileResponse>>(),
  get: vi.fn<() => Promise<GetAccountProfileResponse>>(),
}))

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: (path: readonly string[], input: Pick<PatchAccountProfileData, 'body'>) => {
      if (path.join('.') === 'account.profile.patch') return profileRequests.update(input)
      if (path.join('.') === 'account.profile.get') return profileRequests.get()
      throw new Error(`Unexpected console request: ${path.join('.')}`)
    },
  },
}))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => 'en-US',
}))
vi.mock('@/i18n/client', () => ({ setLocaleOnClient: vi.fn().mockResolvedValue(undefined) }))
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}))
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const namespaces = {
    accountSettings: (await import('@/i18n/locales/en-US/account-settings.json')).default,
    common: (await import('@/i18n/locales/en-US/common.json')).default,
    navigation: (await import('@/i18n/locales/en-US/navigation.json')).default,
  }
  const translations = Object.fromEntries(
    Object.entries(namespaces).flatMap(([namespace, messages]) =>
      Object.entries(messages).map(([key, value]) => [`${namespace}.${key}`, value]),
    ),
  )
  return { ...actual, ...createReactI18nextMock(translations) }
})

beforeEach(() => {
  profileRequests.update.mockReset()
  profileRequests.get.mockReset()
})

async function renderPreferencesSettings({ width = 1280, timezone = 'Asia/Shanghai' } = {}) {
  await page.viewport(width, 800)
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
  profileRequests.get.mockResolvedValue(profile)
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter>
        <AccountSetting
          activeTab={ACCOUNT_SETTING_TAB.PREFERENCES}
          onCancelAction={vi.fn()}
          onTabChangeAction={vi.fn()}
        />
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  return { screen, queryClient, profile }
}

it.each(['Time Zone', 'Display Language'])(
  'keeps %s and the other profile picker in keyboard order while a save is read-only',
  async (field) => {
    // Chromium exposes lost popup return focus and disabled controls skipped by native Tab.
    const { screen, queryClient, profile } = await renderPreferencesSettings()
    const save = createDeferred<GetAccountProfileResponse>()
    const refetch = createDeferred<GetAccountProfileResponse>()
    profileRequests.update.mockReturnValue(save.promise)
    profileRequests.get.mockReturnValue(refetch.promise)
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
      await expect.poll(() => profileRequests.update.mock.calls.length).toBe(1)
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
        expect(profileRequests.update).toHaveBeenCalledOnce()
        expect(language.element().textContent).toBe(savedLanguage)
        expect(timezone.element().textContent).toBe(savedTimezone)
        await userEvent.keyboard('{Escape}')
        await expect.element(picker).toHaveAttribute('aria-expanded', 'false')
        await expect.element(picker).toHaveFocus()
      }

      if (field === 'Time Zone') {
        const updatedProfile = { ...profile, ...profileRequests.update.mock.calls[0]?.[0].body }
        save.resolve(updatedProfile)
        await expect.poll(() => profileRequests.get.mock.calls.length).toBe(1)
        await expect.element(language).toHaveAttribute('aria-readonly', 'true')
        await expect.element(timezone).toHaveAttribute('aria-readonly', 'true')
        await expectProfileTabOrder('Display Language')
        refetch.resolve(updatedProfile)
        await expect
          .element(timezone)
          .toHaveTextContent(timezones.find((item) => item.value === 'Pacific/Niue')!.name)
      } else {
        save.reject(new Error('Unable to save language'))
      }
      await expect.element(language).not.toHaveAttribute('aria-readonly')
      await expect.element(timezone).not.toHaveAttribute('aria-readonly')

      // Successful saves and failed saves both unlock the next edit.
      profileRequests.update.mockImplementation(async ({ body }) => ({ ...profile, ...body }))
      profileRequests.get.mockImplementation(async () => ({
        ...profile,
        ...profileRequests.update.mock.calls.at(-1)?.[0].body,
      }))
      await choosePreference('Midway')
      await expect.poll(() => profileRequests.update.mock.calls.length).toBe(2)
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

it('keeps full timezone city names readable at 320px without changing the saved selection', async () => {
  // The real Settings sidebar and portal constrain both surfaces. DOM text alone missed clipping.
  const timezone = timezones.find((item) => item.value === 'America/Santo_Domingo')!
  const { screen, queryClient } = await renderPreferencesSettings({
    width: 320,
    timezone: timezone.value,
  })
  try {
    const trigger = screen.getByRole('combobox', { name: 'Time Zone', exact: true })
    const savedValue = trigger.getByText(timezone.name, { exact: true })
    await expect.element(savedValue).toBeVisible()
    expectReadableText(savedValue.element(), trigger.element())

    await trigger.click()
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
    expect(profileRequests.update).not.toHaveBeenCalled()
  } finally {
    await screen.unmount()
    queryClient.clear()
  }
})
