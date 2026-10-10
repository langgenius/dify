import type { ModelCredential, ModelItem, ModelProvider } from '../../declarations'
import { QueryClient } from '@tanstack/react-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedFeatures, seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import ModelList from '../model-list'
import { credential, label, model, provider } from './load-balancing-fixtures'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))
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
const clients: QueryClient[] = []
async function renderOwner({
  custom = false,
  response,
}: { custom?: boolean; response?: Promise<ModelCredential> } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  clients.push(client)
  seedAccountProfileQuery(client, { interface_language: 'en-US' })
  seedSystemFeatures(client, { deployment_edition: 'COMMUNITY', rbac_enabled: true })
  seedFeatures(client, { model_load_balancing_enabled: true })
  seedWorkspacePermissionsQuery(client, ['plugin.model_config', 'credential.use'])
  get.mockImplementation(async (path: string) => {
    if (path.includes('/models/credentials?')) return response ?? structuredClone(credential)
    throw new Error(`Unexpected GET: ${path}`)
  })
  const selectedProvider: ModelProvider = custom
    ? {
        ...provider,
        configurate_methods: ['predefined-model', 'customizable-model'],
        allow_custom_token: false,
      }
    : provider
  const selectedModel: ModelItem = custom ? { ...model, fetch_from: 'customizable-model' } : model
  return render(
    <QueryClientTestProvider queryClient={client}>
      <div style={{ width: 520 }}>
        <ModelList provider={selectedProvider} models={[selectedModel]} onCollapse={vi.fn()} />
      </div>
    </QueryClientTestProvider>,
  )
}
beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  await page.viewport(1000, 800)
})
afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})
it('keeps the normal configuration entry reachable by keyboard without hovering', async () => {
  const screen = await renderOwner()
  const toggle = screen.getByRole('switch', { name: label.en_US })
  const toggleRect = toggle.element().getBoundingClientRect()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: /modelsNum/ })).toHaveFocus()
  await userEvent.tab()
  await expect
    .element(screen.getByRole('button', { name: 'common.operation.config' }))
    .toHaveFocus()
  const entry = screen.getByRole('button', { name: 'common.operation.config' })
  expect(entry.element().checkVisibility({ opacityProperty: true })).toBe(true)
  expect(entry.element().getBoundingClientRect().right).toBeLessThanOrEqual(toggleRect.left)
  await userEvent.tab()
  await expect.element(toggle).toHaveFocus()
  expect(toggle.element().getBoundingClientRect().toJSON()).toEqual(toggleRect.toJSON())
})
it('retains the real configuration through exit and returns to the visible entry', async () => {
  const screen = await renderOwner()
  const toggle = screen.getByRole('switch', { name: label.en_US })
  const toggleRect = toggle.element().getBoundingClientRect()
  const idleNameWidth = screen
    .getByText(label.en_US, { exact: true })
    .element()
    .getBoundingClientRect().width
  await screen.getByText(label.en_US, { exact: true }).hover()
  expect(
    screen.getByText(label.en_US, { exact: true }).element().getBoundingClientRect().width,
  ).toBeLessThan(idleNameWidth)
  expect(toggle.element().getBoundingClientRect().toJSON()).toEqual(toggleRect.toJSON())
  const entry = screen.getByRole('button', { name: 'common.operation.config' })
  await entry.click()
  const popup = screen.getByRole('dialog')
  await expect.element(popup.getByRole('button', { name: 'common.operation.cancel' })).toBeVisible()
  const element = popup.element()
  await expect
    .poll(
      () =>
        !element.hasAttribute('data-starting-style') &&
        element.getAnimations().every((animation) => animation.playState === 'finished'),
    )
    .toBe(true)
  await popup
    .getByRole('button', { name: 'modelProvider.modelProvider.loadBalancing', exact: true })
    .first()
    .click()
  expect(element.getBoundingClientRect().width).toBe(640)
  let exitTitle: string | undefined
  element.addEventListener('transitionrun', () => {
    if (element.hasAttribute('data-ending-style'))
      exitTitle = element.querySelector('h2')?.textContent ?? undefined
  })
  await popup.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.poll(() => element.isConnected).toBe(false)
  await expect.poll(() => exitTitle).toBe('modelProvider.modelProvider.auth.configLoadBalancing')
  await expect.element(entry).toHaveFocus()
  expect(entry.element().checkVisibility({ opacityProperty: true, visibilityProperty: true })).toBe(
    true,
  )
  await userEvent.keyboard('{Enter}')
  await expect
    .element(
      screen.getByRole('dialog', {
        name: 'modelProvider.modelProvider.auth.configModel',
        exact: true,
      }),
    )
    .toBeVisible()
})

