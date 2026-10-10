import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import SnippetCreateButton from '../snippet-create-button'

const { transport, push } = vi.hoisted(() => ({ transport: vi.fn(), push: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: transport } }))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push }) }))
const clients: ReturnType<typeof createConsoleQueryWrapper>['queryClient'][] = []

async function renderOwner() {
  const { queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['snippets.create_and_modify'],
  })
  clients.push(queryClient)
  return render(
    <QueryClientTestProvider queryClient={queryClient}>
      <SnippetCreateButton />
    </QueryClientTestProvider>,
  )
}

beforeEach(async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  await page.viewport(1200, 900)
  transport.mockReset()
  push.mockReset()
  transport.mockImplementation(async (path: string[]) => {
    throw new Error(`Unexpected request: ${path.join('.')}`)
  })
})
afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})

it('retains the URL through import exit, returns to the creation menu and reopens fresh', async () => {
  const screen = await renderOwner()
  const entry = screen.getByRole('button', { name: 'snippet.create', exact: true })
  await entry.click()
  await page.getByRole('button', { name: 'snippet.importDSLFile', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'snippet.importDialogTitle', exact: true })
  await dialog.getByRole('tab', { name: 'snippet.importFromDSLUrl' }).click()
  const input = dialog.getByRole('textbox', { name: 'DSL URL' })
  await input.fill('https://example.com/snippet.yml')
  const element = input.element() as HTMLInputElement
  const popup = dialog.element()
  await expect
    .poll(
      () =>
        popup.hasAttribute('data-starting-style') ||
        popup.getAnimations().some((animation) => animation.playState === 'running'),
    )
    .toBe(false)
  const exiting: string[] = []
  popup.addEventListener('transitionrun', () => {
    if (popup.hasAttribute('data-ending-style')) exiting.push(element.value)
  })
  await dialog.getByRole('button', { name: 'common.operation.cancel', exact: true }).click()
  await expect.poll(() => exiting.length).toBeGreaterThan(0)
  expect(exiting.every((value) => value === 'https://example.com/snippet.yml')).toBe(true)
  await expect.poll(() => popup.isConnected).toBe(false)
  await expect.element(entry).toHaveFocus()
  expect(entry.element().checkVisibility({ opacityProperty: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  await page.getByRole('button', { name: 'snippet.importDSLFile', exact: true }).click()
  await expect
    .element(page.getByRole('tab', { name: 'snippet.importFromDSLFile' }))
    .toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'snippet.importFromDSLUrl' }).click()
  await expect.element(page.getByRole('textbox', { name: 'DSL URL' })).toHaveValue('')
})

it('keeps blank drafts through exit and opens a fresh, viewport-contained session', async () => {
  await page.viewport(414, 896)
  const screen = await renderOwner()
  const entry = screen.getByRole('button', { name: 'snippet.create', exact: true })
  await entry.click()
  await page.getByRole('button', { name: 'snippet.createFromBlank', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'workflow.snippet.createDialogTitle' })
  const name = dialog.getByRole('textbox', { name: 'workflow.snippet.nameLabel' })
  await name.fill('Keep during exit')
  const popup = dialog.element()
  const input = name.element() as HTMLInputElement
  await expect
    .poll(
      () =>
        popup.hasAttribute('data-starting-style') ||
        popup.getAnimations().some((animation) => animation.playState === 'running'),
    )
    .toBe(false)
  const rect = popup.getBoundingClientRect()
  expect(
    rect.left,
    JSON.stringify({
      left: rect.left,
      right: rect.right,
      width: rect.width,
      viewport: window.innerWidth,
    }),
  ).toBeGreaterThanOrEqual(0)
  expect(rect.right).toBeLessThanOrEqual(window.innerWidth)
  const exiting: string[] = []
  popup.addEventListener('transitionrun', () => {
    if (popup.hasAttribute('data-ending-style')) exiting.push(input.value)
  })
  await dialog.getByRole('button', { name: 'common.operation.cancel', exact: true }).click()
  await expect.poll(() => exiting.length).toBeGreaterThan(0)
  expect(exiting.every((value) => value === 'Keep during exit')).toBe(true)
  await expect.poll(() => popup.isConnected).toBe(false)
  await expect.element(entry).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await page.getByRole('button', { name: 'snippet.createFromBlank', exact: true }).click()
  await expect
    .element(page.getByRole('textbox', { name: 'workflow.snippet.nameLabel' }))
    .toHaveValue('')
  await userEvent.keyboard('{Escape}')
  await expect.element(entry).toHaveFocus()
})

it('keeps URL after nested Escape and Cancel, and exits both dialogs after confirmed import', async () => {
  let resolveConfirm!: (value: unknown) => void
  transport.mockImplementation(async (path: string[]) => {
    const operation = path.join('.')
    if (operation === 'workspaces.current.customizedSnippets.imports.post')
      return {
        id: 'import-1',
        status: 'pending',
        imported_dsl_version: '0.9',
        current_dsl_version: '1.0',
      }
    if (operation === 'workspaces.current.customizedSnippets.imports.byImportId.confirm.post')
      return new Promise((resolve) => {
        resolveConfirm = resolve
      })
    throw new Error(`Unexpected request: ${operation}`)
  })
  const screen = await renderOwner()
  const entry = screen.getByRole('button', { name: 'snippet.create', exact: true })
  await entry.click()
  await page.getByRole('button', { name: 'snippet.importDSLFile', exact: true }).click()
  const parent = page.getByRole('dialog', { name: 'snippet.importDialogTitle', exact: true })
  await parent.getByRole('tab', { name: 'snippet.importFromDSLUrl' }).click()
  await parent.getByRole('textbox', { name: 'DSL URL' }).fill('https://example.com/version.yml')
  const create = parent.getByRole('button', { name: 'common.operation.create', exact: true })
  const alert = page.getByRole('alertdialog', { name: 'snippet.dslVersionMismatchTitle' })
  for (const closeMethod of ['escape', 'cancel']) {
    await create.click()
    await expect.element(alert).toBeVisible()
    const popup = alert.element()
    await expect
      .poll(
        () =>
          popup.hasAttribute('data-starting-style') ||
          popup.getAnimations().some((animation) => animation.playState === 'running'),
      )
      .toBe(false)
    const exits: boolean[] = []
    popup.addEventListener('transitionrun', () => {
      if (popup.hasAttribute('data-ending-style'))
        exits.push(popup.textContent?.includes('0.9') ?? false)
    })
    if (closeMethod === 'escape') await userEvent.keyboard('{Escape}')
    else await alert.getByRole('button', { name: 'common.operation.cancel', exact: true }).click()
    await expect.poll(() => exits.length).toBeGreaterThan(0)
    expect(exits.every(Boolean)).toBe(true)
    await expect.poll(() => popup.isConnected).toBe(false)
    await expect.element(parent).toBeVisible()
    await expect
      .element(parent.getByRole('textbox', { name: 'DSL URL' }))
      .toHaveValue('https://example.com/version.yml')
    await expect.element(create).toHaveFocus()
  }
  const parentPopup = parent.element()
  await create.click()
  await expect.element(alert).toBeVisible()
  const nestedPopup = alert.element()
  await expect
    .poll(
      () =>
        nestedPopup.hasAttribute('data-starting-style') ||
        nestedPopup.getAnimations().some((animation) => animation.playState === 'running'),
    )
    .toBe(false)
  let nestedExits = 0
  let parentExits = 0
  nestedPopup.addEventListener('transitionrun', () => {
    if (nestedPopup.hasAttribute('data-ending-style')) nestedExits++
  })
  parentPopup.addEventListener('transitionrun', () => {
    if (parentPopup.hasAttribute('data-ending-style')) parentExits++
  })
  await alert.getByRole('button', { name: 'common.operation.confirm', exact: true }).click()
  await expect
    .element(alert.getByRole('button', { name: 'common.operation.confirm', exact: true }))
    .toBeDisabled()
  await expect
    .element(alert.getByRole('button', { name: 'common.operation.cancel', exact: true }))
    .toBeEnabled()
  resolveConfirm({
    id: 'import-1',
    status: 'completed-with-warnings',
    snippet_id: 'confirmed-snippet',
  })
  await expect.poll(() => nestedExits).toBeGreaterThan(0)
  await expect.poll(() => parentExits).toBeGreaterThan(0)
  await expect.poll(() => nestedPopup.isConnected || parentPopup.isConnected).toBe(false)
  expect(push).toHaveBeenCalledExactlyOnceWith('/snippets/confirmed-snippet/orchestrate')
  await expect.element(entry).toHaveFocus()
})

it('preserves pending dismissal and late success navigation for an import request', async () => {
  let resolveImport!: (value: unknown) => void
  transport.mockImplementation(async (path: string[]) => {
    if (path.join('.') === 'workspaces.current.customizedSnippets.imports.post')
      return new Promise((resolve) => {
        resolveImport = resolve
      })
    throw new Error(`Unexpected request: ${path.join('.')}`)
  })
  const screen = await renderOwner()
  const entry = screen.getByRole('button', { name: 'snippet.create', exact: true })
  await entry.click()
  await page.getByRole('button', { name: 'snippet.importDSLFile', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'snippet.importDialogTitle', exact: true })
  await dialog.getByRole('tab', { name: 'snippet.importFromDSLUrl' }).click()
  await dialog.getByRole('textbox', { name: 'DSL URL' }).fill('https://example.com/late.yml')
  await userEvent.keyboard('{Enter}')
  expect(transport).not.toHaveBeenCalled()
  await dialog.getByRole('button', { name: 'common.operation.create', exact: true }).click()
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.cancel', exact: true }))
    .toBeDisabled()
  const popup = dialog.element()
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => popup.isConnected).toBe(false)
  await expect.element(entry).toHaveFocus()
  resolveImport({ id: 'late-import', status: 'completed', snippet_id: 'late-snippet' })
  await expect.poll(() => push.mock.calls).toEqual([['/snippets/late-snippet/orchestrate']])
})
