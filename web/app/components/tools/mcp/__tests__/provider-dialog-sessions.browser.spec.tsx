import type { ToolWithProvider } from '@/app/components/workflow/types'
import { QueryClient } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { emojiCatalogOptions } from '@/app/components/base/icon-picker/emoji-data'
import ProviderList from '@/app/components/integrations/tool-provider-list'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'

const { get, post, put, transport } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  transport: vi.fn(),
}))
vi.mock('@/service/base', () => ({
  get,
  post,
  request: vi.fn(),
  getPublic: vi.fn(),
  getMarketplace: vi.fn(),
  postPublic: vi.fn(),
  postMarketplace: vi.fn(),
  put,
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
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: transport } }))
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
  usePathname: () => '/integrations/tools/mcp',
  useSearchParams: () => new URLSearchParams(),
}))
const provider: ToolWithProvider = {
  id: 'provider-1',
  name: 'Saved provider',
  author: 'user-1',
  description: { en_US: '', zh_Hans: '' },
  label: { en_US: 'Saved provider', zh_Hans: 'Saved provider' },
  icon: { content: '🔗', background: '#E4FBCC' },
  type: 'mcp',
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: true,
  labels: [],
  tools: [],
  server_url: 'http://localhost/mcp',
  server_identifier: 'saved-provider',
  configuration: { timeout: 30, sse_read_timeout: 300 },
}
const clients: QueryClient[] = []
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}
async function renderOwner(providers: ToolWithProvider[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  })
  clients.push(client)
  seedAccountProfileQuery(client, { id: 'user-1' })
  seedWorkspacePermissionsQuery(client, ['mcp.manage'])
  seedSystemFeatures(client, { rbac_enabled: true, enable_marketplace: false })
  client.setQueryData(emojiCatalogOptions.queryKey, [])
  const refetch = get.getMockImplementation()!
  let firstListRequest = true
  get.mockImplementation((path: string, options?: unknown) => {
    if (path === '/workspaces/current/plugin/permission/fetch')
      return Promise.resolve({ install_permission: 'everyone', debug_permission: 'everyone' })
    if (path === '/workspaces/current/tool-providers' && firstListRequest) {
      firstListRequest = false
      return Promise.resolve(providers)
    }
    return refetch(path, options)
  })
  return render(
    <QueryClientTestProvider queryClient={client}>
      <NuqsTestingAdapter>
        <div className="flex flex-col" style={{ height: 800 }}>
          <ProviderList category="mcp" />
        </div>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
}
beforeEach(async () => {
  await page.viewport(1280, 1000)
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  get.mockReset()
  post.mockReset()
  put.mockReset()
  transport.mockReset()
  get.mockImplementation(async (path: string) => {
    throw new Error(`Unexpected GET: ${path}`)
  })
  post.mockImplementation(async (path: string) => {
    if (path === '/workspaces/current/tool-provider/mcp/auth') return { result: 'pending' }
    throw new Error(`Unexpected POST: ${path}`)
  })
  transport.mockImplementation(async (path: readonly string[]) => {
    throw new Error(`Unexpected Console request: ${path.join('.')}`)
  })
})
afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})

it.each(['card', 'toolbar'] as const)(
  'keeps the real %s create session through its refresh handoff and exit',
  async (entryKind) => {
    const save = deferred<ToolWithProvider>()
    const refresh = deferred<ToolWithProvider[]>()
    post.mockImplementation((path: string) => {
      if (path === 'workspaces/current/tool-provider/mcp') return save.promise
      if (path === '/workspaces/current/tool-provider/mcp/auth')
        return Promise.resolve({ result: 'pending' })
      throw new Error(`Unexpected POST: ${path}`)
    })
    get.mockImplementation((path: string) => {
      expect(path).toBe('/workspaces/current/tool-providers')
      return refresh.promise
    })
    const screen = await renderOwner()
    await expect
      .element(screen.getByRole('link', { name: 'tools.mcp.create.cardLink' }))
      .toBeVisible()
    const entries = screen.getByRole('button', { name: 'tools.mcp.create.cardTitle', exact: true })
    const entry = entryKind === 'toolbar' ? entries.first() : entries.last()
    await entry.click()
    const dialog = screen.getByRole('dialog', { name: 'tools.mcp.modal.title', exact: true })
    await dialog
      .getByRole('textbox', { name: 'tools.mcp.modal.serverUrl', exact: true })
      .fill('http://localhost/mcp')
    await dialog
      .getByRole('textbox', { name: 'tools.mcp.modal.name', exact: true })
      .fill('Saved provider')
    await dialog
      .getByRole('textbox', { name: 'tools.mcp.modal.serverIdentifier', exact: true })
      .fill('saved-provider')
    const popup = dialog.element()
    await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
    const exit = new Promise<boolean>((resolve) => {
      const observe = (event: Event) => {
        if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
        popup.removeEventListener('transitionrun', observe)
        resolve(
          popup.isConnected &&
            Array.from(popup.querySelectorAll('input')).some(
              (input) => input.value === 'Saved provider',
            ),
        )
      }
      popup.addEventListener('transitionrun', observe)
    })
    const submit = dialog.getByRole('button', { name: 'tools.mcp.modal.confirm' })
    await submit.click()
    await expect.poll(() => post.mock.calls.length).toBe(1)
    await expect.element(submit).toHaveFocus()
    await userEvent.keyboard('{Enter}{Escape}')
    expect(post).toHaveBeenCalledTimes(1)
    await expect.element(dialog).toBeVisible()
    save.resolve(provider)
    await expect
      .poll(
        () =>
          get.mock.calls.filter(([path]) => path === '/workspaces/current/tool-providers').length,
      )
      .toBe(2)
    if (entryKind === 'card') await expect.element(dialog).toBeVisible()
    else await expect.element(dialog).not.toBeInTheDocument()
    refresh.resolve([provider])
    expect(await exit).toBe(true)
    await expect.element(dialog).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: 'tools.mcp.create.cardLink' }))
      .not.toBeInTheDocument()
    await expect
      .poll(() =>
        post.mock.calls.some(([path]) => path === '/workspaces/current/tool-provider/mcp/auth'),
      )
      .toBe(true)
    const drawer = screen.getByRole('dialog')
    await expect.element(drawer).toBeVisible()
    await expect.poll(() => drawer.element().contains(document.activeElement)).toBe(true)
    await drawer.getByRole('button', { name: 'common.operation.close' }).click()
    await expect.element(drawer).not.toBeInTheDocument()
    await screen.getByRole('button', { name: 'tools.mcp.create.cardTitle', exact: true }).click()
    await expect
      .element(dialog.getByRole('textbox', { name: 'tools.mcp.modal.name', exact: true }))
      .toHaveValue('')
  },
)

