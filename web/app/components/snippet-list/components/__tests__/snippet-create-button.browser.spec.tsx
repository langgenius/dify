import type { TestNavigation } from '@/test/next-navigation'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { hold, setupFakeApi } from '@/test/fake-api'
import { createSnippetFixture } from '@/test/fixtures/snippet'
import { createTestNavigation } from '@/test/next-navigation'
import SnippetCreateButton from '../snippet-create-button'

let navigation: TestNavigation
// Snippet routes take UUID ids.
const snippetId = '00000000-0000-4000-8000-000000000123'

async function setup(permissions = ['snippets.create_and_modify']) {
  const { wrapper: Providers } = createConsoleQueryWrapper({
    workspacePermissionKeys: permissions,
  })
  navigation = createTestNavigation({ url: '/snippets' })
  const screen = await render(
    <Providers>
      <SnippetCreateButton />
    </Providers>,
    { wrapper: navigation.NavigationProvider },
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

const fake = setupFakeApi(() => ({
  console: {
    workspaces: {
      current: {
        customizedSnippets: {
          post: () => createSnippetFixture({ id: snippetId }),
        },
      },
    },
    snippets: {
      bySnippetId: {
        workflows: {
          draft: {
            post: () => ({ result: 'success', hash: 'draft-hash', updated_at: 1704067200 }),
          },
        },
      },
    },
  },
}))
beforeEach(() => {
  vi.clearAllMocks()
})

it('hides creation without workspace permission', async () => {
  await setup([])
  await expect.element(page.getByRole('button', { name: 'snippet.create' })).not.toBeInTheDocument()
})

it('creates trimmed values and saves the draft before navigating, blocking duplicate shortcuts while pending', async () => {
  const createSnippet = fake.console.workspaces.current.customizedSnippets.post
  const saveDraft = fake.console.snippets.bySnippetId.workflows.draft.post
  const sync = hold(saveDraft)
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
  await expect.poll(() => saveDraft.mock.calls.length).toBe(1)
  const graph = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
  expect(createSnippet).toHaveBeenCalledExactlyOnceWith({
    // The contract fills the default snippet type.
    body: { name: 'My Snippet', description: 'Useful snippet description', graph, type: 'node' },
  })
  expect(saveDraft).toHaveBeenCalledExactlyOnceWith({
    params: { snippet_id: snippetId },
    body: { graph },
  })
  await userEvent.keyboard(`{${modifier}>}{Enter}{/${modifier}}`)
  expect(navigation.router.push).not.toHaveBeenCalled()
  sync.resolve({ result: 'success', hash: 'draft-hash', updated_at: 1704067200 })
  await expect.element(dialog).not.toBeInTheDocument()
  expect(createSnippet).toHaveBeenCalledOnce()
  expect(navigation.router.push).toHaveBeenCalledExactlyOnceWith(
    `/snippets/${snippetId}/orchestrate`,
  )
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
  expect(navigation.router.push).toHaveBeenCalledExactlyOnceWith(
    `/snippets/${snippetId}/orchestrate`,
  )
})
