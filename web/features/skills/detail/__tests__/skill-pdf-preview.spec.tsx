import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { SkillPdfPreview } from '../skill-pdf-preview'

const { mockLoader } = vi.hoisted(() => ({
  mockLoader: { failed: false, mounts: 0 },
}))

// Mirrors the real PdfLoader contract: on a failed load it renders
// `errorMessage` instead of the children, and it only reloads when `url`
// changes, so a retry has to come from a remount.
vi.mock('@/app/components/base/file-uploader/pdf-highlighter-adapter', () => ({
  PdfLoader: ({
    children,
    beforeLoad,
    workerSrc,
    errorMessage,
  }: {
    children: (doc: unknown) => ReactNode
    beforeLoad: ReactNode
    workerSrc?: string
    errorMessage?: ReactNode
  }) => {
    mockLoader.mounts += 1
    return (
      <div data-testid="pdf-loader" data-worker-src={workerSrc}>
        {mockLoader.failed && errorMessage ? (
          errorMessage
        ) : (
          <>
            {beforeLoad}
            {children({ numPages: 1 })}
          </>
        )}
      </div>
    )
  },
  PdfHighlighter: () => <div data-testid="pdf-highlighter" />,
}))

describe('SkillPdfPreview', () => {
  beforeEach(() => {
    mockLoader.failed = false
    mockLoader.mounts = 0
  })

  it('should load the pdf worker from the configured base path', async () => {
    vi.resetModules()
    vi.doMock('@/utils/var', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/utils/var')>()
      return { ...actual, basePath: '/dify' }
    })
    const { SkillPdfPreview: SubPathSkillPdfPreview } = await import('../skill-pdf-preview')

    render(<SubPathSkillPdfPreview fileName="guide.pdf" url="https://example.com/guide.pdf" />)

    expect(screen.getByTestId('pdf-loader')).toHaveAttribute(
      'data-worker-src',
      '/dify/pdf.worker.min.mjs',
    )
  })

  it('should load the pdf worker from the origin root when no base path is configured', () => {
    render(<SkillPdfPreview fileName="guide.pdf" url="https://example.com/guide.pdf" />)

    expect(screen.getByTestId('pdf-loader')).toHaveAttribute(
      'data-worker-src',
      '/pdf.worker.min.mjs',
    )
  })

  it('should show the load-failure state and remount the loader on retry', () => {
    mockLoader.failed = true

    render(<SkillPdfPreview fileName="guide.pdf" url="https://example.com/guide.pdf" />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByTestId('pdf-loader')).toBeInTheDocument()
    const mountsBeforeRetry = mockLoader.mounts

    fireEvent.click(screen.getByRole('button'))

    expect(mockLoader.mounts).toBeGreaterThan(mountsBeforeRetry)
  })
})
