import type { ReactElement, ReactNode } from 'react'
import type { AgentSkillDetail } from '../detail-dialog'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { codeToTokens, isSupportedLanguage } from '@pierre/highlights'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createTestQueryClient } from '@/test/query-client'
import { AgentSkillDetailDialog } from '../detail-dialog'

// Spy on the real highlighter so tests can assert which files reach the lexers.
vi.mock('@pierre/highlights', { spy: true })

// The URL picks the loader state: "pending" keeps `beforeLoad`, "broken" renders `errorMessage`.
vi.mock('@/app/components/base/file-uploader/pdf-highlighter-adapter', () => ({
  PdfLoader: ({
    beforeLoad,
    children,
    errorMessage,
    url,
  }: {
    beforeLoad: ReactNode
    children: (pdfDocument: unknown) => ReactNode
    errorMessage: ReactElement
    url: string
  }) => (
    <div data-testid="pdf-loader" data-url={url}>
      {url.includes('pending')
        ? beforeLoad
        : url.includes('broken')
          ? errorMessage
          : children({ numPages: 1 })}
    </div>
  ),
  PdfHighlighter: () => <div data-testid="pdf-document" />,
}))

const mockCodeToTokens = vi.mocked(codeToTokens)
const mockIsSupportedLanguage = vi.mocked(isSupportedLanguage)

const highlighterQueryKey = ['agent-v2', 'file-highlighter']

const previewTree = (
  filePreview: AgentSkillDetail['filePreview'],
  queryClient = createTestQueryClient(),
  onDownloadFile?: AgentSkillDetail['onDownloadFile'],
) => (
  <QueryClientTestProvider queryClient={queryClient}>
    <Dialog open>
      <AgentSkillDetailDialog
        skillName="demo"
        detail={{ description: 'Demo files', files: [], filePreview, onDownloadFile, sections: [] }}
      />
    </Dialog>
  </QueryClientTestProvider>
)

const renderPreview = (...args: Parameters<typeof previewTree>) => render(previewTree(...args))

const getLineCode = (text: string) =>
  screen.getByText((_, element) => element?.tagName === 'CODE' && element.textContent === text)

const waitForHighlighted = (text: string) =>
  waitFor(() => expect(getLineCode(text).children.length).toBeGreaterThan(0), { timeout: 5000 })

describe('AgentSkillDetailDialog file preview', () => {
  beforeEach(() => {
    mockCodeToTokens.mockClear()
    mockIsSupportedLanguage.mockClear()
  })

  it('should color tokens for both themes', async () => {
    renderPreview({ content: 'const a = 1\n\nexport { a }', fileName: 'run.ts' })

    await waitForHighlighted('const a = 1')
    const token = getLineCode('const a = 1').querySelector('span')
    expect(token?.style.getPropertyValue('--hls-light')).not.toBe('')
    expect(token?.style.getPropertyValue('--hls-dark')).not.toBe('')
    expect(getLineCode('export { a }').children.length).toBeGreaterThan(0)
  })

  it.each([
    ['SKILL.md', 'md', '# Skill\n\nUse the tool.', '# Skill'],
    ['Dockerfile', 'dockerfile', 'FROM node:22\nRUN pnpm install', 'FROM node:22'],
    ['run.ts', 'ts', 'const a = 1\r\nconst b = 2', 'const b = 2'],
  ])('should highlight %s without changing line text', async (fileName, lang, content, line) => {
    renderPreview({ content, fileName })

    await waitForHighlighted(line)
    expect(mockCodeToTokens.mock.calls[0]![1]).toMatchObject({ lang })
  })

  it('should keep the full text of lines past the token limit', async () => {
    const longLine = `const a = '${'x'.repeat(1200)}'`
    renderPreview({ content: `const b = 1\n${longLine}`, fileName: 'run.ts' })

    await waitForHighlighted('const b = 1')
    expect(getLineCode(longLine)).toBeInTheDocument()
  })

  it('should render plain text files without loading the highlighter', () => {
    const queryClient = createTestQueryClient()
    renderPreview({ content: 'first line\nsecond line', fileName: 'notes.txt' }, queryClient)

    expect(getLineCode('first line').children).toHaveLength(0)
    expect(getLineCode('second line').children).toHaveLength(0)
    expect(
      screen.queryByText('agentV2.agentDetail.configure.files.preview.truncated'),
    ).not.toBeInTheDocument()
    expect(queryClient.getQueryState(highlighterQueryKey)).toMatchObject({ fetchStatus: 'idle' })
    expect(mockIsSupportedLanguage).not.toHaveBeenCalled()
  })

  it('should render unsupported languages as plain text', async () => {
    renderPreview({ content: 'first line', fileName: 'notes.unknown-language' })

    await waitFor(() => expect(mockIsSupportedLanguage).toHaveBeenCalledWith('unknown-language'), {
      timeout: 5000,
    })
    expect(getLineCode('first line').children).toHaveLength(0)
    expect(mockCodeToTokens).not.toHaveBeenCalled()
  })

  it('should fall back to plain text when tokenizing fails', async () => {
    mockCodeToTokens.mockImplementationOnce(() => {
      throw new RangeError('lexer failed')
    })
    renderPreview({ content: 'const a = 1', fileName: 'run.ts' })

    await waitFor(() => expect(mockCodeToTokens).toHaveBeenCalled(), { timeout: 5000 })
    expect(getLineCode('const a = 1').children).toHaveLength(0)
  })

  it('should note when the text preview is truncated', () => {
    renderPreview({ content: 'first line', fileName: 'notes.txt', truncated: true })

    expect(
      screen.getByText('agentV2.agentDetail.configure.files.preview.truncated'),
    ).toBeInTheDocument()
  })
})

