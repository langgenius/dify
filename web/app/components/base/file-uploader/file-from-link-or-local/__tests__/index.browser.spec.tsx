import type { ComponentProps } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { TransferMethod } from '@/types/app'
import { FileItem } from '../../file-uploader-in-chat-input/file-item'
import { FileContextProvider, useStore } from '../../store'
import FileFromLinkOrLocal from '../index'

// oxlint-disable-next-line typescript/no-deprecated -- Control the generated remote-file client's transport without replacing file processing or the store.
const request = vi.hoisted(() => vi.fn<typeof import('@/service/base').request>())
// oxlint-disable-next-line typescript/no-deprecated -- Local uploads still use the XHR transport.
const upload = vi.hoisted(() => vi.fn<typeof import('@/service/base').upload>())
vi.mock('@/service/base', () => ({ request, upload, post: vi.fn() }))
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/apps' }))

function Files() {
  const files = useStore((s) => s.files)
  return (
    <ul aria-label="Uploaded files">
      {files.map((file) => (
        <li key={file.id}>
          <FileItem file={file} />
        </li>
      ))}
    </ul>
  )
}
async function setup(props: Partial<ComponentProps<typeof FileFromLinkOrLocal>> = {}) {
  await page.viewport(800, 600)
  const { wrapper: Query } = createConsoleQueryWrapper()
  const onChange = vi.fn()
  await render(
    <Query>
      <FileContextProvider onChange={onChange}>
        <div style={{ padding: 200 }}>
          <FileFromLinkOrLocal
            fileConfig={{
              enabled: true,
              allowed_file_types: [SupportUploadFileTypes.document],
              allowed_file_extensions: [],
              number_limits: 1,
            }}
            trigger={(triggerProps, state) => (
              <button {...triggerProps}>{state.open ? 'Close uploads' : 'Open uploads'}</button>
            )}
            {...props}
          />
          <Files />
        </div>
      </FileContextProvider>
    </Query>,
  )
  await page.getByRole('button', { name: 'Open uploads' }).click()
  return { onChange }
}

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  upload.mockReset()
  request.mockReset().mockImplementation(async () =>
    Response.json({
      id: 'uploaded-file',
      name: 'report.pdf',
      mime_type: 'application/pdf',
      size: 10,
      url: 'https://example.com/report.pdf',
    }),
  )
})

it.each([
  { showFromLink: true, showFromLocal: false },
  { showFromLink: false, showFromLocal: true },
  { showFromLink: true, showFromLocal: true },
])('offers configured upload methods: %o', async (props) => {
  await setup(props)
  const input = page.getByPlaceholder(/pasteFileLinkInputPlaceholder/)
  const local = page.getByRole('button', { name: /uploadFromComputer/ })
  if (props.showFromLink) await expect.element(input).toBeVisible()
  else await expect.element(input).not.toBeInTheDocument()
  if (props.showFromLocal) await expect.element(local).toBeVisible()
  else await expect.element(local).not.toBeInTheDocument()
})

it('corrects an invalid link and renders the uploaded result while enforcing the limit', async () => {
  const { onChange } = await setup()
  const input = page.getByPlaceholder(/pasteFileLinkInputPlaceholder/)
  const submit = page.getByRole('button', { name: 'common.operation.ok' })
  await expect.element(submit).toBeDisabled()
  await input.fill('invalid-url')
  await submit.click()
  await expect.element(page.getByText(/pasteFileLinkInvalid/)).toBeVisible()
  expect(request).not.toHaveBeenCalled()
  await input.fill('https://example.com/report.pdf')
  await expect.element(page.getByText(/pasteFileLinkInvalid/)).not.toBeInTheDocument()
  await submit.click()
  const list = page.getByRole('list', { name: 'Uploaded files' })
  await expect.element(list.getByText('https://example.com/report.pdf')).toBeVisible()
  await expect.element(list.getByText('10.00 bytes')).toBeVisible()
  await expect.element(list.getByRole('progressbar')).not.toBeInTheDocument()
  expect(await request.mock.calls[0]?.[2]?.request?.json()).toEqual({
    url: 'https://example.com/report.pdf',
  })
  expect(onChange).toHaveBeenLastCalledWith([
    expect.objectContaining({
      uploadedId: 'uploaded-file',
      progress: 100,
      transferMethod: TransferMethod.remote_url,
    }),
  ])
  await expect.element(input).toHaveValue('')
  await expect.element(input).toBeDisabled()
  await expect.element(page.getByRole('button', { name: /uploadFromComputer/ })).toBeDisabled()
})

it('dismisses the actual upload popup and returns focus to its trigger', async () => {
  await setup()
  await page.getByRole('button', { name: 'Close uploads' }).click()
  await expect
    .element(page.getByPlaceholder(/pasteFileLinkInputPlaceholder/))
    .not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Open uploads' })).toHaveFocus()
})

it('publishes a pending local upload after its popup closes in the same input session', async () => {
  const pending = createDeferred<Awaited<ReturnType<typeof upload>>>()
  upload.mockReturnValue(pending.promise)
  const { onChange } = await setup({ showFromLink: false })
  const button = page.getByRole('button', { name: /uploadFromComputer/ })
  await expect.element(button).toBeVisible()
  // The production chooser is an unlabeled native input inside the labeled upload button.
  const input = page.elementLocator(button.element().querySelector('input[type="file"]')!)
  await input.upload(new File(['report'], 'report.txt', { type: 'text/plain' }))
  await expect.element(page.getByRole('progressbar', { name: 'custom.uploading' })).toBeVisible()
  await page.getByRole('button', { name: 'Close uploads' }).click()
  await expect.element(button).not.toBeInTheDocument()
  const selected = upload.mock.calls[0]![0].data.get('file') as File
  expect(selected.name).toBe('report.txt')
  expect(await selected.text()).toBe('report')
  pending.resolve({ id: 'uploaded-report' })
  await expect.element(page.getByRole('progressbar')).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('list', { name: 'Uploaded files' }).getByText('report.txt'))
    .toBeVisible()
  expect(onChange).toHaveBeenLastCalledWith([
    expect.objectContaining({
      uploadedId: 'uploaded-report',
      progress: 100,
      transferMethod: TransferMethod.local_file,
    }),
  ])
  await page.getByRole('button', { name: 'Open uploads' }).click()
  await expect.element(page.getByRole('button', { name: /uploadFromComputer/ })).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  await expect.element(button).not.toBeInTheDocument()
})
