import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LocalFilePreview } from '../local-file-preview'
import { canPreviewLocalFile } from '../local-file-preview-policy'

vi.mock('@/app/components/base/file-uploader/dynamic-pdf-preview', () => ({
  default: ({ onCancel, url }: { onCancel: () => void; url: string }) => (
    <button type="button" aria-label="PDF preview" data-url={url} onClick={onCancel}>
      PDF preview
    </button>
  ),
}))

describe('LocalFilePreview', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('offers component previews for browser-readable upload formats', () => {
    const previewableExtensions = [
      'csv',
      'htm',
      'html',
      'json',
      'jsonl',
      'md',
      'pdf',
      'text',
      'txt',
    ]
    const parserRequiredExtensions = ['doc', 'docx', 'epub', 'ppt', 'pptx', 'rtf', 'xls', 'xlsx']

    expect(
      previewableExtensions.every((extension) =>
        canPreviewLocalFile(new File(['content'], `document.${extension}`)),
      ),
    ).toBe(true)
    expect(
      parserRequiredExtensions.every(
        (extension) => !canPreviewLocalFile(new File(['content'], `document.${extension}`)),
      ),
    ).toBe(true)
  })

  it('renders UTF-8 HTML as inert text inside the app', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const file = new File(['<script>错误</script>\n让状态可分析'], '状态分析.html', {
      type: 'text/html',
    })

    render(<LocalFilePreview file={file} onClose={onClose} />)

    const dialog = await screen.findByRole('dialog', { name: file.name })
    const preview = await within(dialog).findByLabelText(file.name)
    expect(preview).toHaveTextContent('<script>错误</script> 让状态可分析')
    expect(dialog.querySelector('script')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('previews PDFs with a component-owned object URL and releases it on unmount', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pdf-preview')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const file = new File(['pdf'], 'guide.pdf', { type: 'application/pdf' })

    const { unmount } = render(<LocalFilePreview file={file} onClose={onClose} />)

    const preview = await screen.findByRole('button', { name: 'PDF preview' })
    expect(preview).toHaveAttribute('data-url', 'blob:pdf-preview')
    expect(createObjectUrl).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'application/pdf' }),
    )

    await user.click(preview)
    expect(onClose).toHaveBeenCalledOnce()

    unmount()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:pdf-preview')
  })
})