describe('AgentSkillDetailDialog header download', () => {
  it('should keep the header download focusable but inert while it downloads', async () => {
    const user = userEvent.setup()
    const onDownloadFile = vi.fn()
    renderPreview(
      { content: 'first line', fileName: 'notes.txt', downloadActionLoadingTarget: 'header' },
      undefined,
      onDownloadFile,
    )

    const download = screen.getByRole('button', { name: 'common.operation.downloading notes.txt' })
    expect(download).toHaveAttribute('aria-disabled', 'true')
    await user.click(download)
    expect(onDownloadFile).not.toHaveBeenCalled()
  })

  it('should request the header download', async () => {
    const user = userEvent.setup()
    const onDownloadFile = vi.fn()
    renderPreview({ content: 'first line', fileName: 'notes.txt' }, undefined, onDownloadFile)

    await user.click(screen.getByRole('button', { name: 'common.operation.download notes.txt' }))
    expect(onDownloadFile).toHaveBeenCalledWith('header')
  })
})

describe('AgentSkillDetailDialog PDF preview', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const renderPdf = (
    filePreview: NonNullable<AgentSkillDetail['filePreview']>,
    onDownloadFile?: AgentSkillDetail['onDownloadFile'],
  ) =>
    renderPreview(
      { fileName: 'guide.pdf', fileType: 'pdf', ...filePreview },
      undefined,
      onDownloadFile,
    )

  it('should render a PDF from its download URL', async () => {
    renderPdf({ downloadUrl: 'https://files.example.com/guide.pdf' })

    expect(await screen.findByTestId('pdf-document')).toBeInTheDocument()
    expect(screen.getByTestId('pdf-loader')).toHaveAttribute(
      'data-url',
      'https://files.example.com/guide.pdf',
    )
  })

  it('should show the loading state while the PDF document loads', async () => {
    renderPdf({ downloadUrl: 'https://files.example.com/pending.pdf' })

    const loader = await screen.findByTestId('pdf-loader')
    expect(within(loader).getByLabelText('common.loading')).toBeInTheDocument()
  })

  it('should render a PDF from file data through an object URL', async () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const first = new Blob(['%PDF-1.7'], { type: 'application/pdf' })
    const second = new Blob(['%PDF-1.7 second'], { type: 'application/pdf' })
    const { rerender, unmount } = renderPdf({ fileData: first })

    expect(await screen.findByTestId('pdf-loader')).toHaveAttribute('data-url', 'blob:first')
    expect(createObjectURL).toHaveBeenCalledWith(first)

    rerender(previewTree({ fileData: second, fileName: 'guide.pdf', fileType: 'pdf' }))
    await waitFor(() =>
      expect(screen.getByTestId('pdf-loader')).toHaveAttribute('data-url', 'blob:second'),
    )
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first')

    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:second')
  })

  it('should offer the download when no PDF source is available', async () => {
    const user = userEvent.setup()
    const onDownloadFile = vi.fn()
    renderPdf({}, onDownloadFile)

    expect(
      screen.getByText('agentV2.agentDetail.configure.files.preview.unsupported'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('pdf-loader')).not.toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'common.operation.download' }))
    expect(onDownloadFile).toHaveBeenCalledWith('preview')
  })

  it('should request a fresh download when the PDF fails to load', async () => {
    const user = userEvent.setup()
    const onDownloadFile = vi.fn()
    renderPdf({ downloadUrl: 'https://files.example.com/broken.pdf' }, onDownloadFile)

    const loader = await screen.findByTestId('pdf-loader')
    expect(
      within(loader).getByText('agentV2.agentDetail.configure.files.preview.failed'),
    ).toBeInTheDocument()
    await user.click(within(loader).getByRole('link', { name: 'common.operation.download' }))
    expect(onDownloadFile).toHaveBeenCalledWith('preview')
  })
})
