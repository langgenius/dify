import type { UploadConfig } from '@dify/contracts/api/console/files/types.gen'
import type { InputVar, MoreInfo } from '@/app/components/workflow/types'
import { ToastHost } from '@langgenius/dify-ui/toast'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
// oxlint-disable-next-line no-restricted-imports -- Mock the upload transport used by the LTS branch.
import { post as postFile, upload as uploadFile } from '@/service/base'
import { commonQueryKeys } from '@/service/use-common'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { TransferMethod } from '@/types/app'
import ConfigModal from '../index'

vi.mock('@/service/base')
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({}),
  usePathname: () => '/apps',
}))

const upload = vi.mocked(uploadFile)
const post = vi.mocked(postFile)
const MIB = 1024 * 1024
const pixel = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0),
)
const createImage = (name: string, sizeInMib: number) =>
  new File([pixel, new Uint8Array(sizeInMib * MIB - pixel.length)], name, { type: 'image/gif' })
const createDocument = (name: string, size: number) =>
  new File(['a'.repeat(size)], name, { type: 'text/plain' })

async function openFileDefaults(payload: InputVar, limits: Partial<UploadConfig>) {
  const { queryClient, wrapper: Query } = createConsoleQueryWrapper()
  queryClient.setQueryData(commonQueryKeys.fileUploadConfig, createFileUploadConfigFixture(limits))
  const onConfirm = vi.fn<(value: InputVar, moreInfo?: MoreInfo) => void>()
  await render(
    <Query>
      <ToastHost />
      <ConfigModal isShow supportFile payload={payload} onClose={vi.fn()} onConfirm={onConfirm} />
    </Query>,
  )
  return onConfirm
}

async function getFilePicker() {
  const uploadButton = page.getByRole('dialog').getByRole('button', {
    name: 'common.fileUploader.uploadFromComputer',
  })
  await expect.element(uploadButton).toBeVisible()
  return page.elementLocator(uploadButton.element().querySelector('input[type="file"]')!)
}

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  upload.mockReset()
  post.mockReset()
})

it('uses the server size limit when uploading a default image', async () => {
  upload.mockResolvedValue({ id: 'uploaded-image' })
  const onConfirm = await openFileDefaults(
    {
      type: InputVarType.singleFile,
      label: 'Image',
      variable: 'image',
      required: false,
      allowed_file_types: [SupportUploadFileTypes.image],
      allowed_file_upload_methods: [TransferMethod.local_file],
    },
    { image_file_size_limit: 20 },
  )
  const dialog = page.getByRole('dialog')
  const input = await getFilePicker()

  await input.upload(createImage('over-limit.gif', 21))
  await expect.element(page.getByText(/fileUploader\.uploadFromComputerLimit/)).toBeVisible()
  expect(upload).not.toHaveBeenCalled()

  await input.upload(createImage('default.gif', 12))
  await expect.element(dialog.getByText('default.gif')).toBeVisible()
  await expect.element(dialog.getByRole('progressbar')).not.toBeInTheDocument()
  await dialog.getByRole('button', { name: 'common.operation.save' }).click()

  expect(onConfirm).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      default: expect.objectContaining({ uploadedId: 'uploaded-image', name: 'default.gif' }),
    }),
    undefined,
  )
})

it('checks each document in a default file list against the configured size limit', async () => {
  upload.mockImplementation(async ({ data }) => ({
    id: `uploaded-${(data.get('file') as File).name}`,
  }))
  const onConfirm = await openFileDefaults(
    {
      type: InputVarType.multiFiles,
      label: 'Documents',
      variable: 'documents',
      required: false,
      max_length: 2,
      allowed_file_types: [SupportUploadFileTypes.document],
      allowed_file_upload_methods: [TransferMethod.local_file],
    },
    { file_size_limit: 1 },
  )
  const dialog = page.getByRole('dialog')
  const input = await getFilePicker()

  await input.upload(createDocument('oversized.txt', 2 * MIB))
  await expect
    .element(page.getByText(/fileUploader\.uploadFromComputerLimit.*1\.00 MB/))
    .toBeVisible()
  expect(upload).not.toHaveBeenCalled()

  await input.upload([
    createDocument('first.txt', (3 * MIB) / 4),
    createDocument('second.txt', (3 * MIB) / 4),
  ])
  await expect.element(dialog.getByText('first.txt')).toBeVisible()
  await expect.element(dialog.getByText('second.txt')).toBeVisible()
  await expect.element(dialog.getByRole('progressbar')).not.toBeInTheDocument()
  await dialog.getByRole('button', { name: 'common.operation.save' }).click()

  expect(upload).toHaveBeenCalledTimes(2)
  expect(onConfirm).toHaveBeenCalledOnce()
  const savedDefault = onConfirm.mock.lastCall?.[0].default
  expect(savedDefault).toHaveLength(2)
  expect(savedDefault).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ uploadedId: 'uploaded-first.txt', name: 'first.txt' }),
      expect.objectContaining({ uploadedId: 'uploaded-second.txt', name: 'second.txt' }),
    ]),
  )
})

it('rejects an oversized file link and saves one within the configured size limit', async () => {
  const oversized = 'https://example.com/oversized.txt'
  const allowed = 'https://example.com/default.txt'
  post
    .mockResolvedValueOnce({
      id: 'oversized',
      name: 'oversized.txt',
      mime_type: 'text/plain',
      size: 21 * MIB,
      url: oversized,
    })
    .mockResolvedValueOnce({
      id: 'uploaded-link',
      name: 'default.txt',
      mime_type: 'text/plain',
      size: 16 * MIB,
      url: allowed,
    })
  const onConfirm = await openFileDefaults(
    {
      type: InputVarType.singleFile,
      label: 'Document',
      variable: 'document',
      required: false,
      allowed_file_types: [SupportUploadFileTypes.document],
      allowed_file_upload_methods: [TransferMethod.remote_url],
    },
    { file_size_limit: 20 },
  )
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'common.fileUploader.pasteFileLink' }).click()
  const input = page.getByPlaceholder('common.fileUploader.pasteFileLinkInputPlaceholder')
  const addLink = page.getByRole('button', { name: 'common.operation.ok' })

  await input.fill(oversized)
  await addLink.click()
  await expect
    .element(page.getByText(/fileUploader\.uploadFromComputerLimit.*20\.00 MB/))
    .toBeVisible()
  await expect.element(dialog.getByText(oversized)).not.toBeInTheDocument()

  await input.fill(allowed)
  await addLink.click()
  await expect.element(dialog.getByText(allowed)).toBeVisible()
  await expect.element(dialog.getByRole('progressbar')).not.toBeInTheDocument()
  await dialog.getByRole('button', { name: 'common.operation.save' }).click()

  expect(post.mock.calls.map(([, options]) => options)).toEqual([
    { body: { url: oversized } },
    { body: { url: allowed } },
  ])
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      default: expect.objectContaining({
        uploadedId: 'uploaded-link',
        transferMethod: TransferMethod.remote_url,
        url: allowed,
      }),
    }),
    undefined,
  )
})
