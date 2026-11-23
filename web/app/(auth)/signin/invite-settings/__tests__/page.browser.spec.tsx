import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import AuthLayout from '@/app/(auth)/layout'
import accountSettings from '@/i18n/locales/zh-Hans/account-settings.json'
import common from '@/i18n/locales/zh-Hans/common.json'
import login from '@/i18n/locales/zh-Hans/login.json'
import { getInitOptions } from '@/i18n/settings'
import { consoleQuery } from '@/service/console'
import { emulateTimezone } from '@/test/browser-media-emulation'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { installFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import InviteSettingsPage from '../page'

vi.unmock('react-i18next')

// boundary: the browser fixture owns its locale and skips persisting a locale cookie.
vi.mock('@/i18n/client', () => ({ setLocaleOnClient: vi.fn().mockResolvedValue(undefined) }))

const workspaceName = "invitee@example.com's Workspace"

async function renderInvitation() {
  // Pin the browser's own timezone so the default invitation timezone is deterministic.
  await emulateTimezone('Asia/Taipei')
  const i18n = createInstance()
  await i18n.init({
    ...getInitOptions(['accountSettings', 'common', 'login']),
    lng: 'zh-Hans',
    resources: { 'zh-Hans': { accountSettings, common, login } },
  })
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: null,
    systemFeatures: { branding: { enabled: false }, deployment_edition: 'CLOUD' },
  })
  queryClient.setQueryData(
    consoleQuery.activate.check.get.queryKey({ input: { query: { token: 'invite-token' } } }),
    {
      is_valid: true,
      data: {
        email: 'invitee@example.com',
        workspace_id: 'workspace-id',
        workspace_name: workspaceName,
        requires_setup: true,
        is_current_account: true,
      },
    },
  )
  const fake = installFakeApi({
    console: {
      activate: { post: () => ({ result: 'success' }) },
    },
  })
  onTestFinished(fake)
  const navigation = createTestNavigation({
    url: '/signin/invite-settings?invite_token=invite-token',
  })
  const { NavigationProvider } = navigation
  const screen = await render(
    <NavigationProvider>
      <QueryClientTestProvider queryClient={queryClient}>
        <I18nextProvider i18n={i18n}>
          <AuthLayout>
            <InviteSettingsPage />
          </AuthLayout>
        </I18nextProvider>
      </QueryClientTestProvider>
    </NavigationProvider>,
  )

  return { screen, queryClient, activate: fake.console.activate.post, navigation }
}

it('selects highlighted options with Enter and submits the confirmed preferences', async () => {
  await page.viewport(620, 740)
  const { screen, queryClient, activate, navigation } = await renderInvitation()
  try {
    const name = screen.getByRole('textbox', { name: login.name })
    const language = screen.getByRole('combobox', { name: login.interfaceLanguage })
    const timezone = screen.getByRole('combobox', { name: login.timezone, exact: true })
    const submit = screen.getByRole('button', {
      name: login.joinWorkspace.replace('{{workspaceName}}', workspaceName),
    })
    await name.fill('邀请测试')
    const formField = name.element().getBoundingClientRect()
    for (const picker of [language, timezone]) {
      const bounds = picker.element().getBoundingClientRect()
      expect(bounds.width).toBeCloseTo(formField.width)
      expect(bounds.height).toBeCloseTo(formField.height)
    }
    const expectListAlignedWithForm = async () => {
      const list = screen.getByRole('listbox')
      await expect.element(list).toBeVisible()
      // The list sits inside the popup border.
      await expect
        .poll(() => Math.abs(list.element().getBoundingClientRect().width - formField.width), {
          timeout: 2000,
        })
        .toBeLessThanOrEqual(2)
    }
    await expect
      .element(timezone)
      .toHaveTextContent('+08:00 Taipei Time - Taipei, Kaohsiung, Taichung, Tainan')
    await expect
      .element(screen.getByRole('link', { name: login['license.link'] }))
      .not.toBeInTheDocument()

    await expect.element(language).toHaveTextContent('简体中文')
    await language.click()
    await expect
      .element(screen.getByRole('option', { name: '简体中文', selected: true }))
      .toHaveFocus()
    await expectListAlignedWithForm()
    await userEvent.keyboard('{Home}')
    await expect
      .element(screen.getByRole('option', { name: 'English (United States)' }))
      .toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(language).toHaveTextContent('English (United States)')
    expect(activate).not.toHaveBeenCalled()

    await timezone.click()
    const timezoneSearch = screen
      .getByRole('dialog', { name: login.timezone })
      .getByRole('combobox', { name: accountSettings['account.timezoneSearchPlaceholder'] })
    await expect.element(timezoneSearch).toHaveFocus()
    await timezoneSearch.fill('Pacific/Niue')
    const niue = screen.getByRole('option', { name: /Niue/ })
    await expect.element(niue).toBeVisible()
    await expectListAlignedWithForm()
    const niueLabel = niue.element().textContent ?? ''
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(timezoneSearch).toHaveAttribute('aria-activedescendant')
    await userEvent.keyboard('{Enter}')
    await expect.element(timezone).toHaveTextContent(niueLabel)
    await expect.element(timezone).toHaveFocus()
    expect(activate).not.toHaveBeenCalled()

    await page.viewport(320, 740)
    await submit.click()
    await expect.poll(() => navigation.router.replace.mock.calls.length).toBe(1)
    expect(activate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        body: {
          token: 'invite-token',
          name: '邀请测试',
          interface_language: 'en-US',
          timezone: 'Pacific/Niue',
        },
      }),
    )
  } finally {
    await screen.unmount()
    queryClient.clear()
  }
})

it('keeps Enter in the timezone search until focus returns to the form', async () => {
  const { screen, queryClient, activate, navigation } = await renderInvitation()
  try {
    const name = screen.getByRole('textbox', { name: login.name })
    await name.fill('邀请测试')
    const timezone = screen.getByRole('combobox', { name: login.timezone, exact: true })
    await userEvent.tab()
    await userEvent.tab()
    await expect.element(timezone).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    const search = screen
      .getByRole('dialog', { name: login.timezone })
      .getByRole('combobox', { name: accountSettings['account.timezoneSearchPlaceholder'] })
    await expect.element(search).toHaveFocus()
    await search.fill('no-such-timezone')
    await expect
      .element(screen.getByText(accountSettings['account.timezoneNoResults']))
      .toBeVisible()
    await expect.element(search).not.toHaveAttribute('aria-activedescendant')

    await userEvent.keyboard('{Enter}')
    await expect.element(search).toHaveFocus()
    expect(activate).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    await expect.element(timezone).toHaveFocus()

    await name.fill('邀请测试')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => navigation.router.replace.mock.calls.length).toBe(1)
    expect(activate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        body: {
          token: 'invite-token',
          name: '邀请测试',
          interface_language: 'zh-Hans',
          timezone: 'Asia/Taipei',
        },
      }),
    )
  } finally {
    await screen.unmount()
    queryClient.clear()
  }
})
