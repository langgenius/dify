import type { FileResponse } from '@dify/contracts/api/console/files/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createDataSourceStore } from '../../store'
import { DataSourceContext } from '../../store/provider'
import LocalFile from '../index'

const upload = vi.hoisted(() => vi.fn<typeof import('@/service/base').upload>())
const supportedFormats = vi.hoisted(() => vi.fn(async () => ({ allowed_extensions: ['pdf'] })))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  upload,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'files.supportType.get': supportedFormats,
    }),
  }
})

const setup = ({
  allowedExtensions = ['pdf'],
  supportBatchUpload = true,
  existing = false,
} = {}) => {
  const user = userEvent.setup({ applyAccept: false })
  const store = createDataSourceStore()
  const file = Object.assign(new File(['document'], 'Guide.pdf', { type: 'application/pdf' }), {
    id: 'file-1',
  })
  if (existing) store.getState().setLocalFileList([{ fileID: 'local-1', file, progress: 100 }])
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  renderWithConsoleQuery(
    <DataSourceContext value={store}>
      <LocalFile allowedExtensions={allowedExtensions} supportBatchUpload={supportBatchUpload} />
      <AppToaster timeout={0} />
    </DataSourceContext>,
    { queryClient, systemFeatures: { deployment_edition: 'CLOUD' } },
  )
  return { user, store, queryClient, file }
}

beforeEach(() => {
  upload.mockReset().mockResolvedValue({
    id: 'csv-file',
    name: 'data.csv',
    size: 3,
    extension: 'csv',
    mime_type: 'text/csv',
  } satisfies FileResponse)
})
afterEach(() => toast.dismiss())

it.each([true, false])(
  'previews a stored file and applies batch-upload availability (%s)',
  async (supportBatchUpload) => {
    const { user, store, file } = setup({ supportBatchUpload, existing: true })
    await user.click(screen.getByText('Guide.pdf'))
    expect(store.getState().currentLocalFile).toBe(file)
    const browse = screen.queryByRole('button', { name: 'datasetCreation.stepOne.uploader.browse' })
    if (supportBatchUpload) expect(browse).toBeInTheDocument()
    else expect(browse).not.toBeInTheDocument()
  },
)

it.each([
  { allowedExtensions: ['csv'], accept: '.csv', canUpload: true },
  { allowedExtensions: [], accept: '', canUpload: false },
])(
  'preserves the pipeline format override $allowedExtensions after supported formats load',
  async ({ allowedExtensions, accept, canUpload }) => {
    const { user, store, queryClient } = setup({ allowedExtensions })
    const input = screen.getByLabelText('datasetCreation.stepOne.uploader.browse')
    expect(input).toHaveAttribute('accept', accept)
    await waitFor(() =>
      expect(queryClient.getQueryData(consoleQuery.files.supportType.get.queryKey())).toEqual({
        allowed_extensions: ['pdf'],
      }),
    )
    expect(supportedFormats).toHaveBeenCalledOnce()
    expect(input).toHaveAttribute('accept', accept)
    await user.upload(input, new File(['row'], 'data.csv', { type: 'text/csv' }))
    if (canUpload) {
      await waitFor(() =>
        expect(store.getState().localFileList[0]).toMatchObject({
          file: { id: 'csv-file', name: 'data.csv' },
          progress: 100,
        }),
      )
      await user.click(screen.getByText('data.csv'))
      expect(store.getState().currentLocalFile?.id).toBe('csv-file')
      expect(upload).toHaveBeenCalledOnce()
    } else {
      expect(
        await screen.findByText('datasetCreation.stepOne.uploader.validation.typeError'),
      ).toBeVisible()
      expect(
        screen.queryByRole('button', { name: 'datasetCreation.stepOne.uploader.browse' }),
      ).not.toBeInTheDocument()
      expect(store.getState().localFileList).toEqual([])
      expect(upload).not.toHaveBeenCalled()
    }
  },
)
