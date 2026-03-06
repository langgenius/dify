import type { NotionPage } from '@/models/common'
import type { CrawlResultItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock child components - paths must match source file's imports (relative to source)
vi.mock('../../../file-preview', () => ({
  default: ({ file, hidePreview }: { file: { name: string }, hidePreview: () => void }) => (
    <div data-testid="file-preview">
      <span>{file.name}</span>
      <button data-testid="close-file" onClick={hidePreview}>close-file</button>
    </div>
  ),
}))

vi.mock('../../../notion-page-preview', () => ({
  default: ({ currentPage, hidePreview }: { currentPage: { page_name: string }, hidePreview: () => void }) => (
    <div data-testid="notion-preview">
      <span>{currentPage.page_name}</span>
      <button data-testid="close-notion" onClick={hidePreview}>close-notion</button>
    </div>
  ),
}))

vi.mock('../../../website/preview', () => ({
  default: ({ payload, hidePreview }: { payload: { title: string }, hidePreview: () => void }) => (
    <div data-testid="website-preview">
      <span>{payload.title}</span>
      <button data-testid="close-website" onClick={hidePreview}>close-website</button>
    </div>
  ),
}))

vi.mock('@/app/components/billing/plan-upgrade-modal', () => ({
  default: ({ show, onClose, title }: { show: boolean, onClose: () => void, title: string }) => show
    ? (
        <div data-testid="plan-upgrade-modal">
          <span>{title}</span>
          <button data-testid="close-modal" onClick={onClose}>close-modal</button>
        </div>
      )
    : null,
}))

const { default: PreviewPanel } = await import('../preview-panel')

describe('PreviewPanel', () => {
  const defaultProps = {
    currentFile: undefined,
    currentNotionPage: undefined,
    currentWebsite: undefined,
    notionCredentialId: 'cred-1',
    isShowPlanUpgradeModal: false,
    hideFilePreview: vi.fn(),
    hideNotionPagePreview: vi.fn(),
    hideWebsitePreview: vi.fn(),
    hidePlanUpgradeModal: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render nothing when no preview is active', () => {
      const { container } = render(<PreviewPanel {...defaultProps} />)
      expect(container.querySelector('[data-testid]')).toBeNull()
    })

    it('should render file preview when currentFile is set', () => {
      render(<PreviewPanel {...defaultProps} currentFile={{ name: 'test.pdf' } as unknown as File} />)
      expect(screen.getByTestId('file-preview')).toBeInTheDocument()
      expect(screen.getByText('test.pdf')).toBeInTheDocument()
    })

    it('should render notion preview when currentNotionPage is set', () => {
      render(<PreviewPanel {...defaultProps} currentNotionPage={{ page_name: 'My Page' } as unknown as NotionPage} />)
      expect(screen.getByTestId('notion-preview')).toBeInTheDocument()
      expect(screen.getByText('My Page')).toBeInTheDocument()
    })

    it('should render website preview when currentWebsite is set', () => {
      render(<PreviewPanel {...defaultProps} currentWebsite={{ title: 'My Site' } as unknown as CrawlResultItem} />)
      expect(screen.getByTestId('website-preview')).toBeInTheDocument()
      expect(screen.getByText('My Site')).toBeInTheDocument()
    })

    it('should render plan upgrade modal when isShowPlanUpgradeModal is true', () => {
      render(<PreviewPanel {...defaultProps} isShowPlanUpgradeModal />)
      expect(screen.getByTestId('plan-upgrade-modal')).toBeInTheDocument()
    })
  })

  describe('interactions', () => {
    it('should call hideFilePreview when file preview close clicked', () => {
      render(<PreviewPanel {...defaultProps} currentFile={{ name: 'test.pdf' } as unknown as File} />)
      fireEvent.click(screen.getByTestId('close-file'))
      expect(defaultProps.hideFilePreview).toHaveBeenCalledOnce()
    })

    it('should call hidePlanUpgradeModal when modal close clicked', () => {
      render(<PreviewPanel {...defaultProps} isShowPlanUpgradeModal />)
      fireEvent.click(screen.getByTestId('close-modal'))
      expect(defaultProps.hidePlanUpgradeModal).toHaveBeenCalledOnce()
    })

    it('should call hideNotionPagePreview when notion preview close clicked', () => {
      render(<PreviewPanel {...defaultProps} currentNotionPage={{ page_name: 'My Page' } as unknown as NotionPage} />)
      fireEvent.click(screen.getByTestId('close-notion'))
      expect(defaultProps.hideNotionPagePreview).toHaveBeenCalledOnce()
    })

    it('should call hideWebsitePreview when website preview close clicked', () => {
      render(<PreviewPanel {...defaultProps} currentWebsite={{ title: 'My Site' } as unknown as CrawlResultItem} />)
      fireEvent.click(screen.getByTestId('close-website'))
      expect(defaultProps.hideWebsitePreview).toHaveBeenCalledOnce()
    })
  })
})
