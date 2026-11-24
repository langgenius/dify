import type { SnippetListItemResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { Toaster } from '@langgenius/dify-ui/toast'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { manager, toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { captureDownloads } from '@/test/download'
import { apiError, setupFakeApi } from '@/test/fake-api'
import { createSnippetFixture, createSnippetListItemFixture } from '@/test/fixtures/snippet'
import { createTestNavigation } from '@/test/next-navigation'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import SnippetList from '../../index'
import SnippetCard from '../snippet-card'

// Snippet routes take UUID ids, and list items carry the author and icon fields.
const snippetId = '00000000-0000-4000-8000-000000000001'
const createSnippet = (overrides: Partial<SnippetListItemResponse> = {}) =>
  createSnippetListItemFixture({ id: snippetId, author_name: 'Creator', ...overrides })

const sales = { id: 'tag-1', name: 'Sales', type: 'snippet' as const, binding_count: '0' }

let snippets: SnippetListItemResponse[]
const members = {
  accounts: [
    {
      id: 'creator-id',
      name: 'Creator',
      email: 'creator@example.com',
      role: 'editor',
      roles: [],
      avatar: '',
      avatar_url: '',
      last_login_at: null,
      created_at: null,
      status: 'active',
    },
    {
      id: 'updater-id',
      name: 'Updater',
      email: 'updater@example.com',
      role: 'editor',
      roles: [],
      avatar: '',
      avatar_url: '',
      last_login_at: null,
      created_at: null,
      status: 'active',
    },
  ],
}

async function setup({
  permissions = ['snippets.create_and_modify', 'snippets.management'],
  snippet,
  list = false,
}: {
  permissions?: string[]
  snippet?: SnippetListItemResponse
  list?: boolean
} = {}) {
  const { wrapper: Providers, queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys: permissions,
  })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.members.get.queryKey({ input: {} }),
    members,
  )
  const { wrapper: UrlState } = createNuqsTestWrapper()
  await render(
    <Providers>
      <UrlState>
        <Toaster toastManager={manager} />
        {list ? (
          <div style={{ height: 800, display: 'flex', flexDirection: 'column' }}>
            <SnippetList />
          </div>
        ) : (
          <div style={{ width: 360 }}>
            <SnippetCard snippet={snippet ?? createSnippet()} />
          </div>
        )}
      </UrlState>
    </Providers>,
    { wrapper: createTestNavigation({ url: '/snippets' }).NavigationProvider },
  )
  await expect.element(page.getByRole('link', { name: /Tone Rewriter/ })).toBeVisible()
}

async function openMenu() {
  // The card deliberately reveals its operations only on hover or focus.
  await page.getByRole('link', { name: /Tone Rewriter/ }).hover()
  await page
    .getByRole('button', { name: 'common.operation.moreActionsFor:{"name":"Tone Rewriter"}' })
    .click()
}
async function edit() {
  await openMenu()
  await page.getByRole('menuitem', { name: 'snippet.menu.editInfo' }).click()
  const dialog = page.getByRole('dialog', { name: 'snippet.editDialogTitle' })
  await expect.element(dialog).toBeVisible()
  return dialog
}
async function remove() {
  await openMenu()
  await page.getByRole('menuitem', { name: 'snippet.menu.deleteSnippet' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'snippet.deleteConfirmTitle' })
  await expect.element(dialog).toBeVisible()
  return dialog
}

const fake = setupFakeApi(() => ({
  console: {
    workspaces: {
      current: {
        customizedSnippets: {
          get: () => ({
            data: snippets,
            page: 1,
            limit: 30,
            total: snippets.length,
            has_more: false,
          }),
          bySnippetId: {
            patch: ({ body }) => {
              const changes = { ...body, name: body.name ?? snippets[0]!.name }
              snippets = snippets.map((item) => ({ ...item, ...changes }))
              return createSnippetFixture({ id: snippetId, ...changes })
            },
            delete: () => {
              snippets = []
            },
            export: { get: () => 'kind: snippet\nname: Tone Rewriter\n' },
          },
        },
        members: { get: () => members },
      },
    },
    tagBindings: {
      post: () => {
        snippets = snippets.map((item) => ({ ...item, tags: [sales] }))
        return { result: 'success' }
      },
    },
    tags: { get: () => [sales] },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  snippets = [createSnippet()]
})
afterEach(() => {
  toast.dismiss()
  vi.restoreAllMocks()
})

it.each([
  { updated_by: 'updater-id', created_by: 'creator-id', author: 'Updater' },
  { updated_by: 'missing', created_by: 'creator-id', author: 'Creator' },
  { updated_by: 'missing', created_by: 'missing', author: 'snippet.unknownUser' },
])(
  'resolves the displayed author to $author from real member query data',
  async ({ author, ...overrides }) => {
    await setup({ snippet: createSnippet(overrides) })
    await expect.element(page.getByRole('article').getByText(author, { exact: true })).toBeVisible()
  },
)

it.each([
  { permissions: ['snippets.create_and_modify'], editInfo: true, deleteSnippet: false },
  { permissions: ['snippets.management'], editInfo: false, deleteSnippet: true },
])(
  'limits menu actions to the seeded $permissions permission',
  async ({ permissions, editInfo, deleteSnippet }) => {
    await setup({ permissions })
    await openMenu()
    const editItem = page.getByRole('menuitem', { name: 'snippet.menu.editInfo' })
    const exportItem = page.getByRole('menuitem', { name: 'snippet.menu.exportSnippet' })
    const deleteItem = page.getByRole('menuitem', { name: 'snippet.menu.deleteSnippet' })
    if (editInfo) {
      await expect.element(editItem).toBeVisible()
      await expect.element(exportItem).toBeVisible()
    } else {
      await expect.element(editItem).not.toBeInTheDocument()
      await expect.element(exportItem).not.toBeInTheDocument()
    }
    if (deleteSnippet) await expect.element(deleteItem).toBeVisible()
    else await expect.element(deleteItem).not.toBeInTheDocument()
  },
)

it('offers neither operations nor editable tags without snippet permissions', async () => {
  await setup({ permissions: [] })
  await expect
    .element(page.getByRole('button', { name: /common.operation.moreActionsFor/ }))
    .not.toBeInTheDocument()
  await expect
    .element(page.getByRole('combobox', { name: 'common.tag.noTag: Tone Rewriter' }))
    .toBeDisabled()
})

it('exports the YAML content and filename through the real download owner', async () => {
  const downloads = captureDownloads()
  await setup({ permissions: ['snippets.create_and_modify'] })
  await openMenu()
  await page.getByRole('menuitem', { name: 'snippet.menu.exportSnippet' }).click()
  await expect.poll(() => downloads.length).toBe(1)
  const [download] = downloads
  if (!download) throw new Error('Expected the snippet YAML download')
  expect(download.filename).toBe('Tone Rewriter.yml')
  expect(download.blob.type).toBe('application/yaml')
  expect(await download.blob.text()).toBe('kind: snippet\nname: Tone Rewriter\n')
  expect(
    fake.console.workspaces.current.customizedSnippets.bySnippetId.export.get,
  ).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      params: { snippet_id: snippetId },
      query: { include_secret: 'false' },
    }),
  )
})

