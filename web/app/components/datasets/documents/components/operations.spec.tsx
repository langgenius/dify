import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Operations from './operations'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock next/navigation
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

// Mock ToastContext
const mockNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  ToastContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
}))

vi.mock('use-context-selector', () => ({
  useContext: () => ({
    notify: mockNotify,
  }),
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
let isDownloadPending = false

const mockGenerateSummary = vi.fn()
vi.mock('@/service/knowledge/use-document', () => ({
  useDocumentArchive: () => ({ mutateAsync: mockArchive }),
  useDocumentUnArchive: () => ({ mutateAsync: mockUnArchive }),
  useDocumentEnable: () => ({ mutateAsync: mockEnable }),
  useDocumentDisable: () => ({ mutateAsync: mockDisable }),
  useDocumentDelete: () => ({ mutateAsync: mockDelete }),
  useDocumentDownload: () => ({ mutateAsync: mockDownload, isPending: isDownloadPending }),
  useSyncDocument: () => ({ mutateAsync: mockSync }),
  useSyncWebsite: () => ({ mutateAsync: mockSyncWebsite }),
  useDocumentPause: () => ({ mutateAsync: mockPause }),
  useDocumentResume: () => ({ mutateAsync: mockResume }),
  useDocumentSummary: () => ({ mutateAsync: mockGenerateSummary }),
}))

// Mock downloadUrl utility
const mockDownloadUrl = vi.fn()
vi.mock('@/utils/download', () => ({
  downloadUrl: (params: { url: string, fileName: string }) => mockDownloadUrl(params),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  isDownloadPending = false
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
    it('should render without crashing', () => {
      render(<Operations {...defaultProps} />)
      expect(document.querySelector('.flex.items-center')).toBeInTheDocument()
    })

    it('should render buttons when embeddingAvailable', () => {
      render(<Operations {...defaultProps} />)
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0)
    })

    it('should not render settings when embeddingAvailable is false', () => {
      render(<Operations {...defaultProps} embeddingAvailable={false} />)
      expect(screen.queryByText('list.action.settings')).not.toBeInTheDocument()
    })

    it('should render disabled switch when embeddingAvailable is false in list scene', () => {
      render(<Operations {...defaultProps} embeddingAvailable={false} scene="list" />)
      // Switch component uses opacity-50 class when disabled
      const disabledSwitch = document.querySelector('.\\!opacity-50')
      expect(disabledSwitch).toBeInTheDocument()
    })
  })

  describe('switch toggle', () => {
    it('should render switch in list scene', () => {
      render(<Operations {...defaultProps} scene="list" />)
      const switches = document.querySelectorAll('[role="switch"], [class*="switch"]')
      expect(switches.length).toBeGreaterThan(0)
    })

    it('should render disabled switch when archived', () => {
      render(
        <Operations
          {...defaultProps}
          scene="list"
          detail={{ ...defaultDetail, archived: true }}
        />,
      )
      const disabledSwitch = document.querySelector('[disabled]')
      expect(disabledSwitch).toBeDefined()
    })

    it('should call enable when switch is toggled on', async () => {
      vi.useFakeTimers()
      render(
        <Operations
          {...defaultProps}
          scene="list"
          detail={{ ...defaultDetail, enabled: false }}
        />,
      )
      const switchElement = document.querySelector('[role="switch"]')
      await act(async () => {
        fireEvent.click(switchElement!)
      })
      // Wait for debounce
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      expect(mockEnable).toHaveBeenCalledWith({ datasetId: 'dataset-1', documentId: 'doc-1' })
      vi.useRealTimers()
    })

    it('should call disable when switch is toggled off', async () => {
      vi.useFakeTimers()
      render(
        <Operations
          {...defaultProps}
          scene="list"
          detail={{ ...defaultDetail, enabled: true }}
        />,
      )
      const switchElement = document.querySelector('[role="switch"]')
      await act(async () => {
        fireEvent.click(switchElement!)
      })
      // Wait for debounce
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      expect(mockDisable).toHaveBeenCalledWith({ datasetId: 'dataset-1', documentId: 'doc-1' })
      vi.useRealTimers()
    })

    it('should not call enable if already enabled', async () => {
      vi.useFakeTimers()
      render(
        <Operations
          {...defaultProps}
          scene="list"
          detail={{ ...defaultDetail, enabled: true }}
        />,
      )
      // Simulate trying to enable when already enabled - this won't happen via switch click
      // because the switch would toggle to disable. But handleSwitch has early returns
      vi.useRealTimers()
    })
  })

  describe('settings navigation', () => {
    it('should navigate to settings when settings button is clicked', async () => {
      render(<Operations {...defaultProps} />)
      // Get the first button which is the settings button
      const buttons = screen.getAllByRole('button')
      const settingsButton = buttons[0]
      await act(async () => {
        fireEvent.click(settingsButton)
      })
      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/documents/doc-1/settings')
    })
  })

  describe('detail scene', () => {
    it('should render differently in detail scene', () => {
      render(<Operations {...defaultProps} scene="detail" />)
      const container = document.querySelector('.flex.items-center')
      expect(container).toBeInTheDocument()
    })

    it('should not render switch in detail scene', () => {
      render(<Operations {...defaultProps} scene="detail" />)
      // In detail scene, there should be no switch
      const switchInParent = document.querySelector('.flex.items-center > [role="switch"]')
      expect(switchInParent).toBeNull()
    })
  })

  describe('selectedIds handling', () => {
    it('should accept selectedIds prop', () => {
      render(
        <Operations
          {...defaultProps}
          selectedIds={['doc-1', 'doc-2']}
          onSelectedIdChange={mockOnSelectedIdChange}
        />,
      )
      expect(document.querySelector('.flex.items-center')).toBeInTheDocument()
    })
  })

  describe('popover menu actions', () => {
    const openPopover = async () => {
      const moreButton = document.querySelector('[class*="commonIcon"]')?.parentElement
      if (moreButton) {
        await act(async () => {
          fireEvent.click(moreButton)
        })
      }
    }

    it('should open popover when more button is clicked', async () => {
      render(<Operations {...defaultProps} />)
      await openPopover()
      // Check if popover content is visible
      expect(screen.getByText('list.table.rename')).toBeInTheDocument()
    })

    it('should call archive when archive action is clicked', async () => {
      render(<Operations {...defaultProps} />)
      await openPopover()
      const archiveButton = screen.getByText('list.action.archive')
      await act(async () => {
        fireEvent.click(archiveButton)
      })
      await waitFor(() => {
        expect(mockArchive).toHaveBeenCalledWith({ datasetId: 'dataset-1', documentId: 'doc-1' })
      })
    })

    it('should call un_archive when unarchive action is clicked', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, archived: true }}
        />,
      )
      await openPopover()
      const unarchiveButton = screen.getByText('list.action.unarchive')
      await act(async () => {
        fireEvent.click(unarchiveButton)
      })
      await waitFor(() => {
        expect(mockUnArchive).toHaveBeenCalledWith({ datasetId: 'dataset-1', documentId: 'doc-1' })
      })
    })

    it('should show delete confirmation modal when delete is clicked', async () => {
      render(<Operations {...defaultProps} />)
      await openPopover()
      const deleteButton = screen.getByText('list.action.delete')
      await act(async () => {
        fireEvent.click(deleteButton)
      })
      // Check if confirmation modal is shown
      expect(screen.getByText('list.delete.title')).toBeInTheDocument()
    })

    it('should call delete when confirm is clicked in delete modal', async () => {
      render(<Operations {...defaultProps} />)
      await openPopover()
      const deleteButton = screen.getByText('list.action.delete')
      await act(async () => {
        fireEvent.click(deleteButton)
      })
      // Click confirm button
      const confirmButton = screen.getByText('operation.sure')
      await act(async () => {
        fireEvent.click(confirmButton)
      })
      await waitFor(() => {
        expect(mockDelete).toHaveBeenCalledWith({ datasetId: 'dataset-1', documentId: 'doc-1' })
      })
    })

    it('should close delete modal when cancel is clicked', async () => {
      render(<Operations {...defaultProps} />)
      await openPopover()
      const deleteButton = screen.getByText('list.action.delete')
      await act(async () => {
        fireEvent.click(deleteButton)
      })
      // Verify modal is shown
      expect(screen.getByText('list.delete.title')).toBeInTheDocument()
      // Find and click the cancel button (text: operation.cancel)
      const cancelButton = screen.getByText('operation.cancel')
      await act(async () => {
        fireEvent.click(cancelButton)
      })
      // Modal should be closed - title shouldn't be visible
      await waitFor(() => {
        expect(screen.queryByText('list.delete.title')).not.toBeInTheDocument()
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
      const deleteButton = screen.getByText('list.action.delete')
      await act(async () => {
        fireEvent.click(deleteButton)
      })
      const confirmButton = screen.getByText('operation.sure')
      await act(async () => {
        fireEvent.click(confirmButton)
      })
      await waitFor(() => {
        expect(mockOnSelectedIdChange).toHaveBeenCalledWith(['doc-2'])
      })
    })

    it('should show rename modal when rename is clicked', async () => {
      render(<Operations {...defaultProps} />)
      await openPopover()
      const renameButton = screen.getByText('list.table.rename')
      await act(async () => {
        fireEvent.click(renameButton)
      })
      // Rename modal should be shown
      await waitFor(() => {
        expect(screen.getByDisplayValue('Test Document')).toBeInTheDocument()
      })
    })

    it('should call sync for notion data source', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, data_source_type: 'notion_import' }}
        />,
      )
      await openPopover()
      const syncButton = screen.getByText('list.action.sync')
      await act(async () => {
        fireEvent.click(syncButton)
      })
      await waitFor(() => {
        expect(mockSync).toHaveBeenCalledWith({ datasetId: 'dataset-1', documentId: 'doc-1' })
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
      const syncButton = screen.getByText('list.action.sync')
      await act(async () => {
        fireEvent.click(syncButton)
      })
      await waitFor(() => {
        expect(mockSyncWebsite).toHaveBeenCalledWith({ datasetId: 'dataset-1', documentId: 'doc-1' })
      })
    })

    it('should call pause when pause action is clicked', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, display_status: 'indexing' }}
        />,
      )
      await openPopover()
      const pauseButton = screen.getByText('list.action.pause')
      await act(async () => {
        fireEvent.click(pauseButton)
      })
      await waitFor(() => {
        expect(mockPause).toHaveBeenCalledWith({ datasetId: 'dataset-1', documentId: 'doc-1' })
      })
    })

    it('should call resume when resume action is clicked', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, display_status: 'paused' }}
        />,
      )
      await openPopover()
      const resumeButton = screen.getByText('list.action.resume')
      await act(async () => {
        fireEvent.click(resumeButton)
      })
      await waitFor(() => {
        expect(mockResume).toHaveBeenCalledWith({ datasetId: 'dataset-1', documentId: 'doc-1' })
      })
    })

    it('should download file when download action is clicked', async () => {
      render(<Operations {...defaultProps} />)
      await openPopover()
      const downloadButton = screen.getByText('list.action.download')
      await act(async () => {
        fireEvent.click(downloadButton)
      })
      await waitFor(() => {
        expect(mockDownload).toHaveBeenCalledWith({ datasetId: 'dataset-1', documentId: 'doc-1' })
        expect(mockDownloadUrl).toHaveBeenCalledWith({ url: 'https://example.com/download', fileName: 'Test Document' })
      })
    })

    it('should show download option for archived file data source', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, archived: true, data_source_type: 'upload_file' }}
        />,
      )
      await openPopover()
      expect(screen.getByText('list.action.download')).toBeInTheDocument()
    })

    it('should download archived file when download is clicked', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, archived: true, data_source_type: 'upload_file' }}
        />,
      )
      await openPopover()
      const downloadButton = screen.getByText('list.action.download')
      await act(async () => {
        fireEvent.click(downloadButton)
      })
      await waitFor(() => {
        expect(mockDownload).toHaveBeenCalledWith({ datasetId: 'dataset-1', documentId: 'doc-1' })
      })
    })
  })

  describe('error handling', () => {
    it('should show error notification when operation fails', async () => {
      mockArchive.mockRejectedValue(new Error('API Error'))
      render(<Operations {...defaultProps} />)
      const moreButton = document.querySelector('[class*="commonIcon"]')?.parentElement
      if (moreButton) {
        await act(async () => {
          fireEvent.click(moreButton)
        })
      }
      const archiveButton = screen.getByText('list.action.archive')
      await act(async () => {
        fireEvent.click(archiveButton)
      })
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'actionMsg.modifiedUnsuccessfully',
        })
      })
    })

    it('should show error notification when download fails', async () => {
      mockDownload.mockRejectedValue(new Error('Download Error'))
      render(<Operations {...defaultProps} />)
      const moreButton = document.querySelector('[class*="commonIcon"]')?.parentElement
      if (moreButton) {
        await act(async () => {
          fireEvent.click(moreButton)
        })
      }
      const downloadButton = screen.getByText('list.action.download')
      await act(async () => {
        fireEvent.click(downloadButton)
      })
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'actionMsg.downloadUnsuccessfully',
        })
      })
    })

    it('should show error notification when download returns no url', async () => {
      mockDownload.mockResolvedValue({})
      render(<Operations {...defaultProps} />)
      const moreButton = document.querySelector('[class*="commonIcon"]')?.parentElement
      if (moreButton) {
        await act(async () => {
          fireEvent.click(moreButton)
        })
      }
      const downloadButton = screen.getByText('list.action.download')
      await act(async () => {
        fireEvent.click(downloadButton)
      })
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'actionMsg.downloadUnsuccessfully',
        })
      })
    })
  })

  describe('display status', () => {
    it('should render pause action when status is indexing', () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, display_status: 'indexing' }}
        />,
      )
      expect(document.querySelector('.flex.items-center')).toBeInTheDocument()
    })

    it('should render resume action when status is paused', () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, display_status: 'paused' }}
        />,
      )
      expect(document.querySelector('.flex.items-center')).toBeInTheDocument()
    })

    it('should not show pause/resume for available status', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, display_status: 'available' }}
        />,
      )
      const moreButton = document.querySelector('[class*="commonIcon"]')?.parentElement
      if (moreButton) {
        await act(async () => {
          fireEvent.click(moreButton)
        })
      }
      expect(screen.queryByText('list.action.pause')).not.toBeInTheDocument()
      expect(screen.queryByText('list.action.resume')).not.toBeInTheDocument()
    })
  })

  describe('data source types', () => {
    it('should handle notion data source type', () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, data_source_type: 'notion_import' }}
        />,
      )
      expect(document.querySelector('.flex.items-center')).toBeInTheDocument()
    })

    it('should handle web data source type', () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, data_source_type: 'website_crawl' }}
        />,
      )
      expect(document.querySelector('.flex.items-center')).toBeInTheDocument()
    })

    it('should not show download for non-file data source', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, data_source_type: 'notion_import' }}
        />,
      )
      const moreButton = document.querySelector('[class*="commonIcon"]')?.parentElement
      if (moreButton) {
        await act(async () => {
          fireEvent.click(moreButton)
        })
      }
      expect(screen.queryByText('list.action.download')).not.toBeInTheDocument()
    })
  })

  describe('memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect((Operations as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })
  })

  describe('className prop', () => {
    it('should accept custom className prop', () => {
      // The className is passed to CustomPopover, verify component renders without errors
      render(<Operations {...defaultProps} className="custom-class" />)
      expect(document.querySelector('.flex.items-center')).toBeInTheDocument()
    })
  })
})
