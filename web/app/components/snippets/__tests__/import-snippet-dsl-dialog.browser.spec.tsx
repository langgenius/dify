import { Toaster } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { onTestFinished } from 'vite-plus/test'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import SnippetCreateButton from '@/app/components/snippet-list/components/snippet-create-button'
import { manager, toast } from '@/app/notifications'
import { httpErrorFromResponse } from '@/service/http-error'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createSnippetImportResponseFixture as response } from '@/test/fixtures/snippet'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import ImportSnippetDSLDialog from '../import-snippet-dsl-dialog'

const api = vi.hoisted(() => ({ import: vi.fn(), confirm: vi.fn(), push: vi.fn() }))
// boundary: Next.js owns navigation after importing a snippet.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: api.push }) }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.customizedSnippets.imports.post': api.import,
      'workspaces.current.customizedSnippets.imports.byImportId.confirm.post': api.confirm,
    }),
  }
})

function DirectDialog() {
  const [open, setOpen] = useState(true)
  return <ImportSnippetDSLDialog isOpen={open} onClose={() => setOpen(false)} />
}

async function setup({ permissions = ['snippets.create_and_modify'], direct = false } = {}) {
  const { wrapper: Providers } = createConsoleQueryWrapper({ workspacePermissionKeys: permissions })
  await render(
    <Providers>
      <Toaster toastManager={manager} />
      {direct ? <DirectDialog /> : <SnippetCreateButton />}
    </Providers>,
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

beforeEach(() => {
  vi.resetAllMocks()
  onTestFinished(guardUnexpectedFetch())
})
afterEach(() => toast.dismiss())

it('imports a DSL URL from the creation menu and navigates after the dialog closes', async () => {
  api.import.mockResolvedValue(response())
  const dialog = await setup()
  await dialog.getByRole('tab', { name: 'snippet.importFromDSLUrl' }).click()
  await dialog.getByRole('textbox', { name: 'DSL URL' }).fill('https://example.com/snippet.yml')
  await dialog.getByRole('button', { name: 'common.operation.create' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(api.import).toHaveBeenCalledExactlyOnceWith(
    {
      body: {
        mode: 'yaml-url',
        yaml_content: undefined,
        yaml_url: 'https://example.com/snippet.yml',
      },
    },
    { context: { silent: true } },
  )
  expect(api.push).toHaveBeenCalledExactlyOnceWith('/snippets/snippet-1/orchestrate')
})

it('reads the uploaded YAML and waits for version confirmation before navigating', async () => {
  api.import.mockResolvedValue(
    response({ status: 'pending', snippet_id: null, imported_dsl_version: '0.9.0' }),
  )
  api.confirm.mockResolvedValue(
    response({ status: 'completed-with-warnings', snippet_id: 'snippet-2' }),
  )
  const dialog = await setup()
  await upload(dialog)
  await dialog.getByRole('button', { name: 'common.operation.create' }).click()
  const confirmation = page.getByRole('alertdialog', { name: 'snippet.dslVersionMismatchTitle' })
  await expect.element(confirmation).toBeVisible()
  await expect.element(confirmation.getByText('0.9.0', { exact: true })).toBeVisible()
  await expect.element(confirmation.getByText('1.0.0', { exact: true })).toBeVisible()
  expect(api.import).toHaveBeenCalledExactlyOnceWith(
    { body: { mode: 'yaml-content', yaml_content: 'name: snippet', yaml_url: undefined } },
    { context: { silent: true } },
  )
  expect(api.push).not.toHaveBeenCalled()
  await confirmation.getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(confirmation).not.toBeInTheDocument()
  expect(api.confirm).toHaveBeenCalledExactlyOnceWith(
    { params: { import_id: 'import-1' } },
    { context: { silent: true } },
  )
  expect(api.push).toHaveBeenCalledExactlyOnceWith('/snippets/snippet-2/orchestrate')
})

it.each(['import', 'confirm'])(
  'shows the HTTP %s error while preserving the import for retry',
  async (step) => {
    const error = await httpErrorFromResponse(
      Response.json({ message: 'Invalid DSL' }, { status: 400 }),
    )
    api.import.mockResolvedValue(response({ status: 'pending', snippet_id: null }))
    if (step === 'import') api.import.mockRejectedValueOnce(error)
    else api.confirm.mockRejectedValueOnce(error)
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
    expect(api.push).not.toHaveBeenCalled()
  },
)

it('disables a direct import without create permission even with a URL entered', async () => {
  const dialog = await setup({ permissions: [], direct: true })
  await dialog.getByRole('tab', { name: 'snippet.importFromDSLUrl' }).click()
  await dialog.getByRole('textbox', { name: 'DSL URL' }).fill('https://example.com/snippet.yml')
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.create' }))
    .toBeDisabled()
  expect(api.import).not.toHaveBeenCalled()
})
