import { render, screen } from '@testing-library/react'
import * as React from 'react'
import Loading from '@/app/components/base/loading'
import FilePreviewRenderer from '../file-preview-renderer'

const mocks = vi.hoisted(() => ({
  dynamicLoaders: [] as Array<() => React.ReactNode>,
  dynamicImporters: [] as Array<() => Promise<unknown>>,
  dynamicComponents: [
    ({ downloadUrl }: { downloadUrl: string }) => <div data-testid="sqlite-preview">{downloadUrl}</div>,
    ({ downloadUrl }: { downloadUrl: string }) => <div data-testid="pdf-preview">{downloadUrl}</div>,
  ],
  dynamicIndex: 0,
}))

vi.mock('@/next/dynamic', () => ({
  default: (loader: () => Promise<unknown>, options?: { loading?: () => React.ReactNode }) => {
    mocks.dynamicImporters.push(loader)
    if (options?.loading)
      mocks.dynamicLoaders.push(options.loading)
    return mocks.dynamicComponents[mocks.dynamicIndex++]
  },
}))

vi.mock('../../../../viewer/media-file-preview', () => ({
  default: ({ type, src }: { type: string, src: string }) => <div data-testid="media-preview">{`${type}:${src}`}</div>,
}))

vi.mock('../../../../viewer/unsupported-file-download', () => ({
  default: ({ name, size, downloadUrl }: { name: string, size?: number, downloadUrl: string }) => (
    <div data-testid="unsupported-preview">{`${name}:${String(size)}:${downloadUrl}`}</div>
  ),
}))

vi.mock('../../../../viewer/sqlite-file-preview', () => ({
  default: ({ downloadUrl }: { downloadUrl: string }) => <div data-testid="resolved-sqlite-preview">{downloadUrl}</div>,
}))

vi.mock('../../../../viewer/pdf-file-preview', () => ({
  default: ({ downloadUrl }: { downloadUrl: string }) => <div data-testid="resolved-pdf-preview">{downloadUrl}</div>,
}))
describe('FilePreviewRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dynamicLoaders.length = 0
    mocks.dynamicImporters.length = 0
    mocks.dynamicIndex = 0
  })

  it('should render media, sqlite, pdf, and unsupported previews for each preview state', () => {
    const { rerender } = render(
      <FilePreviewRenderer
        state={{ kind: 'preview', preview: 'media', mediaType: 'video', downloadUrl: 'https://example.com/demo.mp4' }}
      />,
    )

    expect(screen.getByTestId('media-preview')).toHaveTextContent('video:https://example.com/demo.mp4')

    rerender(
      <FilePreviewRenderer
        state={{ kind: 'preview', preview: 'sqlite', fileTabId: 'file-1', downloadUrl: 'https://example.com/demo.db' }}
      />,
    )
    expect(screen.getByTestId('sqlite-preview')).toHaveTextContent('https://example.com/demo.db')

    rerender(
      <FilePreviewRenderer
        state={{ kind: 'preview', preview: 'pdf', downloadUrl: 'https://example.com/demo.pdf' }}
      />,
    )
    expect(screen.getByTestId('pdf-preview')).toHaveTextContent('https://example.com/demo.pdf')

    rerender(
      <FilePreviewRenderer
        state={{
          kind: 'preview',
          preview: 'unsupported',
          fileName: 'archive.bin',
          fileSize: 42,
          downloadUrl: 'https://example.com/archive.bin',
        }}
      />,
    )
    expect(screen.getByTestId('unsupported-preview')).toHaveTextContent('archive.bin:42:https://example.com/archive.bin')
  })

  it('should expose loading placeholders and dynamic importers for async previews', async () => {
    vi.resetModules()
    mocks.dynamicLoaders.length = 0
    mocks.dynamicImporters.length = 0
    mocks.dynamicIndex = 0

    const previewRendererModule = await import('../file-preview-renderer')
    const FreshFilePreviewRenderer = previewRendererModule.default

    render(
      <FreshFilePreviewRenderer
        state={{ kind: 'preview', preview: 'sqlite', fileTabId: 'file-1', downloadUrl: 'https://example.com/demo.db' }}
      />,
    )

    expect(mocks.dynamicLoaders).toHaveLength(2)
    expect(mocks.dynamicImporters).toHaveLength(2)

    for (const renderLoader of mocks.dynamicLoaders) {
      const { unmount } = render(<>{renderLoader()}</>)
      expect(screen.getByRole('status')).toBeInTheDocument()
      unmount()
    }

    for (const loadModule of mocks.dynamicImporters)
      await expect(loadModule()).resolves.toBeTruthy()

    expect(Loading).toBeDefined()
  })
})
