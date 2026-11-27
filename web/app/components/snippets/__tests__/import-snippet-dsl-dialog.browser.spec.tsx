import type { TestNavigation } from '@/test/next-navigation'
import { Toaster } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { onTestFinished } from 'vite-plus/test'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import SnippetCreateButton from '@/app/components/snippet-list/components/snippet-create-button'
import { manager, toast } from '@/app/notifications'
import { TEST_SNIPPET_ID } from '@/test/console/ids'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, installFakeApi } from '@/test/fake-api'
import { createSnippetImportResponseFixture } from '@/test/fixtures/snippet'
import { createTestNavigation } from '@/test/next-navigation'
import ImportSnippetDSLDialog from '../import-snippet-dsl-dialog'

let navigation: TestNavigation

function DirectDialog() {
  const [open, setOpen] = useState(true)
  return <ImportSnippetDSLDialog isOpen={open} onClose={() => setOpen(false)} />
}

async function setup({ permissions = ['snippets.create_and_modify'], direct = false } = {}) {
  const { wrapper: Providers } = createConsoleQueryWrapper({ workspacePermissionKeys: permissions })
  navigation = createTestNavigation({ url: '/snippets' })
  await render(
    <Providers>
      <Toaster toastManager={manager} />
      {direct ? <DirectDialog /> : <SnippetCreateButton />}
    </Providers>,
    { wrapper: navigation.NavigationProvider },
  )
  if (!direct) {
    await page.getByRole('button', { name: 'snippet.create', exact: true }).click()
    await page.getByRole('button', { name: 'snippet.importDSLFile' }).click()
  }
  const dialog = page.getByRole('dialog', { name: 'snippet.importDialogTitle' })
  await expect.element(dialog).toBeVisible()
  return dialog
}

async function upload(dialog: ReturnType<typeof page.getByRole>) {
  // The file input is intentionally hidden behind the native Browse action.
  await userEvent.upload(
    dialog.element().querySelector<HTMLInputElement>('input[type="file"]')!,
    new File(['name: snippet'], 'snippet.yml', { type: 'application/yaml' }),
  )
  await expect.element(dialog.getByRole('group', { name: 'snippet.yml' })).toBeVisible()
}

function installImportApi() {
  const fake = installFakeApi({
    console: {
      workspaces: {
        current: {
          customizedSnippets: {
            imports: {
              post: () => createSnippetImportResponseFixture(),
              byImportId: { confirm: { post: () => createSnippetImportResponseFixture() } },
            },
          },
        },
      },
    },
  })
  onTestFinished(fake)
  return fake.console.workspaces.current.customizedSnippets.imports
}
let imports: ReturnType<typeof installImportApi>
beforeEach(() => {
  vi.resetAllMocks()
  imports = installImportApi()
})
afterEach(() => toast.dismiss())

it('imports a DSL URL from the creation menu and navigates after the dialog closes', async () => {
  const dialog = await setup()
  await dialog.getByRole('tab', { name: 'snippet.importFromDSLUrl' }).click()
  await dialog.getByRole('textbox', { name: 'DSL URL' }).fill('https://example.com/snippet.yml')
  await dialog.getByRole('button', { name: 'common.operation.create' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(imports.post).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      body: { mode: 'yaml-url', yaml_url: 'https://example.com/snippet.yml' },
    }),
  )
  expect(navigation.router.push).toHaveBeenCalledExactlyOnceWith(
    `/snippets/${TEST_SNIPPET_ID}/orchestrate`,
  )
})

it('reads the uploaded YAML and waits for version confirmation before navigating', async () => {
  imports.post.mockResolvedValue(
    createSnippetImportResponseFixture({
      status: 'pending',
      snippet_id: null,
      imported_dsl_version: '0.9.0',
    }),
  )
  imports.byImportId.confirm.post.mockResolvedValue(
    createSnippetImportResponseFixture({
      status: 'completed-with-warnings',
      snippet_id: 'snippet-2',
    }),
  )
  const dialog = await setup()
  await upload(dialog)
  await dialog.getByRole('button', { name: 'common.operation.create' }).click()
  const confirmation = page.getByRole('alertdialog', { name: 'snippet.dslVersionMismatchTitle' })
  await expect.element(confirmation).toBeVisible()
  await expect.element(confirmation.getByText('0.9.0', { exact: true })).toBeVisible()
  await expect.element(confirmation.getByText('1.0.0', { exact: true })).toBeVisible()
  expect(imports.post).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ body: { mode: 'yaml-content', yaml_content: 'name: snippet' } }),
  )
  expect(navigation.router.push).not.toHaveBeenCalled()
  await confirmation.getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(confirmation).not.toBeInTheDocument()
  expect(imports.byImportId.confirm.post).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ params: { import_id: 'import-1' } }),
  )
  expect(navigation.router.push).toHaveBeenCalledExactlyOnceWith('/snippets/snippet-2/orchestrate')
})

it.each(['import', 'confirm'])(
  'shows the HTTP %s error while preserving the import for retry',
  async (step) => {
    const error = apiError({ status: 400, code: 'INVALID_DSL', message: 'Invalid DSL' })
    imports.post.mockResolvedValue(
      createSnippetImportResponseFixture({ status: 'pending', snippet_id: null }),
    )
    if (step === 'import') imports.post.mockRejectedValueOnce(error)
    else imports.byImportId.confirm.post.mockRejectedValueOnce(error)
    const dialog = await setup()
    await upload(dialog)
    await dialog.getByRole('button', { name: 'common.operation.create' }).click()
    if (step === 'confirm')
      await page.getByRole('button', { name: 'common.operation.confirm' }).click()
    await expect.element(page.getByText('Invalid DSL', { exact: true }).first()).toBeVisible()
    if (step === 'confirm') {
      const confirmation = page.getByRole('alertdialog', {
        name: 'snippet.dslVersionMismatchTitle',
      })
      await expect
        .element(confirmation.getByRole('button', { name: 'common.operation.confirm' }))
        .toBeEnabled()
      await confirmation.getByRole('button', { name: 'common.operation.cancel' }).click()
      await expect.element(confirmation).not.toBeInTheDocument()
    }
    await expect.element(dialog.getByRole('group', { name: 'snippet.yml' })).toBeVisible()
    expect(navigation.router.push).not.toHaveBeenCalled()
  },
)

it('disables a direct import without create permission even with a URL entered', async () => {
  const dialog = await setup({ permissions: [], direct: true })
  await dialog.getByRole('tab', { name: 'snippet.importFromDSLUrl' }).click()
  await dialog.getByRole('textbox', { name: 'DSL URL' }).fill('https://example.com/snippet.yml')
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.create' }))
    .toBeDisabled()
  expect(imports.post).not.toHaveBeenCalled()
})
