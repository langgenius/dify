import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import type { ReactNode } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { ExternalDataToolModal } from '@/app/components/app/configuration/tools/external-data-tool-modal'
import { consoleQuery } from '@/service/console'
import { commonQueryKeys } from '@/service/use-common'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { ApiBasedExtensionPage } from '../index'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/service/base', () => ({
  request,
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
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
  buildSigninUrlWithRedirect: vi.fn(),
  isWebAppSigninPath: vi.fn(),
  buildWebAppSigninUrlWithRedirect: vi.fn(),
}))

const clients: QueryClient[] = []
const existing: ApiBasedExtensionResponse = {
  id: 'existing',
  name: 'Existing',
  api_endpoint: 'https://existing.test',
  api_key: 'existing-secret',
}
const outerSave = vi.fn()
function ExternalOwner() {
  const [open, setOpen] = useState(true)
  return (
    <ExternalDataToolModal
      open={open}
      onOpenChange={setOpen}
      data={{
        type: 'api',
        variable: 'weather',
        label: 'Weather',
        config: { api_based_extension_id: existing.id },
      }}
      onSave={outerSave}
    />
  )
}
async function setup(children: ReactNode = <ApiBasedExtensionPage />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  })
  clients.push(client)
  seedAccountProfileQuery(client)
  seedSystemFeatures(client, { deployment_edition: 'COMMUNITY' })
  seedWorkspacePermissionsQuery(client, ['api_extension.manage'])
  client.setQueryData(consoleQuery.apiBasedExtension.get.queryKey(), [existing])
  client.setQueryData(commonQueryKeys.codeBasedExtensions('external_data_tool'), { data: [] })
  const screen = await render(
    <NuqsTestingAdapter hasMemory>
      <QueryClientTestProvider queryClient={client}>{children}</QueryClientTestProvider>
    </NuqsTestingAdapter>,
  )
  return { screen, client }
}
const createDialog = () =>
  page.getByRole('dialog', { name: 'common.apiBasedExtension.modal.title' })
