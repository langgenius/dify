import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { InputVarType } from '@/app/components/workflow/types'
import appOverview from '@/i18n/locales/en-US/app-overview.json'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { EmbeddedDialogContent } from '../index'

vi.mock('copy-to-clipboard', () => ({ default: vi.fn() }))
vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: translations } = await import('@/i18n/locales/en-US/app-overview.json')
  return createReactI18nextMock(translations)
})
vi.mock('@/service/base', () => ({
  get: vi.fn(),
  post: vi.fn(),
  request: vi.fn(),
  getPublic: vi.fn(),
  getMarketplace: vi.fn(),
  postPublic: vi.fn(),
  postMarketplace: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  delPublic: vi.fn(),
  patch: vi.fn(),
  patchPublic: vi.fn(),
  upload: vi.fn(),
  ssePost: vi.fn(),
  sseGet: vi.fn(),
  sseGeneratorPost: vi.fn(),
  handleStream: vi.fn(),
  buildSigninUrlWithRedirect: vi.fn(),
  isWebAppSigninPath: vi.fn(),
  buildWebAppSigninUrlWithRedirect: vi.fn(),
}))

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

function dialogView(queryClient: QueryClient) {
  return (
    <QueryClientProvider client={queryClient}>
      <Dialog>
        <DialogTrigger>{triggerLabel}</DialogTrigger>
        <EmbeddedDialogContent
          accessToken="embed-token"
          appBaseUrl="https://app.example.com"
          hiddenInputs={hiddenInputs}
        />
      </Dialog>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

it('reaches the copy action and code preview by keyboard at 320px', async () => {
  await page.viewport(320, 900)
  const queryClient = createClient()
  seedAccountProfileQuery(queryClient)
  const screen = await render(dialogView(queryClient))
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
  seedAccountProfileQuery(queryClient)
  const screen = await render(dialogView(queryClient))
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
