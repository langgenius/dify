import type { ComponentProps } from 'react'
import type { InputVar } from '@/models/pipeline'
import type { SnippetDetail } from '@/models/snippet'
import { ToastHost } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
// oxlint-disable-next-line no-restricted-imports -- Mock the upload transport used by the LTS branch.
import { get as getConfig, post as postFile, upload as uploadFile } from '@/service/base'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { SnippetSidebarContent } from '../snippet-sidebar'

vi.mock('@/service/base')
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ snippetId: 'snippet-1' }),
  usePathname: () => '/snippets/snippet-1/orchestrate',
  useRouter: () => ({ replace: vi.fn() }),
  useSelectedLayoutSegment: () => 'orchestrate',
}))
vi.mock('@/next/link', () => ({
  default: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

const get = vi.mocked(getConfig)
const post = vi.mocked(postFile)
const upload = vi.mocked(uploadFile)
const MIB = 1024 * 1024
const snippet: SnippetDetail = {
  id: 'snippet-1',
  name: 'Example snippet',
  description: null,
  updatedAt: '2026-11-06T00:00:00Z',
  usage: '0',
  tags: [],
}

function EditableSnippetInputs() {
  const [fields, setFields] = useState<InputVar[]>([])
  return (
    <aside aria-label="Snippet settings" className="h-screen w-80">
      <SnippetSidebarContent
        snippet={snippet}
        fields={fields}
        readonly={false}
        onFieldsChange={setFields}
      />
    </aside>
  )
}

it('adds a default file list from the Snippet sidebar and enforces the configured limit when replacing its file', async () => {
  onTestFinished(guardUnexpectedFetch())
  const oversized = 'https://example.com/oversized.txt'
  const replacement = 'https://example.com/replacement.txt'
  get.mockResolvedValue(createFileUploadConfigFixture({ file_size_limit: 2 }))
  post.mockImplementation(async (_path, options) => {
    const { url } = (options as { body: { url: string } }).body
    const tooLarge = url === oversized
    return {
      id: tooLarge ? 'oversized-file' : 'replacement-file',
      name: tooLarge ? 'oversized.txt' : 'replacement.txt',
      mime_type: 'text/plain',
      size: (tooLarge ? 3 : 1) * MIB,
      url,
    }
  })
  upload.mockResolvedValue({ id: 'original-file' })
  const { wrapper: Query } = createConsoleQueryWrapper()
  await render(
    <Query>
      <ToastHost />
      <EditableSnippetInputs />
    </Query>,
  )

  const sidebar = page.getByRole('complementary', { name: 'Snippet settings' })
  await sidebar.getByRole('button', { name: 'common.operation.add snippet.inputVariables' }).click()
  const addDialog = page.getByRole('dialog', { name: 'appDebug.variableConfig.addModalTitle' })
  await addDialog.getByRole('combobox', { name: 'appDebug.variableConfig.fieldType' }).click()
  await page.getByRole('option', { name: /^appDebug\.variableConfig\.multi-files/ }).click()
  await addDialog
    .getByRole('textbox', { name: 'appDebug.variableConfig.labelName' })
    .fill('Source files')
  await addDialog
    .getByRole('textbox', { name: 'appDebug.variableConfig.varName' })
    .fill('source_files')
  await addDialog
    .getByRole('checkbox', { name: 'appDebug.variableConfig.file.document.name' })
    .click()
  await expect
    .element(addDialog.getByText(/variableConfig\.maxNumberTip.*"docLimit":"2\.00 MB"/))
    .toBeVisible()

  const uploadButton = addDialog.getByRole('button', {
    name: 'common.fileUploader.uploadFromComputer',
  })
  await expect.element(uploadButton).toBeVisible()
  const input = page.elementLocator(uploadButton.element().querySelector('input[type="file"]')!)
  await input.upload(new File(['original'], 'original.txt', { type: 'text/plain' }))
  await expect.element(addDialog.getByText('original.txt')).toBeVisible()
  await expect.element(addDialog.getByRole('progressbar')).not.toBeInTheDocument()
  await addDialog.getByRole('button', { name: 'common.operation.save' }).click()
  await expect.element(addDialog).not.toBeInTheDocument()

  const editButton = sidebar.getByRole('button', { name: 'common.operation.edit' })
  const field = sidebar.getByText('source_files')
  await field.hover()
  await editButton.click()
  const editDialog = page.getByRole('dialog', { name: 'appDebug.variableConfig.editModalTitle' })
  await expect.element(editDialog.getByText('original.txt')).toBeVisible()
  await editDialog.getByRole('button', { name: 'common.fileUploader.pasteFileLink' }).click()
  const urlInput = page.getByPlaceholder('common.fileUploader.pasteFileLinkInputPlaceholder')
  const addLink = page.getByRole('button', { name: 'common.operation.ok' })
  await urlInput.fill(oversized)
  await addLink.click()
  await expect
    .element(page.getByText(/fileUploader\.uploadFromComputerLimit.*2\.00 MB/))
    .toBeVisible()
  await expect.element(editDialog.getByText(oversized)).not.toBeInTheDocument()
  await expect.element(editDialog.getByText('original.txt')).toBeVisible()

  await urlInput.fill(replacement)
  await addLink.click()
  await expect.element(editDialog.getByText(replacement)).toBeVisible()
  await expect.element(editDialog.getByRole('progressbar')).not.toBeInTheDocument()
  await editDialog.getByRole('button', { name: 'common.operation.remove original.txt' }).click()
  await editDialog.getByRole('button', { name: 'common.operation.save' }).click()
  await expect.element(editDialog).not.toBeInTheDocument()

  await field.hover()
  await editButton.click()
  await expect.element(editDialog.getByText(replacement)).toBeVisible()
  await expect.element(editDialog.getByText('original.txt')).not.toBeInTheDocument()
})