async function settle(element: Element) {
  await expect
    .poll(
      () =>
        !element.hasAttribute('data-starting-style') &&
        element.getAnimations().every((animation) => animation.playState === 'finished'),
    )
    .toBe(true)
}
async function fill(name: string) {
  const dialog = createDialog()
  await dialog
    .getByRole('textbox', { name: 'common.apiBasedExtension.modal.name.title' })
    .fill(name)
  await dialog
    .getByRole('textbox', { name: 'common.apiBasedExtension.modal.apiEndpoint.title' })
    .fill('https://api.test')
  await dialog
    .getByRole('textbox', { name: 'common.apiBasedExtension.modal.apiKey.title' })
    .fill('secret-key')
}
beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  await page.viewport(1100, 850)
  request.mockImplementation(
    async (_url: string, _init: RequestInit, options: { request: Request }) => {
      throw new Error(`Unexpected request: ${options.request.method} ${options.request.url}`)
    },
  )
})
afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})
it('keeps the page draft through exit and restores visible Add and Edit entry focus', async () => {
  const { screen } = await setup()
  const entry = screen.getByRole('button', { name: 'common.apiBasedExtension.add' })
  await entry.click()
  await fill('Unsaved extension')
  const popup = createDialog().element()
  await settle(popup)
  const exitDraft = vi.fn()
  popup.addEventListener('transitionrun', () => {
    if (popup.hasAttribute('data-ending-style'))
      exitDraft((popup.querySelector('input') as HTMLInputElement).value)
  })
  await createDialog().getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.poll(() => popup.isConnected).toBe(false)
  expect(exitDraft).toHaveBeenCalledWith('Unsaved extension')
  await expect.element(entry).toHaveFocus()
  await entry.click()
  await expect
    .element(
      createDialog().getByRole('textbox', { name: 'common.apiBasedExtension.modal.name.title' }),
    )
    .toHaveValue('')
  await userEvent.keyboard('{Escape}')
  await expect.element(entry).toHaveFocus()
  const edit = screen.getByRole('button', { name: 'common.operation.edit Existing' })
  await userEvent.tab()
  await expect.element(edit).toHaveFocus()
  await expect.poll(() => edit.element().checkVisibility({ opacityProperty: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  const editDialog = page.getByRole('dialog', { name: 'common.apiBasedExtension.modal.editTitle' })
  await expect
    .element(editDialog.getByRole('textbox', { name: 'common.apiBasedExtension.modal.name.title' }))
    .toHaveValue('Existing')
  await editDialog.getByRole('heading').hover()
  await editDialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(edit).toHaveFocus()
  await expect.poll(() => edit.element().checkVisibility({ opacityProperty: true })).toBe(true)
})
it('lets a cancelled request update cache without closing the next physically distinct page session', async () => {
  let resolveFirst!: (response: Response) => void
  const first = new Promise<Response>((resolve) => {
    resolveFirst = resolve
  })
  const bodies: unknown[] = []
  request.mockImplementation(
    async (_url: string, _init: RequestInit, options: { request: Request }) => {
      const req = options.request
      expect(req.method).toBe('POST')
      expect(new URL(req.url).pathname).toMatch(/\/api-based-extension$/)
      const body = await req.json()
      bodies.push(body)
      if (bodies.length === 1) return first
      return Response.json({ ...body, id: 'second' })
    },
  )
  const { screen, client } = await setup()
  const entry = screen.getByRole('button', { name: 'common.apiBasedExtension.add' })
  await entry.click()
  await fill('First')
  const oldPopup = createDialog().element()
  await createDialog().getByRole('button', { name: 'common.operation.save' }).click()
  await expect.poll(() => bodies.length).toBe(1)
  await expect
    .element(createDialog().getByRole('button', { name: 'common.operation.save' }))
    .toBeDisabled()
  await createDialog().getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.poll(() => oldPopup.isConnected).toBe(false)
  await entry.click()
  await fill('Second')
  resolveFirst(
    Response.json({
      id: 'first',
      name: 'First',
      api_endpoint: 'https://api.test',
      api_key: 'secret-key',
    }),
  )
  await expect
    .poll(() =>
      client
        .getQueryData<ApiBasedExtensionResponse[]>(consoleQuery.apiBasedExtension.get.queryKey())
        ?.map((item) => item.name),
    )
    .toEqual(['First', 'Existing'])
  await expect
    .element(
      createDialog().getByRole('textbox', { name: 'common.apiBasedExtension.modal.name.title' }),
    )
    .toHaveValue('Second')
  await createDialog().getByRole('button', { name: 'common.operation.save' }).click()
  await expect.poll(() => bodies.length).toBe(2)
  expect(bodies).toEqual([
    { name: 'First', api_endpoint: 'https://api.test', api_key: 'secret-key' },
    { name: 'Second', api_endpoint: 'https://api.test', api_key: 'secret-key' },
  ])
  await expect.element(entry).toHaveFocus()
})
it('returns from nested creation to the selector and does not submit the surrounding tool form', async () => {
  const { client } = await setup(<ExternalOwner />)
  const outer = page.getByRole('dialog', {
    name: 'common.operation.edit appDebug.variableConfig.apiBasedVar',
  })
  const outerName = outer.getByRole('textbox', { name: 'appDebug.feature.tools.modal.name.title' })
  await outerName.fill('Unsaved tool')
  const selector = outer.getByRole('button', { name: 'Existing https://existing.test' })
  await selector.click()
  await page.getByRole('button', { name: 'common.operation.add' }).click()
  await fill('Cancelled endpoint')
  const popup = createDialog().element()
  await settle(popup)
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => popup.isConnected).toBe(false)
  await expect.element(selector).toHaveFocus()
  await expect.element(outerName).toHaveValue('Unsaved tool')
  await selector.click()
  await page.getByRole('button', { name: 'common.operation.add' }).click()
  await expect
    .element(
      createDialog().getByRole('textbox', { name: 'common.apiBasedExtension.modal.name.title' }),
    )
    .toHaveValue('')
  await fill('Nested endpoint')
  request.mockImplementation(
    async (_url: string, _init: RequestInit, options: { request: Request }) => {
      expect(options.request.method).toBe('POST')
      const body = await options.request.json()
      return Response.json({ ...body, id: 'nested' })
    },
  )
  await createDialog().getByRole('button', { name: 'common.operation.save' }).click()
  await expect.element(selector).toHaveFocus()
  await expect.element(outerName).toHaveValue('Unsaved tool')
  expect(outerSave).not.toHaveBeenCalled()
  expect(
    client.getQueryData<ApiBasedExtensionResponse[]>(
      consoleQuery.apiBasedExtension.get.queryKey(),
    )?.[0]?.name,
  ).toBe('Nested endpoint')
  await expect.element(selector).toHaveAccessibleName('Existing https://existing.test')
})
