import type { ReactElement } from 'react'
import type { consoleClient } from '@/service/console'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import Operations from '../operations'

const mockPush = vi.fn()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

type DocumentsClient = typeof consoleClient.datasets.byDatasetId.documents

const mockArchive = vi.fn<DocumentsClient['status']['byAction']['batch']['patch']>()
const mockUnArchive = vi.fn<DocumentsClient['status']['byAction']['batch']['patch']>()
const mockEnable = vi.fn<DocumentsClient['status']['byAction']['batch']['patch']>()
const mockDisable = vi.fn<DocumentsClient['status']['byAction']['batch']['patch']>()
const mockDownload = vi.fn<DocumentsClient['byDocumentId']['download']['get']>()
const mockSync = vi.fn<DocumentsClient['byDocumentId']['notion']['sync']['get']>()
const mockSyncWebsite = vi.fn<DocumentsClient['byDocumentId']['websiteSync']['get']>()
const mockPause = vi.fn<DocumentsClient['byDocumentId']['processing']['pause']['patch']>()
const mockResume = vi.fn<DocumentsClient['byDocumentId']['processing']['resume']['patch']>()

const mockGenerateSummary = vi.fn<DocumentsClient['generateSummary']['post']>()
const statusMocks: Record<string, DocumentsClient['status']['byAction']['batch']['patch']> = {
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
      'datasets.byDatasetId.documents.status.byAction.batch.patch': (
        input: Parameters<DocumentsClient['status']['byAction']['batch']['patch']>[0],
      ) => statusMocks[input.params.action]!(input),
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

const downloads: { url: string; fileName: string }[] = []
const render = (ui: ReactElement) =>
  renderWithConsoleQuery(
    <>
      {ui}
      <AppToaster />
    </>,
  )

beforeEach(() => {
  downloads.length = 0
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ url: this.href, fileName: this.download })
  })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await act(async () => toast.dismiss())
})

