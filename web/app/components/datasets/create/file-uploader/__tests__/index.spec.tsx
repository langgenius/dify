import type { CustomFile as File, FileItem } from '@/models/datasets'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { PROGRESS_COMPLETE, PROGRESS_ERROR, PROGRESS_NOT_STARTED } from '../constants'
import FileUploader from '../index'

const render = (ui: React.ReactElement) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(consoleQuery.files.supportType.get.queryOptions().queryKey, {
    allowed_extensions: ['pdf', 'docx', 'txt'],
  })
  return renderWithConsoleQuery(ui, {
    queryClient,
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
}

// Mock services
vi.mock('@/service/base', () => ({
  upload: vi.fn().mockResolvedValue({ id: 'uploaded-id' }),
}))

vi.mock('@/i18n/language', () => ({
  LanguagesSupported: ['en-US', 'zh-Hans'],
}))

// Mock theme
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

describe('FileUploader', () => {
  const createMockFile = (overrides: Partial<File> = {}): File => {
    const { name = 'test.pdf', ...extra } = overrides
    return Object.assign(
      new globalThis.File(['content'], name, {
        type: 'application/pdf',
        lastModified: 1700000000000,
      }),
      extra,
    )
  }

  const createMockFileItem = (overrides: Partial<FileItem> = {}): FileItem => ({
    fileID: 'file-1',
    file: createMockFile(overrides.file as Partial<File>),
    progress: PROGRESS_NOT_STARTED,
    ...overrides,
  })

  const defaultProps = {
    fileList: [] as FileItem[],
    prepareFileList: vi.fn(),
    onFileUpdate: vi.fn(),
    onFileListUpdate: vi.fn(),
    onPreview: vi.fn(),
    supportBatchUpload: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('batch upload mode', () => {
    it('should hide dropzone when not batch upload and has files', () => {
      const fileList = [createMockFileItem()]
      render(<FileUploader {...defaultProps} supportBatchUpload={false} fileList={fileList} />)

      expect(
        screen.queryByText(/datasetCreation\.stepOne\.uploader\.button/),
      ).not.toBeInTheDocument()
    })
  })

  describe('event handlers', () => {
    it('should handle file preview click', async () => {
      const user = userEvent.setup()
      const onPreview = vi.fn()
      const fileItem = createMockFileItem({
        file: createMockFile({ id: 'file-id' }),
      })

      render(<FileUploader {...defaultProps} fileList={[fileItem]} onPreview={onPreview} />)

      await user.click(
        screen.getByRole('button', { name: 'datasetCreation.stepOne.filePreview test.pdf' }),
      )

      expect(onPreview).toHaveBeenCalledWith(fileItem.file)
    })

    it('keeps other uploaded files when removing one after mounting with an existing list', async () => {
      const user = userEvent.setup()
      const onFileListUpdate = vi.fn()
      const firstFile = createMockFileItem({
        fileID: 'first',
        file: createMockFile({ name: 'first.pdf', id: 'first-id' }),
      })
      const secondFile = createMockFileItem({
        fileID: 'second',
        file: createMockFile({ name: 'second.pdf', id: 'second-id' }),
      })

      render(
        <FileUploader
          {...defaultProps}
          fileList={[firstFile, secondFile]}
          onFileListUpdate={onFileListUpdate}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'common.operation.remove first.pdf' }))

      expect(onFileListUpdate).toHaveBeenCalledWith([secondFile])
    })
  })

  describe('upload announcements', () => {
    it('keeps a live status mounted before any upload starts', () => {
      render(<FileUploader {...defaultProps} />)
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    })

    it('keeps progress announcements stable until the server confirms the file', () => {
      const fileItem = createMockFileItem({ fileID: 'upload-1', progress: 0 })
      const { rerender } = render(<FileUploader {...defaultProps} fileList={[fileItem]} />)
      const status = screen.getByRole('status')
      expect(status).toHaveTextContent('test.pdf: common.loading')

      for (const progress of [25, 75, PROGRESS_COMPLETE]) {
        rerender(<FileUploader {...defaultProps} fileList={[{ ...fileItem, progress }]} />)
        expect(screen.getByRole('status')).toHaveTextContent('test.pdf: common.loading')
        expect(screen.getByRole('status')).not.toHaveTextContent(
          'datasetCreation.stepOne.uploader.completed',
        )
      }

      rerender(
        <FileUploader
          {...defaultProps}
          fileList={[
            {
              ...fileItem,
              progress: PROGRESS_COMPLETE,
              file: createMockFile({ id: 'server-file-id' }),
            },
          ]}
        />,
      )
      expect(screen.getByRole('status')).toHaveTextContent(
        'test.pdf: datasetCreation.stepOne.uploader.completed',
      )
      expect(screen.getByRole('status')).not.toHaveTextContent('common.loading')
    })

    it('announces failed and completed files by name within a batch', () => {
      const pendingFiles = [
        createMockFileItem({
          fileID: 'upload-1',
          file: createMockFile({ name: 'first.pdf' }),
          progress: 10,
        }),
        createMockFileItem({
          fileID: 'upload-2',
          file: createMockFile({ name: 'second.pdf' }),
          progress: 20,
        }),
      ]
      const { rerender } = render(<FileUploader {...defaultProps} fileList={pendingFiles} />)
      rerender(
        <FileUploader
          {...defaultProps}
          fileList={[
            { ...pendingFiles[0]!, progress: PROGRESS_ERROR },
            {
              ...pendingFiles[1]!,
              progress: PROGRESS_COMPLETE,
              file: createMockFile({ name: 'second.pdf', id: 'second-server-id' }),
            },
          ]}
        />,
      )
      const status = screen.getByRole('status')
      expect(status).toHaveTextContent('first.pdf: datasetCreation.stepOne.uploader.failed')
      expect(status).toHaveTextContent('second.pdf: datasetCreation.stepOne.uploader.completed')
      expect(status).toHaveAttribute('aria-atomic', 'false')
    })
  })
})
