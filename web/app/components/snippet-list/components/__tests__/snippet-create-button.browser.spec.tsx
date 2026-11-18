import { detectPlatform } from '@tanstack/react-hotkeys'
import { onTestFinished } from 'vite-plus/test'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { installFakeApi } from '@/test/fake-api'
import { createSnippetFixture } from '@/test/fixtures/snippet'
import SnippetCreateButton from '../snippet-create-button'

const api = vi.hoisted(() => ({ create: vi.fn(), sync: vi.fn(), push: vi.fn() }))

// boundary: routing out of this component is supplied by Next.js.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: api.push }) }))
// Snippet routes take UUID ids.
const snippetId = '00000000-0000-4000-8000-000000000123'

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
  onTestFinished(
    installFakeApi({
      console: {
        workspaces: { current: { customizedSnippets: { post: (input) => api.create(input) } } },
        snippets: { bySnippetId: { workflows: { draft: { post: (input) => api.sync(input) } } } },
      },
    }),
  )
  api.create.mockResolvedValue(createSnippetFixture({ id: snippetId, icon_info: null }))
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
  expect(api.create).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      // The contract fills the default snippet type.
      body: { name: 'My Snippet', description: 'Useful snippet description', graph, type: 'node' },
    }),
  )
  expect(api.sync).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ params: { snippet_id: snippetId }, body: { graph } }),
  )
  await userEvent.keyboard(`{${modifier}>}{Enter}{/${modifier}}`)
  expect(api.create).toHaveBeenCalledOnce()
  expect(api.push).not.toHaveBeenCalled()
  sync.resolve({ result: 'success', hash: 'draft-hash', updated_at: 1704067200 })
  await expect.element(dialog).not.toBeInTheDocument()
  expect(api.push).toHaveBeenCalledExactlyOnceWith(`/snippets/${snippetId}/orchestrate`)
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
  expect(api.push).toHaveBeenCalledExactlyOnceWith(`/snippets/${snippetId}/orchestrate`)
})