it('returns a cancelled edit to its menu and retains a failed draft until the real owner hands off on success', async () => {
  const save = deferred<{ result: string }>()
  const refresh = deferred<ToolWithProvider[]>()
  put
    .mockResolvedValueOnce({ result: 'not-success' })
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementationOnce(() => save.promise)
  get.mockImplementation((path: string) => {
    expect(path).toBe('/workspaces/current/tool-providers')
    return refresh.promise
  })
  const screen = await renderOwner([provider])
  const row = screen.getByRole('button', { name: /Saved provider/ })
  await row.hover()
  const menu = screen.getByRole('button', { name: 'common.operation.more', exact: true })
  await menu.click()
  await screen.getByRole('menuitem', { name: 'tools.mcp.operation.edit' }).click()
  const dialog = screen.getByRole('dialog', { name: 'tools.mcp.modal.editTitle' })
  const name = dialog.getByRole('textbox', { name: 'tools.mcp.modal.name', exact: true })
  for (const dismiss of ['escape', 'cancel']) {
    await name.fill('Discarded draft')
    await dialog.getByRole('heading', { name: 'tools.mcp.modal.editTitle' }).hover()
    if (dismiss === 'escape') await userEvent.keyboard('{Escape}')
    else await dialog.getByRole('button', { name: 'tools.mcp.modal.cancel' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(menu).toHaveFocus()
    await expect
      .poll(() => (menu.element() as HTMLElement).checkVisibility({ opacityProperty: true }))
      .toBe(true)
    await userEvent.keyboard('{Enter}')
    await screen.getByRole('menuitem', { name: 'tools.mcp.operation.edit' }).click()
    await expect.element(name).toHaveValue('Saved provider')
  }
  await name.fill('Retained edit')
  const submit = dialog.getByRole('button', { name: 'tools.mcp.modal.save' })
  for (let attempt = 1; attempt <= 2; attempt++) {
    await submit.click()
    await expect.poll(() => put.mock.calls.length).toBe(attempt)
    await expect.element(submit).not.toHaveAttribute('aria-disabled', 'true')
    await expect.element(name).toHaveValue('Retained edit')
  }
  expect(
    get.mock.calls.filter(([path]) => path === '/workspaces/current/tool-providers'),
  ).toHaveLength(1)
  await submit.click()
  await expect.poll(() => put.mock.calls.length).toBe(3)
  expect(put.mock.calls[2]?.[1]).toMatchObject({
    body: {
      provider_id: provider.id,
      server_url: '[__HIDDEN__]',
      name: 'Retained edit',
      identity_mode: 'off',
    },
  })
  await userEvent.keyboard('{Enter}{Escape}')
  expect(put).toHaveBeenCalledTimes(3)
  await expect.element(dialog).toBeVisible()
  const popup = dialog.element()
  await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
  const nameInput = name.element() as HTMLInputElement
  const exitingEdit = new Promise<boolean>((resolve) => {
    const observe = (event: Event) => {
      if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
      popup.removeEventListener('transitionrun', observe)
      resolve(
        popup.isConnected &&
          popup.textContent?.includes('tools.mcp.modal.editTitle') === true &&
          nameInput.value === 'Retained edit',
      )
    }
    popup.addEventListener('transitionrun', observe)
  })
  save.resolve({ result: 'success' })
  await expect
    .poll(
      () => get.mock.calls.filter(([path]) => path === '/workspaces/current/tool-providers').length,
    )
    .toBe(2)
  await expect.element(dialog).toBeVisible()
  refresh.resolve([{ ...provider, name: 'Retained edit' }])
  expect(await exitingEdit).toBe(true)
  await expect.element(dialog).not.toBeInTheDocument()
  const drawer = screen.getByRole('dialog')
  await expect.element(drawer).toBeVisible()
  await expect.poll(() => drawer.element().contains(document.activeElement)).toBe(true)
})