it('shows an export failure without starting a download', async () => {
  const downloads = captureDownloads()
  fake.console.workspaces.current.customizedSnippets.bySnippetId.export.get.mockRejectedValueOnce(
    apiError({ status: 503, code: 'EXPORT_FAILED', message: 'export failed' }),
  )
  await setup({ permissions: ['snippets.create_and_modify'] })
  await openMenu()
  await page.getByRole('menuitem', { name: 'snippet.menu.exportSnippet' }).click()
  await expect.element(page.getByText('export failed', { exact: true }).first()).toBeVisible()
  expect(downloads).toHaveLength(0)
})

it('refreshes the real list with edited info after saving', async () => {
  await setup({ list: true })
  const dialog = await edit()
  await dialog.getByRole('textbox', { name: 'workflow.snippet.nameLabel' }).fill('Updated Snippet')
  await dialog.getByRole('button', { name: 'common.operation.save' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(page.getByRole('link', { name: /Updated Snippet/ })).toBeVisible()
  await expect.element(page.getByRole('link', { name: /Tone Rewriter/ })).not.toBeInTheDocument()
})

it('keeps an edit failure visible with the entered values and the unchanged list', async () => {
  fake.console.workspaces.current.customizedSnippets.bySnippetId.patch.mockRejectedValueOnce(
    apiError({ status: 503, code: 'UPDATE_FAILED', message: 'Update failed' }),
  )
  await setup({ list: true })
  const dialog = await edit()
  const name = dialog.getByRole('textbox', { name: 'workflow.snippet.nameLabel' })
  await name.fill('Updated Snippet')
  await dialog.getByRole('button', { name: 'common.operation.save' }).click()
  await expect.element(page.getByText('Update failed', { exact: true }).first()).toBeVisible()
  await expect.element(name).toHaveValue('Updated Snippet')
  await expect.element(name).toBeEnabled()
  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(page.getByRole('link', { name: /Tone Rewriter/ })).toBeVisible()
})

it('removes a confirmed snippet from the real list', async () => {
  await setup({ list: true })
  const dialog = await remove()
  await dialog.getByRole('button', { name: 'snippet.menu.deleteSnippet' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(page.getByRole('status')).toHaveTextContent('workflow.tabs.noSnippetsFound')
  await expect.element(page.getByRole('link', { name: /Tone Rewriter/ })).not.toBeInTheDocument()
})

it('keeps a failed deletion open and the snippet in the list', async () => {
  fake.console.workspaces.current.customizedSnippets.bySnippetId.delete.mockRejectedValueOnce(
    apiError({ status: 503, code: 'DELETE_FAILED', message: 'Delete failed' }),
  )
  await setup({ list: true })
  const dialog = await remove()
  await dialog.getByRole('button', { name: 'snippet.menu.deleteSnippet' }).click()
  await expect.element(page.getByText('Delete failed', { exact: true }).first()).toBeVisible()
  await expect
    .element(dialog.getByRole('button', { name: 'snippet.menu.deleteSnippet' }))
    .toBeEnabled()
  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(page.getByRole('link', { name: /Tone Rewriter/ })).toBeVisible()
})

it('shows the bound tag after the real list refreshes', async () => {
  await setup({ list: true, permissions: ['snippets.management'] })
  await page.getByRole('combobox', { name: 'common.tag.addTag: Tone Rewriter' }).click()
  await page.getByRole('option', { name: 'Sales', exact: true }).click()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('combobox', { name: 'Sales: Tone Rewriter' })).toBeVisible()
  expect(fake.console.tagBindings.post).toHaveBeenCalledExactlyOnceWith({
    body: { tag_ids: ['tag-1'], target_id: snippetId, type: 'snippet' },
  })
})
