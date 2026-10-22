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
  'keeps keyboard focus on %s through saving and refetching without accepting another change',
  async (field) => {
    // Native disabled triggers lost popup return focus in Chromium; happy-dom retained it.
    const { screen, queryClient, profile } = await renderPreferencesSettings()
    const save = createDeferred<GetAccountProfileResponse>()
    const refetch = createDeferred<GetAccountProfileResponse>()
    profileRequests.update.mockReturnValue(save.promise)
    profileRequests.get.mockReturnValue(refetch.promise)

    try {
      const trigger = screen.getByRole('combobox', { name: field, exact: true })
      await trigger.click()
      if (field === 'Time Zone') {
        const search = screen.getByRole('combobox', { name: 'Search cities or time zones...' })
        await search.fill('Niue')
        await expect.element(screen.getByRole('option', { name: /Niue Time/ })).toBeVisible()
        await userEvent.keyboard('{ArrowDown}')
        await expect.element(search).toHaveAttribute('aria-activedescendant')
      } else {
        await expect.element(screen.getByRole('listbox')).toBeVisible()
        await userEvent.keyboard('{End}')
        await expect.element(screen.getByRole('option').last()).toHaveFocus()
      }
      await userEvent.keyboard('{Enter}')

      await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
      await expect.element(trigger).toHaveFocus()
      await expect.element(trigger).toHaveAttribute('aria-disabled', 'true')
      await expect.poll(() => profileRequests.update.mock.calls.length).toBe(1)
      await userEvent.keyboard('{Enter} {ArrowDown}')
      await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
      expect(profileRequests.update).toHaveBeenCalledOnce()

      const updatedProfile = { ...profile, ...profileRequests.update.mock.calls[0]?.[0].body }
      save.resolve(updatedProfile)
      await expect.poll(() => profileRequests.get.mock.calls.length).toBe(1)
      await expect.element(trigger).toHaveFocus()
      await expect.element(trigger).toHaveAttribute('aria-disabled', 'true')

      refetch.resolve(updatedProfile)
      await expect.element(trigger).toHaveAttribute('aria-disabled', 'false')
      await expect.element(trigger).toHaveFocus()
      await userEvent.tab({ shift: true })
      await expect
        .element(
          screen.getByRole('combobox', {
            name: field === 'Time Zone' ? 'Display Language' : 'Appearance',
            exact: true,
          }),
        )
        .toHaveFocus()
    } finally {
      await screen.unmount()
      queryClient.clear()
    }
  },
)
