import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createDataSourceStore } from '../../store'
import { DataSourceContext } from '../../store/provider'
import LocalFile from '../index'

vi.mock('@/hooks/use-theme', () => ({ default: () => ({ theme: 'light' }) }))

it.each([true, false])(
  'previews a stored file and applies batch-upload availability (%s)',
  async (supportBatchUpload) => {
    const user = userEvent.setup()
    const store = createDataSourceStore()
    const file = Object.assign(
      new File(['document'], 'Guide.pdf', { type: 'application/pdf', lastModified: 1700000000 }),
      { id: 'file-1' },
    )
    store.getState().setLocalFileList([{ fileID: 'local-1', file, progress: 100 }])
    const queryClient = createConsoleQueryClient()
    queryClient.setQueryData(
      consoleQuery.files.upload.get.queryOptions().queryKey,
      createFileUploadConfigFixture(),
    )
    queryClient.setQueryData(consoleQuery.files.supportType.get.queryOptions().queryKey, {
      allowed_extensions: ['pdf'],
    })
    renderWithConsoleQuery(
      <DataSourceContext value={store}>
        <LocalFile allowedExtensions={['pdf']} supportBatchUpload={supportBatchUpload} />
      </DataSourceContext>,
      { queryClient, systemFeatures: { deployment_edition: 'CLOUD' } },
    )
    await user.click(screen.getByText('Guide.pdf'))
    expect(store.getState().currentLocalFile).toBe(file)
    const browse = screen.queryByText('datasetCreation.stepOne.uploader.button')
    if (supportBatchUpload) expect(browse).toBeInTheDocument()
    else expect(browse).not.toBeInTheDocument()
  },
)
