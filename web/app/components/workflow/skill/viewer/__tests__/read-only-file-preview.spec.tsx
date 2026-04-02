import { render, screen } from '@testing-library/react'
import Loading from '@/app/components/base/loading'
import ReadOnlyFilePreview from '../read-only-file-preview'

const mocks = vi.hoisted(() => ({
  fileTypeInfo: {
    isMarkdown: false,
    isCodeOrText: false,
    isImage: false,
    isVideo: false,
    isPdf: false,
    isSQLite: false,
    isEditable: false,
    isMediaFile: false,
    isPreviewable: false,
  },
  fetchState: {
    data: undefined as string | undefined,
    isLoading: false,
  },
  getFileLanguage: vi.fn((_: string) => 'typescript'),
  dynamicLoaders: [] as Array<() => React.ReactNode>,
  dynamicImporters: [] as Array<() => Promise<unknown>>,
  fetchArgs: [] as Array<string | undefined>,
  dynamicComponents: [
    ({ value, language }: { value: string, language: string }) => <div data-testid="code-preview">{`${language}:${value}`}</div>,
    ({ value }: { value: string }) => <div data-testid="markdown-preview">{value}</div>,
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

vi.mock('../media-file-preview', () => ({
  default: ({ type, src }: { type: string, src: string }) => <div data-testid="media-preview">{`${type}:${src}`}</div>,
}))

vi.mock('../read-only-code-preview', () => ({
  default: ({ value, language }: { value: string, language: string }) => <div data-testid="resolved-code-preview">{`${language}:${value}`}</div>,
}))

vi.mock('../read-only-markdown-preview', () => ({
  default: ({ value }: { value: string }) => <div data-testid="resolved-markdown-preview">{value}</div>,
}))

vi.mock('../sqlite-file-preview', () => ({
  default: ({ downloadUrl }: { downloadUrl: string }) => <div data-testid="resolved-sqlite-preview">{downloadUrl}</div>,
}))

vi.mock('../pdf-file-preview', () => ({
  default: ({ downloadUrl }: { downloadUrl: string }) => <div data-testid="resolved-pdf-preview">{downloadUrl}</div>,
}))

vi.mock('../unsupported-file-download', () => ({
  default: ({ name }: { name: string }) => <div data-testid="unsupported-preview">{name}</div>,
}))

vi.mock('../../hooks/use-file-type-info', () => ({
  useFileTypeInfo: () => mocks.fileTypeInfo,
}))

vi.mock('../../hooks/use-fetch-text-content', () => ({
  useFetchTextContent: (downloadUrl?: string) => {
    mocks.fetchArgs.push(downloadUrl)
    return mocks.fetchState
  },
}))

vi.mock('../../utils/file-utils', () => ({
  getFileLanguage: (name: string) => mocks.getFileLanguage(name),
}))
describe('ReadOnlyFilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dynamicIndex = 0
    mocks.fileTypeInfo = {
      isMarkdown: false,
      isCodeOrText: false,
      isImage: false,
      isVideo: false,
      isPdf: false,
      isSQLite: false,
      isEditable: false,
      isMediaFile: false,
      isPreviewable: false,
    }
    mocks.fetchState = {
      data: undefined,
      isLoading: false,
    }
    mocks.dynamicLoaders.length = 0
    mocks.dynamicImporters.length = 0
    mocks.fetchArgs.length = 0
  })

  it('should render the unsupported download state for non-previewable files', () => {
    render(<ReadOnlyFilePreview downloadUrl="https://example.com/file.bin" fileName="file.bin" />)

    expect(screen.getByTestId('unsupported-preview')).toHaveTextContent('file.bin')
  })

  it('should show a loading state while text content is being fetched', () => {
    mocks.fileTypeInfo = {
      ...mocks.fileTypeInfo,
      isCodeOrText: true,
      isEditable: true,
      isPreviewable: true,
    }
    mocks.fetchState = {
      data: undefined,
      isLoading: true,
    }

    render(<ReadOnlyFilePreview downloadUrl="https://example.com/file.ts" fileName="file.ts" />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should render markdown, code, media, sqlite, and pdf previews for supported files', () => {
    const { rerender } = render(<ReadOnlyFilePreview downloadUrl="https://example.com/file.bin" fileName="file.bin" />)

    mocks.fileTypeInfo = {
      ...mocks.fileTypeInfo,
      isMarkdown: true,
      isEditable: true,
      isPreviewable: true,
    }
    mocks.fetchState = {
      data: '# Skill',
      isLoading: false,
    }
    rerender(<ReadOnlyFilePreview downloadUrl="https://example.com/guide.md" fileName="guide.md" />)
    expect(screen.getByTestId('markdown-preview')).toHaveTextContent('# Skill')
    expect(mocks.fetchArgs.at(-1)).toBe('https://example.com/guide.md')

    mocks.fileTypeInfo = {
      ...mocks.fileTypeInfo,
      isMarkdown: false,
      isCodeOrText: true,
      isEditable: true,
      isPreviewable: true,
    }
    mocks.fetchState = {
      data: 'const a = 1',
      isLoading: false,
    }
    rerender(<ReadOnlyFilePreview downloadUrl="https://example.com/file.ts" fileName="file.ts" />)
    expect(screen.getByTestId('code-preview')).toHaveTextContent('typescript:const a = 1')
    expect(mocks.getFileLanguage).toHaveBeenCalledWith('file.ts')
    expect(mocks.fetchArgs.at(-1)).toBe('https://example.com/file.ts')

    mocks.fileTypeInfo = {
      ...mocks.fileTypeInfo,
      isCodeOrText: false,
      isImage: true,
      isEditable: false,
      isPreviewable: true,
    }
    rerender(<ReadOnlyFilePreview downloadUrl="https://example.com/file.png" fileName="file.png" />)
    expect(screen.getByTestId('media-preview')).toHaveTextContent('image:https://example.com/file.png')
    expect(mocks.fetchArgs.at(-1)).toBeUndefined()

    mocks.fileTypeInfo = {
      ...mocks.fileTypeInfo,
      isImage: false,
      isSQLite: true,
      isPreviewable: true,
    }
    rerender(<ReadOnlyFilePreview downloadUrl="https://example.com/file.db" fileName="file.db" />)
    expect(screen.getByTestId('sqlite-preview')).toHaveTextContent('https://example.com/file.db')

    mocks.fileTypeInfo = {
      ...mocks.fileTypeInfo,
      isSQLite: false,
      isPdf: true,
      isPreviewable: true,
    }
    rerender(<ReadOnlyFilePreview downloadUrl="https://example.com/file.pdf" fileName="file.pdf" />)
    expect(screen.getByTestId('pdf-preview')).toHaveTextContent('https://example.com/file.pdf')
  })

  it('should render a video preview when the file type info marks it as video', () => {
    mocks.fileTypeInfo = {
      ...mocks.fileTypeInfo,
      isVideo: true,
      isPreviewable: true,
    }

    render(<ReadOnlyFilePreview downloadUrl="https://example.com/file.mp4" fileName="file.mp4" />)

    expect(screen.getByTestId('media-preview')).toHaveTextContent('video:https://example.com/file.mp4')
  })

  it('should render the unsupported fallback when a previewable file has no dedicated renderer', () => {
    mocks.fileTypeInfo = {
      ...mocks.fileTypeInfo,
      isPreviewable: true,
    }

    render(<ReadOnlyFilePreview downloadUrl="https://example.com/file.custom" fileName="file.custom" fileSize={null} />)

    expect(screen.getByTestId('unsupported-preview')).toHaveTextContent('file.custom')
  })

  it('should expose loading placeholders for all dynamic preview modules', async () => {
    vi.resetModules()
    mocks.dynamicLoaders.length = 0
    mocks.dynamicImporters.length = 0

    const readOnlyFilePreviewModule = await import('../read-only-file-preview')
    const FreshReadOnlyFilePreview = readOnlyFilePreviewModule.default

    render(<FreshReadOnlyFilePreview downloadUrl="https://example.com/file.bin" fileName="file.bin" />)

    expect(mocks.dynamicLoaders).toHaveLength(4)
    expect(mocks.dynamicImporters).toHaveLength(4)
    mocks.dynamicLoaders.forEach((renderLoader) => {
      const { unmount } = render(<>{renderLoader()}</>)
      expect(screen.getByRole('status')).toBeInTheDocument()
      unmount()
    })
    for (const loadModule of mocks.dynamicImporters)
      await expect(loadModule()).resolves.toBeTruthy()
    expect(Loading).toBeDefined()
  })
})
