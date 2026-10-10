import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { commonQueryKeys } from '@/service/use-common'
import { createConsoleQueryWrapper, seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import AccountPage from '../index'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('@/service/base', () => ({
  get: vi.fn(),
  post,
  put: vi.fn(),
  del: vi.fn(),
  patch: vi.fn(),
  request: vi.fn(),
  getPublic: vi.fn(),
  postPublic: vi.fn(),
  patchPublic: vi.fn(),
  delPublic: vi.fn(),
  getMarketplace: vi.fn(),
  postMarketplace: vi.fn(),
  upload: vi.fn(),
  sseGet: vi.fn(),
  ssePost: vi.fn(),
  sseGeneratorPost: vi.fn(),
}))

const clients: ReturnType<typeof createConsoleQueryWrapper>['queryClient'][] = []

beforeEach(async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  await page.viewport(1200, 900)
  post.mockReset()
  post.mockImplementation(async (url: string) => {
    if (url === '/account/change-email') return { result: 'success', data: 'browser-email-token' }
    throw new Error(`Unexpected request: ${url}`)
  })
})

afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})

it('opens the enabled Account email action and retains its code until exit before a fresh session', async () => {
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { email: 'alice@example.com', name: 'Alice' },
    systemFeatures: { enable_change_email: true, enable_email_password_login: false },
    features: { education: { enabled: false } },
  })
  clients.push(queryClient)
  queryClient.setQueryData(
    consoleQuery.apps.get.queryOptions({ input: { query: { page: 1, limit: 100, name: '' } } })
      .queryKey,
    { data: [], has_more: false, limit: 100, page: 1, total: 0 },
  )
  queryClient.setQueryData(commonQueryKeys.fileUploadConfig, { image_file_size_limit: 10 })
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <AccountPage />
    </QueryClientTestProvider>,
  )
  const entry = screen.getByRole('button', { name: 'common.operation.change', exact: true })
  for (let step = 0; step < 10 && document.activeElement !== entry.element(); step++)
    await userEvent.tab()
  await expect.element(entry).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const firstTitle = 'accountSettings.account.changeEmail.title'
  await expect.element(page.getByRole('dialog', { name: firstTitle, exact: true })).toBeVisible()
  await page
    .getByRole('button', { name: 'accountSettings.account.changeEmail.sendVerifyCode' })
    .click()
  const code = page.getByRole('textbox', { name: 'accountSettings.account.changeEmail.codeLabel' })
  await code.fill('123456')
  expect(post).toHaveBeenCalledWith('/account/change-email', {
    body: { email: 'alice@example.com', phase: 'old_email', token: undefined },
  })
  const popup = page.getByRole('dialog').element()
  const input = code.element() as HTMLInputElement
  await expect
    .poll(
      () =>
        !popup.hasAttribute('data-starting-style') &&
        popup.getAnimations().every((animation) => animation.playState === 'finished'),
    )
    .toBe(true)
  const exitDrafts: boolean[] = []
  popup.addEventListener('transitionrun', () => {
    if (popup.hasAttribute('data-ending-style'))
      exitDrafts.push(input.isConnected && input.value === '123456')
  })
  await page.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.poll(() => exitDrafts.length).toBeGreaterThan(0)
  expect(exitDrafts.every(Boolean)).toBe(true)
  await expect.poll(() => popup.isConnected).toBe(false)
  await expect.element(entry).toHaveFocus()
  expect(entry.element().checkVisibility({ opacityProperty: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('dialog', { name: firstTitle, exact: true })).toBeVisible()
  await expect.element(page.getByRole('textbox')).not.toBeInTheDocument()
  const reopened = page.getByRole('dialog').element()
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => reopened.isConnected).toBe(false)
  await expect.element(entry).toHaveFocus()

  seedSystemFeatures(queryClient, {
    enable_change_email: false,
    enable_email_password_login: false,
  })
  await expect
    .element(screen.getByRole('button', { name: 'common.operation.change', exact: true }))
    .not.toBeInTheDocument()
})
