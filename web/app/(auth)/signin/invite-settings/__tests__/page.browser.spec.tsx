import type { PostActivateData } from '@dify/contracts/api/console/activate/types.gen'
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
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import InviteSettingsPage from '../page'

vi.unmock('react-i18next')

const mocks = vi.hoisted(() => ({
  activate: vi.fn<(input: Pick<PostActivateData, 'body'>) => Promise<{ result: string }>>(),
  replace: vi.fn(),
}))

// boundary: the browser fixture owns its locale and skips persisting a locale cookie.
vi.mock('@/i18n/client', () => ({ setLocaleOnClient: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams('invite_token=invite-token'),
}))
vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: (path: readonly string[], input: Pick<PostActivateData, 'body'>) => {
      if (path.join('.') === 'activate.post') return mocks.activate(input)
      if (path.join('.') === 'account.profile.get') return { email: 'invitee@example.com' }
      throw new Error(`Unexpected console request: ${path.join('.')}`)
    },
  },
}))
vi.mock('@/utils/timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/timezone')>()),
  getBrowserTimezone: () => 'Asia/Taipei',
}))

const workspaceName = "invitee@example.com's Workspace"

async function renderInvitation() {
  mocks.activate.mockResolvedValue({ result: 'success' })
  const i18n = createInstance()
  await i18n.init({
    ...getInitOptions(['accountSettings', 'common', 'login']),
    lng: 'zh-Hans',
    resources: { 'zh-Hans': { accountSettings, common, login } },
  })
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { email: 'invitee@example.com' },
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
      },
    },
  )
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <I18nextProvider i18n={i18n}>
        <AuthLayout>
          <InviteSettingsPage />
        </AuthLayout>
      </I18nextProvider>
    </QueryClientTestProvider>,
  )

  return { screen, queryClient }
}

it('selects highlighted options with Enter and submits the confirmed preferences', async () => {
  await page.viewport(620, 740)
  const { screen, queryClient } = await renderInvitation()
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
    const languageSearch = screen
      .getByRole('dialog', { name: login.interfaceLanguage })
      .getByRole('combobox', { name: common['operation.search'] })
    await expect.element(languageSearch).toHaveFocus()
    await languageSearch.fill('unknown language')
    await expect.element(screen.getByText(common['dynamicSelect.noData'])).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(language).toHaveTextContent('简体中文')
    await expect.element(language).toHaveFocus()

    await language.click()
    await languageSearch.fill('United States')
    await expect
      .element(screen.getByRole('option', { name: 'English (United States)' }))
      .toBeVisible()
    await expectListAlignedWithForm()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(languageSearch).toHaveAttribute('aria-activedescendant')
    await userEvent.keyboard('{Enter}')
    await expect.element(language).toHaveTextContent('English (United States)')
    expect(mocks.activate).not.toHaveBeenCalled()

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
    expect(mocks.activate).not.toHaveBeenCalled()

    await page.viewport(320, 740)
    await submit.click()
    await expect.poll(() => mocks.replace.mock.calls.length).toBe(1)
    expect(mocks.activate).toHaveBeenCalledExactlyOnceWith({
      body: {
        token: 'invite-token',
        name: '邀请测试',
        interface_language: 'en-US',
        timezone: 'Pacific/Niue',
      },
    })
  } finally {
    await screen.unmount()
    queryClient.clear()
  }
})

it.each([
  {
    field: login.interfaceLanguage,
    searchLabel: common['operation.search'],
    query: 'United States',
    visibleResult: 'English (United States)',
  },
  {
    field: login.timezone,
    searchLabel: accountSettings['account.timezoneSearchPlaceholder'],
    query: 'no-such-timezone',
    visibleResult: accountSettings['account.timezoneNoResults'],
  },
])(
  'keeps Enter in the $field picker until focus returns to the form',
  async ({ field, searchLabel, query, visibleResult }) => {
    const { screen, queryClient } = await renderInvitation()
    try {
      const name = screen.getByRole('textbox', { name: login.name })
      await name.fill('邀请测试')
      const picker = screen.getByRole('combobox', { name: field, exact: true })
      await userEvent.tab()
      if (field === login.timezone) await userEvent.tab()
      await expect.element(picker).toHaveFocus()
      await userEvent.keyboard('{Enter}')
      const search = screen
        .getByRole('dialog', { name: field, exact: true })
        .getByRole('combobox', { name: searchLabel })
      await expect.element(search).toHaveFocus()
      await search.fill(query)
      await expect.element(screen.getByText(visibleResult, { exact: true })).toBeVisible()
      await expect.element(search).not.toHaveAttribute('aria-activedescendant')

      await userEvent.keyboard('{Enter}')
      await expect.element(search).toHaveFocus()
      expect(mocks.activate).not.toHaveBeenCalled()
      await userEvent.keyboard('{Escape}')
      await expect.element(picker).toHaveFocus()

      await name.fill('邀请测试')
      await userEvent.keyboard('{Enter}')
      await expect.poll(() => mocks.replace.mock.calls.length).toBe(1)
      expect(mocks.activate).toHaveBeenCalledExactlyOnceWith({
        body: {
          token: 'invite-token',
          name: '邀请测试',
          interface_language: 'zh-Hans',
          timezone: 'Asia/Taipei',
        },
      })
    } finally {
      await screen.unmount()
      queryClient.clear()
    }
  },
)