it('keeps Close and focus stable while credentials load', async () => {
  let resolve!: (value: ModelCredential) => void
  const response = new Promise<ModelCredential>((complete) => {
    resolve = complete
  })
  const screen = await renderOwner({ response })
  await screen.getByText(label.en_US, { exact: true }).hover()
  await screen.getByRole('button', { name: 'common.operation.config' }).click()
  const popup = screen.getByRole('dialog')
  const close = popup.getByRole('button', { name: 'common.operation.close' })
  await expect.element(close).toHaveFocus()
  const closeElement = close.element()
  const popupElement = popup.element()
  resolve(structuredClone(credential))
  await expect.element(popup.getByRole('button', { name: 'common.operation.cancel' })).toBeVisible()
  expect(close.element()).toBe(closeElement)
  expect(popup.element()).toBe(popupElement)
  await expect.element(close).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => popupElement.isConnected).toBe(false)
})
it('closes only the nested removal confirmation and returns to Remove with the draft intact', async () => {
  const screen = await renderOwner({ custom: true })
  await screen.getByText(label.en_US, { exact: true }).hover()
  await screen.getByRole('button', { name: 'common.operation.config', exact: true }).click()
  const popup = screen.getByRole('dialog')
  await popup
    .getByRole('button', { name: 'modelProvider.modelProvider.loadBalancing', exact: true })
    .first()
    .click()
  const remove = popup.getByRole('button', { name: 'modelProvider.modelProvider.auth.removeModel' })
  await remove.click()
  const confirmation = screen.getByRole('alertdialog')
  await expect.element(confirmation).toBeVisible()
  const confirmationElement = confirmation.element()
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => confirmationElement.isConnected).toBe(false)
  await expect.element(popup).toBeVisible()
  await expect
    .element(popup)
    .toHaveAccessibleName('modelProvider.modelProvider.auth.configLoadBalancing')
  await expect.element(remove).toHaveFocus()
})
it('keeps the configuration and Close inside a 414px viewport', async () => {
  await page.viewport(414, 800)
  const screen = await renderOwner()
  await screen.getByText(label.en_US, { exact: true }).hover()
  await screen.getByRole('button', { name: 'common.operation.config' }).click()
  const popup = screen.getByRole('dialog')
  await expect.element(popup.getByRole('button', { name: 'common.operation.cancel' })).toBeVisible()
  const element = popup.element()
  await expect
    .poll(
      () =>
        !element.hasAttribute('data-starting-style') &&
        element.getAnimations().every((animation) => animation.playState === 'finished'),
    )
    .toBe(true)
  expect(element.getBoundingClientRect().left).toBeGreaterThanOrEqual(16)
  expect(element.getBoundingClientRect().right).toBeLessThanOrEqual(398)
  const save = popup.getByRole('button', { name: 'common.operation.save' })
  expect(save.element().getBoundingClientRect().right).toBeLessThanOrEqual(398)
  const close = popup.getByRole('button', { name: 'common.operation.close' })
  expect(close.element().getBoundingClientRect().right).toBeLessThanOrEqual(398)
  await close.click()
  await expect.poll(() => element.isConnected).toBe(false)
})
