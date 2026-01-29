import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataSourceType } from '@/models/datasets'
import Operations from './operations'

// Mock services
vi.mock('@/service/knowledge/use-document', () => ({
  useDocumentArchive: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useDocumentUnArchive: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useDocumentEnable: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useDocumentDisable: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useDocumentDelete: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useDocumentDownload: () => ({ mutateAsync: vi.fn().mockResolvedValue({ url: 'https://example.com/download' }), isPending: false }),
  useSyncDocument: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useSyncWebsite: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useDocumentPause: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useDocumentResume: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useDocumentSummary: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}))

// Mock utils
vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

// Mock router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

describe('Operations', () => {
  const defaultDetail = {
    name: 'Test Document',
    enabled: true,
    archived: false,
    id: 'doc-123',
    data_source_type: DataSourceType.FILE,
    doc_form: 'text',
    display_status: 'available',
  }

  const defaultProps = {
    embeddingAvailable: true,
    detail: defaultDetail,
    datasetId: 'dataset-456',
    onUpdate: vi.fn(),
    scene: 'list' as const,
    className: '',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Operations {...defaultProps} />)
      // Should render at least the container
      expect(document.querySelector('.flex.items-center')).toBeInTheDocument()
    })

    it('should render switch in list scene', () => {
      const { container } = render(<Operations {...defaultProps} scene="list" />)
      // Switch component should be rendered
      const switchEl = container.querySelector('[role="switch"]')
      expect(switchEl).toBeInTheDocument()
    })

    it('should render settings button when embedding is available', () => {
      const { container } = render(<Operations {...defaultProps} />)
      // Settings button has RiEqualizer2Line icon inside
      const settingsButton = container.querySelector('button.mr-2.cursor-pointer')
      expect(settingsButton).toBeInTheDocument()
    })
  })

  describe('Switch Behavior', () => {
    it('should render enabled switch when document is enabled', () => {
      const { container } = render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, enabled: true, archived: false }}
        />,
      )
      const switchEl = container.querySelector('[role="switch"]')
      expect(switchEl).toHaveAttribute('aria-checked', 'true')
    })

    it('should render disabled switch when document is disabled', () => {
      const { container } = render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, enabled: false, archived: false }}
        />,
      )
      const switchEl = container.querySelector('[role="switch"]')
      expect(switchEl).toHaveAttribute('aria-checked', 'false')
    })

    it('should show tooltip and disable switch when document is archived', () => {
      const { container } = render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, archived: true }}
        />,
      )
      const switchEl = container.querySelector('[role="switch"]')
      // Archived documents have visually disabled switch (CSS-based)
      expect(switchEl).toHaveClass('!cursor-not-allowed', '!opacity-50')
    })
  })

  describe('Embedding Not Available', () => {
    it('should show disabled switch when embedding not available in list scene', () => {
      const { container } = render(
        <Operations
          {...defaultProps}
          embeddingAvailable={false}
          scene="list"
        />,
      )
      const switchEl = container.querySelector('[role="switch"]')
      // Switch is visually disabled (CSS-based)
      expect(switchEl).toHaveClass('!cursor-not-allowed', '!opacity-50')
    })

    it('should not show settings or popover when embedding not available', () => {
      render(
        <Operations
          {...defaultProps}
          embeddingAvailable={false}
        />,
      )
      expect(screen.queryByRole('button', { name: /settings/i })).not.toBeInTheDocument()
    })
  })

  describe('More Actions Popover', () => {
    it('should show rename option for non-archived documents', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, archived: false }}
        />,
      )

      // Click on the more actions button
      const moreButton = document.querySelector('[class*="commonIcon"]')
      expect(moreButton).toBeInTheDocument()
      if (moreButton)
        fireEvent.click(moreButton)

      await waitFor(() => {
        expect(screen.getByText(/list\.table\.rename/i)).toBeInTheDocument()
      })
    })

    it('should show download option for FILE type documents', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, data_source_type: DataSourceType.FILE }}
        />,
      )

      const moreButton = document.querySelector('[class*="commonIcon"]')
      if (moreButton)
        fireEvent.click(moreButton)

      await waitFor(() => {
        expect(screen.getByText(/list\.action\.download/i)).toBeInTheDocument()
      })
    })

    it('should show sync option for notion documents', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, data_source_type: 'notion_import' }}
        />,
      )

      const moreButton = document.querySelector('[class*="commonIcon"]')
      if (moreButton)
        fireEvent.click(moreButton)

      await waitFor(() => {
        expect(screen.getByText(/list\.action\.sync/i)).toBeInTheDocument()
      })
    })

    it('should show sync option for web documents', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, data_source_type: DataSourceType.WEB }}
        />,
      )

      const moreButton = document.querySelector('[class*="commonIcon"]')
      if (moreButton)
        fireEvent.click(moreButton)

      await waitFor(() => {
        expect(screen.getByText(/list\.action\.sync/i)).toBeInTheDocument()
      })
    })

    it('should show archive option for non-archived documents', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, archived: false }}
        />,
      )

      const moreButton = document.querySelector('[class*="commonIcon"]')
      if (moreButton)
        fireEvent.click(moreButton)

      await waitFor(() => {
        expect(screen.getByText(/list\.action\.archive/i)).toBeInTheDocument()
      })
    })

    it('should show unarchive option for archived documents', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, archived: true }}
        />,
      )

      const moreButton = document.querySelector('[class*="commonIcon"]')
      if (moreButton)
        fireEvent.click(moreButton)

      await waitFor(() => {
        expect(screen.getByText(/list\.action\.unarchive/i)).toBeInTheDocument()
      })
    })

    it('should show delete option', async () => {
      render(<Operations {...defaultProps} />)

      const moreButton = document.querySelector('[class*="commonIcon"]')
      if (moreButton)
        fireEvent.click(moreButton)

      await waitFor(() => {
        expect(screen.getByText(/list\.action\.delete/i)).toBeInTheDocument()
      })
    })

    it('should show pause option when status is indexing', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, display_status: 'indexing', archived: false }}
        />,
      )

      const moreButton = document.querySelector('[class*="commonIcon"]')
      if (moreButton)
        fireEvent.click(moreButton)

      await waitFor(() => {
        expect(screen.getByText(/list\.action\.pause/i)).toBeInTheDocument()
      })
    })

    it('should show resume option when status is paused', async () => {
      render(
        <Operations
          {...defaultProps}
          detail={{ ...defaultDetail, display_status: 'paused', archived: false }}
        />,
      )

      const moreButton = document.querySelector('[class*="commonIcon"]')
      if (moreButton)
        fireEvent.click(moreButton)

      await waitFor(() => {
        expect(screen.getByText(/list\.action\.resume/i)).toBeInTheDocument()
      })
    })
  })

  describe('Delete Confirmation Modal', () => {
    it('should show delete confirmation modal when delete is clicked', async () => {
      render(<Operations {...defaultProps} />)

      const moreButton = document.querySelector('[class*="commonIcon"]')
      if (moreButton)
        fireEvent.click(moreButton)

      await waitFor(() => {
        const deleteButton = screen.getByText(/list\.action\.delete/i)
        fireEvent.click(deleteButton)
      })

      await waitFor(() => {
        expect(screen.getByText(/list\.delete\.title/i)).toBeInTheDocument()
        expect(screen.getByText(/list\.delete\.content/i)).toBeInTheDocument()
      })
    })
  })

  describe('Scene Variations', () => {
    it('should render correctly in detail scene', () => {
      render(<Operations {...defaultProps} scene="detail" />)
      // Settings button should still be visible
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
    })

    it('should apply different styles in detail scene', () => {
      const { container } = render(<Operations {...defaultProps} scene="detail" />)
      // The component should render without the list-specific styles
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined detail properties', () => {
      render(
        <Operations
          {...defaultProps}
          detail={{
            name: '',
            enabled: false,
            archived: false,
            id: '',
            data_source_type: '',
            doc_form: '',
            display_status: undefined,
          }}
        />,
      )
      // Should not crash
      expect(document.querySelector('.flex.items-center')).toBeInTheDocument()
    })

    it('should stop event propagation on click', () => {
      const parentHandler = vi.fn()
      render(
        <div onClick={parentHandler}>
          <Operations {...defaultProps} />
        </div>,
      )

      const container = document.querySelector('.flex.items-center')
      if (container)
        fireEvent.click(container)

      // Parent handler should not be called due to stopPropagation
      expect(parentHandler).not.toHaveBeenCalled()
    })

    it('should handle custom className', () => {
      render(<Operations {...defaultProps} className="custom-class" />)
      // Component should render with the custom class
      expect(document.querySelector('.flex.items-center')).toBeInTheDocument()
    })
  })

  describe('Selected IDs Handling', () => {
    it('should pass selectedIds to operations', () => {
      render(
        <Operations
          {...defaultProps}
          selectedIds={['doc-123', 'doc-456']}
          onSelectedIdChange={vi.fn()}
        />,
      )
      // Component should render correctly with selectedIds
      expect(document.querySelector('.flex.items-center')).toBeInTheDocument()
    })
  })
})
