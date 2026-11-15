import type { UserProfileWithMeta } from '@/features/account-profile/client'
import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { InputVarType } from '@/app/components/workflow/types'
import appOverview from '@/i18n/locales/en-US/app-overview.json'
import common from '@/i18n/locales/en-US/common.json'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { EmbeddedDialogContent } from '../index'

// boundary: clipboard contents cross the browser/OS boundary; the visible copied state is asserted.
vi.mock('copy-to-clipboard', () => ({ default: vi.fn() }))
vi.unmock('react-i18next')

const prefix = 'overview.appInfo.embedded'
const triggerLabel = 'deployments.studio.accessPoint.embedIntoSite'
const hiddenInputs = [
  {
    variable: 'secret',
    label: 'Secret',
    type: InputVarType.textInput,
    hide: true,
    required: true,
    default: 'initial value',
  },
]

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
}

async function dialogView(queryClient: QueryClient) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { appOverview, common } },
    keySeparator: false,
  })
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <Dialog>
          <DialogTrigger>{triggerLabel}</DialogTrigger>
          <EmbeddedDialogContent
            accessToken="embed-token"
            appBaseUrl="https://app.example.com"
            hiddenInputs={hiddenInputs}
          />
        </Dialog>
      </I18nextProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  onTestFinished(guardUnexpectedFetch())
})

it('reaches the copy action and code preview by keyboard at 320px', async () => {
  await page.viewport(320, 900)
  const queryClient = createClient()
  const accountProfile = seedAccountProfileQuery(queryClient)
  queryClient.setQueryData<UserProfileWithMeta>(
    consoleQuery.account.profile.get.queryKey(),
    accountProfile,
  )
  const screen = await render(await dialogView(queryClient))
  await screen.getByRole('button', { name: triggerLabel }).click()
  const dialog = screen.getByRole('dialog', { name: appOverview[`${prefix}.title`] })
  await dialog
    .getByRole('button', {
      name: new RegExp(appOverview[`${prefix}.hiddenInputs.title`]),
    })
    .click()
  const input = dialog.getByRole('textbox', { name: 'Secret' })
  await input.fill('draft secret')
  const panel = dialog.getByRole('tabpanel', { name: appOverview[`${prefix}.iframe`] })
  const copyButton = panel.getByRole('button', { name: appOverview[`${prefix}.copy`], exact: true })
  const preview = panel.getByRole('region', { name: appOverview[`${prefix}.iframe`] })
  await expect.poll(() => preview.element().textContent).toContain('embed-token')

  await userEvent.tab()
  await expect.element(dialog.getByRole('tab', { selected: true })).toHaveFocus()
  await userEvent.tab()
  await expect.element(copyButton).toHaveFocus()

  await userEvent.tab()
  await expect.element(preview).toHaveFocus()

  await copyButton.click()
  await expect
    .element(
      panel.getByRole('button', {
        name: appOverview[`${prefix}.copied`],
        exact: true,
      }),
    )
    .toBeVisible()
  queryClient.clear()
})

it('edits hidden inputs, switches previews, copies and restores focus on dismissal', async () => {
  const queryClient = createClient()
  const accountProfile = seedAccountProfileQuery(queryClient)
  queryClient.setQueryData<UserProfileWithMeta>(
    consoleQuery.account.profile.get.queryKey(),
    accountProfile,
  )
  const screen = await render(await dialogView(queryClient))
  const trigger = screen.getByRole('button', { name: triggerLabel })
  await trigger.click()
  const dialog = screen.getByRole('dialog', { name: appOverview[`${prefix}.title`] })
  const disclosure = dialog.getByRole('button', {
    name: new RegExp(appOverview[`${prefix}.hiddenInputs.title`]),
  })
  await expect.element(disclosure).toHaveAttribute('aria-expanded', 'false')
  await disclosure.click()
  const input = dialog.getByRole('textbox', { name: 'Secret' })
  await input.fill('draft secret')
  const scriptsTab = dialog.getByRole('tab', { name: appOverview[`${prefix}.scripts`] })
  await scriptsTab.click()
  const panel = dialog.getByRole('tabpanel', { name: appOverview[`${prefix}.scripts`] })
  await expect.poll(() => panel.element().textContent).toContain('draft secret')
  await panel.getByRole('button', { name: appOverview[`${prefix}.copy`], exact: true }).click()
  const copied = panel.getByRole('button', { name: appOverview[`${prefix}.copied`], exact: true })
  await expect.element(copied).toBeVisible()

  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  queryClient.clear()
})
