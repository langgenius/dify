import type { NotionPage } from '@/models/common'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PreviewPanel from '../preview-panel'

vi.mock('../../../file-preview', () => ({
  default: ({ file, hidePreview }: { file: { name: string }; hidePreview: () => void }) => (
    <div>
      <span>{file.name}</span>
      <button type="button" onClick={hidePreview}>
        Close file preview
      </button>
    </div>
  ),
}))

vi.mock('../../../notion-page-preview', () => ({
  default: ({
    currentPage,
    hidePreview,
  }: {
    currentPage: { page_name: string }
    hidePreview: () => void
  }) => (
    <div>
      <span>{currentPage.page_name}</span>
      <button type="button" onClick={hidePreview}>
        Close Notion preview
      </button>
    </div>
  ),
}))

vi.mock('../../../website/preview', () => ({
  default: () => <div>Website preview</div>,
}))

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

describe('PreviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('closes the active file preview', async () => {
    const user = userEvent.setup()
    render(<PreviewPanel {...defaultProps} currentFile={{ name: 'report.pdf' } as File} />)

    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close file preview' }))

    expect(defaultProps.hideFilePreview).toHaveBeenCalledOnce()
  })

  it('closes the active Notion preview', async () => {
    const user = userEvent.setup()
    render(
      <PreviewPanel
        {...defaultProps}
        currentNotionPage={{ page_name: 'Product docs' } as NotionPage}
      />,
    )

    expect(screen.getByText('Product docs')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close Notion preview' }))

    expect(defaultProps.hideNotionPagePreview).toHaveBeenCalledOnce()
  })

  it('dismisses the plan upgrade modal', async () => {
    const user = userEvent.setup()
    render(<PreviewPanel {...defaultProps} isShowPlanUpgradeModal />)

    await user.click(screen.getByRole('button', { name: 'billing.triggerLimitModal.dismiss' }))

    expect(defaultProps.hidePlanUpgradeModal).toHaveBeenCalledOnce()
  })
})
