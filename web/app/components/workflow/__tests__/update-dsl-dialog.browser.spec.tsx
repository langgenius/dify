import type { Import } from '@dify/contracts/api/console/apps/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppInfoView } from '@/app/components/app-sidebar/app-info'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppACLPermission } from '@/utils/permission'

const { transport } = vi.hoisted(() => ({ transport: vi.fn() }))

vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: transport } }))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }))

const app = createAppDetailFixture({
  id: 'dsl-app',
  name: 'Workflow app',
  mode: 'workflow',
  maintainer: 'another-user',
  permission_keys: [AppACLPermission.ImportExportDSL],
})
const pendingResponse: Import = {
  id: 'pending-import',
  app_id: app.id,
  status: 'pending',
  imported_dsl_version: '0.9.0',
  current_dsl_version: '0.8.0',
}
const title = 'app.importApp'
const confirmationTitle = 'app.newApp.appCreateDSLErrorTitle'
const submitName = 'workflow.common.overwriteAndImport'
const clients: QueryClient[] = []

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

async function renderOwner() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  seedAccountProfileQuery(client, { id: 'user-1' })
  seedWorkspacePermissionsQuery(client)
  seedSystemFeatures(client)
  return render(
    <QueryClientTestProvider queryClient={client}>
      <EventEmitterContextProvider>
        <AppInfoView appDetail={app} expand />
      </EventEmitterContextProvider>
    </QueryClientTestProvider>,
  )
}

async function openImport(screen: Awaited<ReturnType<typeof renderOwner>>) {
  await screen.getByRole('button', { name: /common.operation.moreActionsFor/ }).click()
  await screen.getByRole('menuitem', { name: title }).click()
  const dialog = screen.getByRole('dialog', { name: title, exact: true })
  await expect.element(dialog).toBeVisible()
  return dialog
}

async function uploadDSL(dialog: ReturnType<typeof page.getByRole>) {
  const input = dialog.element().querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('DSL uploader input missing')
  await page.elementLocator(input).upload(
    new File(['workflow:\n  graph:\n    nodes: []\n'], 'workflow.yml', {
      type: 'application/yaml',
    }),
  )
}

beforeEach(async () => {
  await page.viewport(1280, 900)
  transport.mockReset()
  transport.mockImplementation(async (path: readonly string[]) => {
    throw new Error(`Unexpected Console request: ${path.join('.')}`)
  })
})

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.unstubAllGlobals()
})

it('returns to the actual menu trigger after idle or nested cancellation and reopens a fresh session', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  const request = deferred<Import>()
  transport.mockImplementation((path: readonly string[]) => {
    if (path.join('.') === 'apps.imports.post') return request.promise
    throw new Error(`Unexpected Console request: ${path.join('.')}`)
  })
  const screen = await renderOwner()
  const menuTrigger = screen.getByRole('button', { name: /common.operation.moreActionsFor/ })
  let dialog = await openImport(screen)
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(menuTrigger).toHaveFocus()

  dialog = await openImport(screen)
  await uploadDSL(dialog)
  const submit = dialog.getByRole('button', { name: submitName })
  await submit.click()
  await expect.poll(() => transport.mock.calls.length).toBe(1)
  await expect.element(submit).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(transport).toHaveBeenCalledTimes(1)
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).toBeVisible()
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.close' }))
    .toBeDisabled()
  await expect.element(dialog.getByRole('button', { name: 'app.newApp.Cancel' })).toBeDisabled()
  const outside = document.elementFromPoint(4, 4)
  if (!outside) throw new Error('Dialog backdrop missing')
  await userEvent.click(outside, { position: { x: 4, y: 4 } })
  await expect.element(dialog).toBeVisible()
  await userEvent.tab()
  expect(dialog.element().contains(document.activeElement)).toBe(true)
  request.resolve(pendingResponse)
  const confirmation = screen.getByRole('dialog', { name: confirmationTitle })
  await expect.element(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'app.newApp.Cancel' }).click()
  await expect.element(confirmation).not.toBeInTheDocument()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(menuTrigger).toHaveFocus()
  dialog = await openImport(screen)
  await expect.element(dialog.getByRole('button', { name: 'app.dslUploader.browse' })).toBeVisible()
  await expect.element(dialog.getByRole('button', { name: submitName })).toBeDisabled()
  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(menuTrigger).toHaveFocus()
})

it('keeps confirmation pending through Escape and exits the entire import after a failed confirmation', async () => {
  const request = deferred<Import>()
  transport.mockImplementation((path: readonly string[]) => {
    if (path.join('.') === 'apps.imports.post') return Promise.resolve(pendingResponse)
    if (path.join('.') === 'apps.imports.byImportId.confirm.post') return request.promise
    throw new Error(`Unexpected Console request: ${path.join('.')}`)
  })
  const screen = await renderOwner()
  const menuTrigger = screen.getByRole('button', { name: /common.operation.moreActionsFor/ })
  const dialog = await openImport(screen)
  await uploadDSL(dialog)
  await dialog.getByRole('button', { name: submitName }).click()
  const confirmation = screen.getByRole('dialog', { name: confirmationTitle })
  const confirm = confirmation.getByRole('button', { name: 'app.newApp.Confirm' })
  await confirm.click()
  await expect.poll(() => transport.mock.calls.length).toBe(2)
  await expect.element(confirm).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(transport).toHaveBeenCalledTimes(2)
  await userEvent.keyboard('{Escape}')
  await expect.element(confirmation).toBeVisible()
  await expect
    .element(confirmation.getByRole('button', { name: 'app.newApp.Cancel' }))
    .toBeDisabled()
  request.resolve({ id: pendingResponse.id, status: 'failed', error: 'Import unavailable' })
  await expect.element(confirm).toBeEnabled()
  await expect.element(confirmation).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(confirmation).not.toBeInTheDocument()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(menuTrigger).toHaveFocus()
})
