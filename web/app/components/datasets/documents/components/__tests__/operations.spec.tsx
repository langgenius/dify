import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import Operations from '../operations'

const mockPush = vi.fn()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

const { mockToast } = vi.hoisted(() => {
  const mockToast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  })
  return { mockToast }
})

vi.mock('@/app/notifications', () => ({
  toast: mockToast,
}))

// Mock document service hooks
const mockArchive = vi.fn()
const mockUnArchive = vi.fn()
const mockEnable = vi.fn()
const mockDisable = vi.fn()
const mockDelete = vi.fn()
const mockDownload = vi.fn()
const mockSync = vi.fn()
const mockSyncWebsite = vi.fn()
const mockPause = vi.fn()
const mockResume = vi.fn()

const mockGenerateSummary = vi.fn()
const statusMocks: Record<string, (input: unknown) => unknown> = {
  archive: (input) => mockArchive(input),
  un_archive: (input) => mockUnArchive(input),
  enable: (input) => mockEnable(input),
  disable: (input) => mockDisable(input),
}
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.status.byAction.batch.patch': (input: {
        params: { action: keyof typeof statusMocks }
      }) => statusMocks[input.params.action]!(input),
      'datasets.byDatasetId.documents.delete': (input) => mockDelete(input),
      'datasets.byDatasetId.documents.byDocumentId.download.get': (input) => mockDownload(input),
      'datasets.byDatasetId.documents.byDocumentId.notion.sync.get': (input) => mockSync(input),
      'datasets.byDatasetId.documents.byDocumentId.websiteSync.get': (input) =>
        mockSyncWebsite(input),
      'datasets.byDatasetId.documents.byDocumentId.processing.pause.patch': (input) =>
        mockPause(input),
      'datasets.byDatasetId.documents.byDocumentId.processing.resume.patch': (input) =>
        mockResume(input),
      'datasets.byDatasetId.documents.generateSummary.post': (input) => mockGenerateSummary(input),
    }),
  }
})

// Mock downloadUrl utility
const mockDownloadUrl = vi.fn()
vi.mock('@/utils/download', () => ({
  downloadUrl: (params: { url: string; fileName: string }) => mockDownloadUrl(params),
}))

afterEach(() => {
  vi.useRealTimers()
})

