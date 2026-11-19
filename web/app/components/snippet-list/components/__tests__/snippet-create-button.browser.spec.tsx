import { detectPlatform } from '@tanstack/react-hotkeys'
import { onTestFinished } from 'vite-plus/test'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createSnippetFixture } from '@/test/fixtures/snippet'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import SnippetCreateButton from '../snippet-create-button'

const api = vi.hoisted(() => ({ create: vi.fn(), sync: vi.fn(), push: vi.fn() }))

// boundary: routing out of this component is supplied by Next.js.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: api.push }) }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.customizedSnippets.post': api.create,
      'snippets.bySnippetId.workflows.draft.post': api.sync,
    }),
  }
})

async function setup(permissions = ['snippets.create_and_modify']) {
  const { wrapper: Providers } = createConsoleQueryWrapper({
    workspacePermissionKeys: permissions,
  })
  const screen = await render(
    <Providers>
      <SnippetCreateButton />
    </Providers>,
  )
  return screen
}

async function openCreate() {
  await page.getByRole('button', { name: 'snippet.create', exact: true }).click()
  await page.getByRole('button', { name: 'snippet.createFromBlank' }).click()
  const dialog = page.getByRole('dialog', { name: 'workflow.snippet.createDialogTitle' })
  await expect.element(dialog).toBeVisible()
  return dialog
}

beforeEach(() => {
  vi.resetAllMocks()
  onTestFinished(guardUnexpectedFetch())
  api.create.mockResolvedValue(createSnippetFixture({ id: 'snippet-123' }))
  api.sync.mockResolvedValue({ result: 'success', hash: 'draft-hash', updated_at: 1704067200 })
})

it('hides creation without workspace permission', async () => {
  await setup([])
  await expect.element(page.getByRole('button', { name: 'snippet.create' })).not.toBeInTheDocument()
})

it('creates trimmed values and saves the draft before navigating, blocking duplicate shortcuts while pending', async () => {
  const sync = createDeferred<unknown>()
  api.sync.mockReturnValueOnce(sync.promise)
  await setup()
  const dialog = await openCreate()
  const name = dialog.getByRole('textbox', { name: 'workflow.snippet.nameLabel' })
  await expect.element(name).toHaveFocus()
  const confirm = dialog.getByRole('button', { name: 'workflow.snippet.confirm' })
  await name.fill('   ')
  await expect.element(confirm).toBeDisabled()
  await name.fill('  My Snippet  ')
  await dialog
    .getByRole('textbox', { name: 'workflow.snippet.descriptionLabel' })
    .fill('  Useful snippet description  ')
  const modifier = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  await userEvent.keyboard(`{${modifier}>}{Enter}{/${modifier}}`)
  await expect.element(name).toBeDisabled()
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.cancel' }))
    .toBeDisabled()
  await expect.poll(() => api.sync.mock.calls.length).toBe(1)
  const graph = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
  expect(api.create).toHaveBeenCalledExactlyOnceWith({
    body: {
      name: 'My Snippet',
      description: 'Useful snippet description',
      graph,
      input_fields: undefined,
    },
  })
  expect(api.sync).toHaveBeenCalledExactlyOnceWith({
    params: { snippet_id: 'snippet-123' },
    body: { graph, input_fields: undefined },
  })
  await userEvent.keyboard(`{${modifier}>}{Enter}{/${modifier}}`)
  expect(api.create).toHaveBeenCalledOnce()
  expect(api.push).not.toHaveBeenCalled()
  sync.resolve({ result: 'success', hash: 'draft-hash', updated_at: 1704067200 })
  await expect.element(dialog).not.toBeInTheDocument()
  expect(api.push).toHaveBeenCalledExactlyOnceWith('/snippets/snippet-123/orchestrate')
})

it('discards a cancelled draft and accepts the first shortcut after reopening', async () => {
  await setup()
  let dialog = await openCreate()
  await dialog.getByRole('textbox', { name: 'workflow.snippet.nameLabel' }).fill('Unsaved draft')
  await dialog
    .getByRole('textbox', { name: 'workflow.snippet.descriptionLabel' })
    .fill('Unsaved description')
  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  dialog = await openCreate()
  const name = dialog.getByRole('textbox', { name: 'workflow.snippet.nameLabel' })
  await expect.element(name).toHaveValue('')
  await expect.element(name).toHaveFocus()
  await expect
    .element(dialog.getByRole('textbox', { name: 'workflow.snippet.descriptionLabel' }))
    .toHaveValue('')
  await name.fill('Reopened snippet')
  const modifier = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  await userEvent.keyboard(`{${modifier}>}{Enter}{/${modifier}}`)
  await expect.element(dialog).not.toBeInTheDocument()
  expect(api.push).toHaveBeenCalledExactlyOnceWith('/snippets/snippet-123/orchestrate')
})
