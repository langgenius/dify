import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { SkillPdfPreview } from '../skill-pdf-preview'

vi.mock('@/app/components/base/file-uploader/pdf-highlighter-adapter', () => ({
  PdfLoader: ({
    children,
    beforeLoad,
    workerSrc,
  }: {
    children: (doc: unknown) => ReactNode
    beforeLoad: ReactNode
    workerSrc?: string
  }) => (
    <div data-testid="pdf-loader" data-worker-src={workerSrc}>
      {beforeLoad}
      {children({ numPages: 1 })}
    </div>
  ),
  PdfHighlighter: () => <div data-testid="pdf-highlighter" />,
}))

describe('SkillPdfPreview', () => {
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
})
