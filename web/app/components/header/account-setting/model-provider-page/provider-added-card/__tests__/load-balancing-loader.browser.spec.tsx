import { QueryClient } from '@tanstack/react-query'
import { page } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedFeatures, seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import ModelList from '../model-list'
import { credential, label, model, provider } from './load-balancing-fixtures'

const { get, prepared, completed, releaseModule, moduleReady } = vi.hoisted(() => {
  let releaseModule!: () => void
  const moduleReady = new Promise<void>((resolve) => {
    releaseModule = resolve
  })
  return { get: vi.fn(), prepared: vi.fn(), completed: vi.fn(), releaseModule, moduleReady }
})
vi.mock('@/service/base', () => ({
  get,
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  patch: vi.fn(),
  getPublic: vi.fn(),
  getMarketplace: vi.fn(),
  postPublic: vi.fn(),
  postMarketplace: vi.fn(),
  delPublic: vi.fn(),
  patchPublic: vi.fn(),
  upload: vi.fn(),
  ssePost: vi.fn(),
  sseGet: vi.fn(),
  sseGeneratorPost: vi.fn(),
  handleStream: vi.fn(),
  request: vi.fn(),
  buildSigninUrlWithRedirect: vi.fn(),
  isWebAppSigninPath: vi.fn(),
  buildWebAppSigninUrlWithRedirect: vi.fn(),
}))
vi.mock('../model-load-balancing-modal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../model-load-balancing-modal')>()
  prepared()
  await moduleReady
  completed(document.querySelector('[role="dialog"]')?.hasAttribute('data-ending-style') ?? false)
  return actual
})
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
})
afterEach(async () => {
  await cleanup()
  client.clear()
  vi.unstubAllGlobals()
})
it('does not mount credential queries when the real module finishes during the loading Popup exit', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  await page.viewport(1000, 800)
  seedAccountProfileQuery(client, { interface_language: 'en-US' })
  seedSystemFeatures(client, { deployment_edition: 'COMMUNITY', rbac_enabled: true })
  seedFeatures(client, { model_load_balancing_enabled: true })
  seedWorkspacePermissionsQuery(client, ['plugin.model_config', 'credential.use'])
  get.mockImplementation(async (path: string) => {
    if (path.includes('/models/credentials?')) return structuredClone(credential)
    throw new Error(`Unexpected GET: ${path}`)
  })
  const screen = await render(
    <QueryClientTestProvider queryClient={client}>
      <div style={{ width: 520 }}>
        <ModelList provider={provider} models={[model]} onCollapse={vi.fn()} />
      </div>
    </QueryClientTestProvider>,
  )
  expect(prepared).not.toHaveBeenCalled()
  await screen.getByText(label.en_US, { exact: true }).hover()
  const entry = screen.getByRole('button', { name: 'common.operation.config' })
  await entry.click()
  const popup = screen.getByRole('dialog')
  await expect.element(screen.getByRole('status')).toBeVisible()
  await expect.poll(() => prepared.mock.calls.length).toBe(1)
  const element = popup.element()
  await expect
    .poll(
      () =>
        !element.hasAttribute('data-starting-style') &&
        element.getAnimations().every((animation) => animation.playState === 'finished'),
    )
    .toBe(true)
  expect(get).not.toHaveBeenCalled()
  let releasedDuringExit = false
  element.addEventListener('transitionrun', () => {
    if (element.hasAttribute('data-ending-style')) {
      releasedDuringExit = element.isConnected
      releaseModule()
    }
  })
  await popup.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.poll(() => releasedDuringExit).toBe(true)
  await expect.poll(() => element.isConnected).toBe(false)
  expect(get).not.toHaveBeenCalled()
  expect(completed).toHaveBeenCalledExactlyOnceWith(true)
  await expect.element(entry).toHaveFocus()
  await entry.click()
  await expect
    .element(screen.getByRole('button', { name: 'common.operation.cancel' }))
    .toBeVisible()
  expect(prepared).toHaveBeenCalledOnce()
  expect(get).toHaveBeenCalledOnce()
})