describe('Operations', () => {
  const mockOnUpdate = vi.fn()
  const mockOnSelectedIdChange = vi.fn()

  const defaultDetail = {
    id: 'doc-1',
    name: 'Test Document',
    enabled: true,
    archived: false,
    data_source_type: 'upload_file',
    doc_form: 'text_model',
    display_status: 'available',
  }

  const defaultProps = {
    embeddingAvailable: true,
    datasetId: 'dataset-1',
    detail: defaultDetail,
    onUpdate: mockOnUpdate,
    canEdit: true,
    canDownload: true,
    canDelete: true,
    canViewSettings: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockArchive.mockResolvedValue({})
    mockUnArchive.mockResolvedValue({})
    mockEnable.mockResolvedValue({})
    mockDisable.mockResolvedValue({})
    mockDelete.mockResolvedValue({})
    mockDownload.mockResolvedValue({ url: 'https://example.com/download' })
    mockSync.mockResolvedValue({})
    mockSyncWebsite.mockResolvedValue({})
    mockPause.mockResolvedValue({})
    mockResume.mockResolvedValue({})
  })

  describe('rendering', () => {
    it('should not render an operations menu and should disable switch without any document operation permissions', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      render(
        <Operations
          {...defaultProps}
          canEdit={false}
          canDownload={false}
          canDelete={false}
          canViewSettings={false}
        />,
      )

      expect(
        screen.queryByRole('button', { name: 'common.operation.more' }),
      ).not.toBeInTheDocument()

      const switchElement = screen.getByRole('switch')
      expect(switchElement)!.toHaveAttribute('aria-disabled', 'true')
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(switchElement)
        vi.advanceTimersByTime(600)
      })
      expect(mockEnable).not.toHaveBeenCalled()
      expect(mockDisable).not.toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('should only render download action when download is the only granted document operation', async () => {
      render(
        <Operations
          {...defaultProps}
          canEdit={false}
          canDownload
          canDelete={false}
          canViewSettings={false}
        />,
      )

      const moreButton = screen.getByRole('button', { name: 'common.operation.more' })
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(moreButton)
      })

      expect(screen.getByText('datasetDocuments.list.action.download'))!.toBeInTheDocument()
      expect(screen.queryByText('datasetDocuments.list.table.rename')).not.toBeInTheDocument()
      expect(screen.queryByText('datasetDocuments.list.action.settings')).not.toBeInTheDocument()
      expect(screen.queryByText('datasetDocuments.list.action.archive')).not.toBeInTheDocument()
      expect(screen.queryByText('datasetDocuments.list.action.delete')).not.toBeInTheDocument()
    })
  })

  describe('switch toggle', () => {
    it.each([
      { enabled: true, archived: false, embeddingAvailable: true, canEdit: true },
      { enabled: false, archived: false, embeddingAvailable: true, canEdit: true },
      { enabled: false, archived: true, embeddingAvailable: true, canEdit: true },
      { enabled: false, archived: false, embeddingAvailable: false, canEdit: true },
      { enabled: true, archived: false, embeddingAvailable: true, canEdit: false },
    ])(
      'allows toggling only editable, unarchived documents with embeddings: %j',
      ({ enabled, archived, embeddingAvailable, canEdit }) => {
        render(
          <Operations
            {...defaultProps}
            detail={{ ...defaultDetail, enabled, archived }}
            embeddingAvailable={embeddingAvailable}
            canEdit={canEdit}
          />,
        )
        const toggle = screen.getByRole('switch', {
          name: 'datasetDocuments.list.status.enabled: Test Document',
        })
        expect(toggle).toHaveAttribute('aria-checked', String(enabled))
        if (archived || !embeddingAvailable || !canEdit)
          expect(toggle).toHaveAttribute('aria-disabled', 'true')
        else expect(toggle).not.toHaveAttribute('aria-disabled', 'true')
      },
    )

    it('should call enable when switch is toggled on', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      render(
        <Operations {...defaultProps} scene="list" detail={{ ...defaultDetail, enabled: false }} />,
      )
      const switchElement = screen.getByRole('switch', {
        name: 'datasetDocuments.list.status.enabled: Test Document',
      })
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(switchElement!)
      })
      // Wait for debounce
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      expect(mockEnable).toHaveBeenCalledWith({
        params: { dataset_id: 'dataset-1', action: 'enable' },
        query: { document_id: ['doc-1'] },
      })
      vi.useRealTimers()
    })

    it('should call disable when switch is toggled off', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      render(
        <Operations {...defaultProps} scene="list" detail={{ ...defaultDetail, enabled: true }} />,
      )
      const switchElement = screen.getByRole('switch', {
        name: 'datasetDocuments.list.status.enabled: Test Document',
      })
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(switchElement!)
      })
      // Wait for debounce
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      expect(mockDisable).toHaveBeenCalledWith({
        params: { dataset_id: 'dataset-1', action: 'disable' },
        query: { document_id: ['doc-1'] },
      })
      vi.useRealTimers()
    })
  })

  describe('settings navigation', () => {
    it('should navigate to settings when settings menu item is clicked', async () => {
      render(<Operations {...defaultProps} />)
      await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.more' }))
      const settingsButton = screen.getByText('datasetDocuments.list.action.settings')
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(settingsButton)
      })
      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/documents/doc-1/settings')
    })

    it('should hide document settings when settings permission is not granted', async () => {
      render(<Operations {...defaultProps} canViewSettings={false} />)

      const moreButton = screen.getByRole('button', { name: 'common.operation.more' })
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(moreButton)
      })

      expect(screen.queryByText('datasetDocuments.list.action.settings')).not.toBeInTheDocument()
    })
  })

  describe('detail scene', () => {
    it('should not render switch in detail scene', () => {
      render(<Operations {...defaultProps} scene="detail" />)
      // In detail scene, there should be no switch
      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    })
  })

  describe('popover menu actions', () => {
    const openPopover = async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.more' }))
    }

    it('should call archive when archive action is clicked', async () => {
      render(<Operations {...defaultProps} />)
      await openPopover()
      const archiveButton = screen.getByText('datasetDocuments.list.action.archive')
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(archiveButton)
      })
      await waitFor(() => {
        expect(mockArchive).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', action: 'archive' },
          query: { document_id: ['doc-1'] },
        })
      })
    })

    it('should call un_archive when unarchive action is clicked', async () => {
      render(<Operations {...defaultProps} detail={{ ...defaultDetail, archived: true }} />)
      await openPopover()
      const unarchiveButton = screen.getByText('datasetDocuments.list.action.unarchive')
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(unarchiveButton)
      })
      await waitFor(() => {
        expect(mockUnArchive).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', action: 'un_archive' },
          query: { document_id: ['doc-1'] },
        })
      })
    })

    it('should close delete modal when cancel is clicked', async () => {
      render(<Operations {...defaultProps} />)
      await openPopover()
      const deleteButton = screen.getByText('datasetDocuments.list.action.delete')
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(deleteButton)
      })
      // Verify modal is shown
      // Verify modal is shown
      expect(screen.getByText('datasetDocuments.list.delete.title'))!.toBeInTheDocument()
      // Find and click the cancel button
      const cancelButton = screen.getByText('common.operation.cancel')
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(cancelButton)
      })
      // Modal should be closed - title shouldn't be visible
      await waitFor(() => {
        expect(screen.queryByText('datasetDocuments.list.delete.title')).not.toBeInTheDocument()
        expect(mockDelete).not.toHaveBeenCalled()
      })
    })

    it('should update selectedIds after delete operation', async () => {
      render(
        <Operations
          {...defaultProps}
          selectedIds={['doc-1', 'doc-2']}
          onSelectedIdChange={mockOnSelectedIdChange}
        />,
      )
      await openPopover()
      const deleteButton = screen.getByText('datasetDocuments.list.action.delete')
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(deleteButton)
      })
      const confirmButton = screen.getByText('common.operation.sure')
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(confirmButton)
      })
      await waitFor(() => {
        expect(mockOnSelectedIdChange).toHaveBeenCalledWith(['doc-2'])
        expect(mockDelete).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1' },
          query: { document_id: ['doc-1'] },
        })
        expect(mockOnUpdate).toHaveBeenCalledWith('delete')
      })
    })

    it('should show rename modal when rename is clicked', async () => {
      const user = userEvent.setup()
      render(<Operations {...defaultProps} />)
      await openPopover()
      const renameAction = screen.getByRole('menuitem', {
        name: 'datasetDocuments.list.table.rename',
      })
      await user.click(renameAction)

      const renameInput = await screen.findByRole('textbox')
      expect(renameInput)!.toHaveValue('Test Document')
    })

    it('should call sync for notion data source', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, data_source_type: 'notion_import' }}
        />,
      )
      await openPopover()
      const syncButton = screen.getByText('datasetDocuments.list.action.sync')
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(syncButton)
      })
      await waitFor(() => {
        expect(mockSync).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', document_id: 'doc-1' },
        })
      })
    })

    it('should call syncWebsite for web data source', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, data_source_type: 'website_crawl' }}
        />,
      )
      await openPopover()
      const syncButton = screen.getByText('datasetDocuments.list.action.sync')
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(syncButton)
      })
      await waitFor(() => {
        expect(mockSyncWebsite).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', document_id: 'doc-1' },
        })
      })
    })

    it('should call pause when pause action is clicked', async () => {
      render(
        <Operations {...defaultProps} detail={{ ...defaultDetail, display_status: 'indexing' }} />,
      )
      await openPopover()
      const pauseButton = screen.getByText('datasetDocuments.list.action.pause')
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(pauseButton)
      })
      await waitFor(() => {
        expect(mockPause).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', document_id: 'doc-1' },
        })
      })
    })

    it('should call resume when resume action is clicked', async () => {
      render(
        <Operations {...defaultProps} detail={{ ...defaultDetail, display_status: 'paused' }} />,
      )
      await openPopover()
      const resumeButton = screen.getByText('datasetDocuments.list.action.resume')
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(resumeButton)
      })
      await waitFor(() => {
        expect(mockResume).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', document_id: 'doc-1' },
        })
      })
    })

    it('should download file when download action is clicked', async () => {
      render(<Operations {...defaultProps} />)
      await openPopover()
      const downloadButton = screen.getByText('datasetDocuments.list.action.download')
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(downloadButton)
      })
      await waitFor(() => {
        expect(mockDownload).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', document_id: 'doc-1' },
        })
        expect(mockDownloadUrl).toHaveBeenCalledWith({
          url: 'https://example.com/download',
          fileName: 'Test Document',
        })
      })
    })

    it('should show settings for archived non-file data source', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, archived: true, data_source_type: 'notion_import' }}
        />,
      )
      await openPopover()
      expect(screen.getByText('datasetDocuments.list.action.settings'))!.toBeInTheDocument()
      expect(screen.queryByText('datasetDocuments.list.action.download')).not.toBeInTheDocument()
    })

    it('should download archived file when download is clicked', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, archived: true, data_source_type: 'upload_file' }}
        />,
      )
      await openPopover()
      const downloadButton = screen.getByText('datasetDocuments.list.action.download')
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(downloadButton)
      })
      await waitFor(() => {
        expect(mockDownload).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', document_id: 'doc-1' },
        })
      })
    })
  })

  describe('error handling', () => {
    it('should show error notification when operation fails', async () => {
      mockArchive.mockRejectedValue(new Error('API Error'))
      render(<Operations {...defaultProps} />)
      await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.more' }))
      const archiveButton = screen.getByText('datasetDocuments.list.action.archive')
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(archiveButton)
      })
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully')
        expect(mockOnUpdate).not.toHaveBeenCalled()
      })
    })

    it('should show error notification when download fails', async () => {
      mockDownload.mockRejectedValue(new Error('Download Error'))
      render(<Operations {...defaultProps} />)
      await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.more' }))
      const downloadButton = screen.getByText('datasetDocuments.list.action.download')
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(downloadButton)
      })
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('common.actionMsg.downloadUnsuccessfully')
        expect(mockDownloadUrl).not.toHaveBeenCalled()
      })
    })

    it('should show error notification when download returns no url', async () => {
      mockDownload.mockResolvedValue({})
      render(<Operations {...defaultProps} />)
      await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.more' }))
      const downloadButton = screen.getByText('datasetDocuments.list.action.download')
      await act(async () => {
        await userEvent
          .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
          .click(downloadButton)
      })
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('common.actionMsg.downloadUnsuccessfully')
        expect(mockDownloadUrl).not.toHaveBeenCalled()
      })
    })
  })

  describe('display status', () => {
    it('should not show pause/resume for available status', async () => {
      render(
        <Operations {...defaultProps} detail={{ ...defaultDetail, display_status: 'available' }} />,
      )
      await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.more' }))
      expect(screen.queryByText('datasetDocuments.list.action.pause')).not.toBeInTheDocument()
      expect(screen.queryByText('datasetDocuments.list.action.resume')).not.toBeInTheDocument()
    })
  })

  describe('data source types', () => {
    it('should not show download for non-file data source', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, data_source_type: 'notion_import' }}
        />,
      )
      await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.more' }))
      expect(screen.queryByText('datasetDocuments.list.action.download')).not.toBeInTheDocument()
    })
  })
})