describe('Operations', () => {
  const mockOnUpdate = vi.fn()

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
    onDelete: vi.fn(),
    canEdit: true,
    canDownload: true,
    canDelete: true,
    canViewSettings: true,
  }

  beforeEach(() => {
    mockArchive.mockReset().mockResolvedValue({ result: 'success' })
    mockUnArchive.mockReset().mockResolvedValue({ result: 'success' })
    mockEnable.mockReset().mockResolvedValue({ result: 'success' })
    mockDisable.mockReset().mockResolvedValue({ result: 'success' })
    mockDownload.mockResolvedValue({ url: 'https://example.com/download' })
    mockSync.mockReset().mockResolvedValue({ result: 'success' })
    mockSyncWebsite.mockReset().mockResolvedValue({ result: 'success' })
    mockPause.mockReset().mockResolvedValue({ result: 'success' })
    mockResume.mockReset().mockResolvedValue({ result: 'success' })
  })

  describe('rendering', () => {
    it('should not render an operations menu and should disable switch without any document operation permissions', async () => {
      const user = userEvent.setup()
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
      expect(switchElement).toHaveAttribute('aria-disabled', 'true')
      await user.click(switchElement)
      expect(mockEnable).not.toHaveBeenCalled()
      expect(mockDisable).not.toHaveBeenCalled()
    })

    it('should only render download action when download is the only granted document operation', async () => {
      const user = userEvent.setup()
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
      await user.click(moreButton)

      expect(
        screen.getByRole('menuitem', { name: 'datasetDocuments.list.action.download' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('menuitem', { name: 'datasetDocuments.list.table.rename' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('menuitem', { name: 'datasetDocuments.list.action.settings' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('menuitem', { name: 'datasetDocuments.list.action.archive' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('menuitem', { name: 'datasetDocuments.list.action.delete' }),
      ).not.toBeInTheDocument()
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
      const user = userEvent.setup()
      render(
        <Operations {...defaultProps} scene="list" detail={{ ...defaultDetail, enabled: false }} />,
      )
      const switchElement = screen.getByRole('switch', {
        name: 'datasetDocuments.list.status.enabled: Test Document',
      })
      await user.click(switchElement)
      await waitFor(() =>
        expect(mockEnable).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', action: 'enable' },
          query: { document_id: ['doc-1'] },
        }),
      )
    })

    it('should call disable when switch is toggled off', async () => {
      const user = userEvent.setup()
      render(
        <Operations {...defaultProps} scene="list" detail={{ ...defaultDetail, enabled: true }} />,
      )
      const switchElement = screen.getByRole('switch', {
        name: 'datasetDocuments.list.status.enabled: Test Document',
      })
      await user.click(switchElement)
      await waitFor(() =>
        expect(mockDisable).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', action: 'disable' },
          query: { document_id: ['doc-1'] },
        }),
      )
    })
  })

  describe('settings navigation', () => {
    it('should navigate to settings when settings menu item is clicked', async () => {
      const user = userEvent.setup()
      render(<Operations {...defaultProps} />)
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      const settingsButton = screen.getByRole('menuitem', {
        name: 'datasetDocuments.list.action.settings',
      })
      await user.click(settingsButton)
      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/documents/doc-1/settings')
    })

    it('should hide document settings when settings permission is not granted', async () => {
      const user = userEvent.setup()
      render(<Operations {...defaultProps} canViewSettings={false} />)

      const moreButton = screen.getByRole('button', { name: 'common.operation.more' })
      await user.click(moreButton)

      expect(
        screen.queryByRole('menuitem', { name: 'datasetDocuments.list.action.settings' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('detail scene', () => {
    it('should not render switch in detail scene', () => {
      render(<Operations {...defaultProps} scene="detail" />)

      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    })
  })

  describe('popover menu actions', () => {
    const openPopover = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    }

    it('should call archive when archive action is clicked', async () => {
      const user = userEvent.setup()
      render(<Operations {...defaultProps} />)
      await openPopover(user)
      const archiveButton = screen.getByRole('menuitem', {
        name: 'datasetDocuments.list.action.archive',
      })
      await user.click(archiveButton)
      await waitFor(() => {
        expect(mockArchive).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', action: 'archive' },
          query: { document_id: ['doc-1'] },
        })
      })
    })

    it('should call un_archive when unarchive action is clicked', async () => {
      const user = userEvent.setup()
      render(<Operations {...defaultProps} detail={{ ...defaultDetail, archived: true }} />)
      await openPopover(user)
      const unarchiveButton = screen.getByRole('menuitem', {
        name: 'datasetDocuments.list.action.unarchive',
      })
      await user.click(unarchiveButton)
      await waitFor(() => {
        expect(mockUnArchive).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', action: 'un_archive' },
          query: { document_id: ['doc-1'] },
        })
      })
    })

    it('should call sync for notion data source', async () => {
      const user = userEvent.setup()
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, data_source_type: 'notion_import' }}
        />,
      )
      await openPopover(user)
      const syncButton = screen.getByRole('menuitem', { name: 'datasetDocuments.list.action.sync' })
      await user.click(syncButton)
      await waitFor(() => {
        expect(mockSync).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', document_id: 'doc-1' },
        })
      })
    })

    it('should call syncWebsite for web data source', async () => {
      const user = userEvent.setup()
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, data_source_type: 'website_crawl' }}
        />,
      )
      await openPopover(user)
      const syncButton = screen.getByRole('menuitem', { name: 'datasetDocuments.list.action.sync' })
      await user.click(syncButton)
      await waitFor(() => {
        expect(mockSyncWebsite).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', document_id: 'doc-1' },
        })
      })
    })

    it('should call pause when pause action is clicked', async () => {
      const user = userEvent.setup()
      render(
        <Operations {...defaultProps} detail={{ ...defaultDetail, display_status: 'indexing' }} />,
      )
      await openPopover(user)
      const pauseButton = screen.getByRole('menuitem', {
        name: 'datasetDocuments.list.action.pause',
      })
      await user.click(pauseButton)
      await waitFor(() => {
        expect(mockPause).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', document_id: 'doc-1' },
        })
      })
    })

    it('should call resume when resume action is clicked', async () => {
      const user = userEvent.setup()
      render(
        <Operations {...defaultProps} detail={{ ...defaultDetail, display_status: 'paused' }} />,
      )
      await openPopover(user)
      const resumeButton = screen.getByRole('menuitem', {
        name: 'datasetDocuments.list.action.resume',
      })
      await user.click(resumeButton)
      await waitFor(() => {
        expect(mockResume).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', document_id: 'doc-1' },
        })
      })
    })

    it('should download file when download action is clicked', async () => {
      const user = userEvent.setup()
      render(<Operations {...defaultProps} />)
      await openPopover(user)
      const downloadButton = screen.getByRole('menuitem', {
        name: 'datasetDocuments.list.action.download',
      })
      await user.click(downloadButton)
      await waitFor(() => {
        expect(mockDownload).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', document_id: 'doc-1' },
        })
        expect(downloads).toEqual([
          {
            url: 'https://example.com/download',
            fileName: 'Test Document',
          },
        ])
      })
    })

    it('should show settings for archived non-file data source', async () => {
      const user = userEvent.setup()
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, archived: true, data_source_type: 'notion_import' }}
        />,
      )
      await openPopover(user)
      expect(
        screen.getByRole('menuitem', { name: 'datasetDocuments.list.action.settings' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('menuitem', { name: 'datasetDocuments.list.action.download' }),
      ).not.toBeInTheDocument()
    })

    it('should download archived file when download is clicked', async () => {
      const user = userEvent.setup()
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, archived: true, data_source_type: 'upload_file' }}
        />,
      )
      await openPopover(user)
      const downloadButton = screen.getByRole('menuitem', {
        name: 'datasetDocuments.list.action.download',
      })
      await user.click(downloadButton)
      await waitFor(() => {
        expect(mockDownload).toHaveBeenCalledWith({
          params: { dataset_id: 'dataset-1', document_id: 'doc-1' },
        })
      })
    })
  })

  describe('error handling', () => {
    it('should show error notification when operation fails', async () => {
      const user = userEvent.setup()
      mockArchive.mockRejectedValue(new Error('API Error'))
      render(<Operations {...defaultProps} />)
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      const archiveButton = screen.getByRole('menuitem', {
        name: 'datasetDocuments.list.action.archive',
      })
      await user.click(archiveButton)
      await waitFor(() => {
        expect(screen.getByText('common.actionMsg.modifiedUnsuccessfully')).toBeInTheDocument()
        expect(mockOnUpdate).not.toHaveBeenCalled()
      })
    })

    it('should show error notification when download fails', async () => {
      const user = userEvent.setup()
      mockDownload.mockRejectedValue(new Error('Download Error'))
      render(<Operations {...defaultProps} />)
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      const downloadButton = screen.getByRole('menuitem', {
        name: 'datasetDocuments.list.action.download',
      })
      await user.click(downloadButton)
      await waitFor(() => {
        expect(screen.getByText('common.actionMsg.downloadUnsuccessfully')).toBeInTheDocument()
        expect(downloads).toEqual([])
      })
    })

    it('should show error notification when download returns no url', async () => {
      const user = userEvent.setup()
      mockDownload.mockResolvedValue({ url: '' })
      render(<Operations {...defaultProps} />)
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      const downloadButton = screen.getByRole('menuitem', {
        name: 'datasetDocuments.list.action.download',
      })
      await user.click(downloadButton)
      await waitFor(() => {
        expect(screen.getByText('common.actionMsg.downloadUnsuccessfully')).toBeInTheDocument()
        expect(downloads).toEqual([])
      })
    })
  })

  describe('display status', () => {
    it('should not show pause/resume for available status', async () => {
      const user = userEvent.setup()
      render(
        <Operations {...defaultProps} detail={{ ...defaultDetail, display_status: 'available' }} />,
      )
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      expect(
        screen.queryByRole('menuitem', { name: 'datasetDocuments.list.action.pause' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('menuitem', { name: 'datasetDocuments.list.action.resume' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('data source types', () => {
    it('should not show download for non-file data source', async () => {
      const user = userEvent.setup()
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, data_source_type: 'notion_import' }}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      expect(
        screen.queryByRole('menuitem', { name: 'datasetDocuments.list.action.download' }),
      ).not.toBeInTheDocument()
    })
  })
})
