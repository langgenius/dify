import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { FileResponse } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import OutputPanel from '../output-panel'

type FileOutput = FileResponse & { dify_model_identity: '__dify__file__' }

vi.mock('@/app/components/base/chat/chat/loading-anim', () => ({
  default: () => <div data-testid="loading-anim" />,
}))

vi.mock('@/app/components/base/file-uploader', () => ({
  FileList: ({ files }: { files: FileEntity[] }) => (
    <div data-testid="file-list">{files.map(file => file.name).join(', ')}</div>
  ),
}))

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))

vi.mock('@/app/components/workflow/run/status-container', () => ({
  default: ({ status, children }: { status: string, children?: React.ReactNode }) => (
    <div data-status={status} data-testid="status-container">{children}</div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({
    language,
    value,
    height,
  }: {
    language: string
    value: string
    height?: number
  }) => (
    <div data-height={height} data-language={language} data-testid="code-editor" data-value={value}>
      {value}
    </div>
  ),
}))

const createFileOutput = (overrides: Partial<FileOutput> = {}): FileOutput => ({
  dify_model_identity: '__dify__file__',
  related_id: 'file-1',
  extension: 'pdf',
  filename: 'report.pdf',
  size: 128,
  mime_type: 'application/pdf',
  transfer_method: TransferMethod.local_file,
  type: 'document',
  url: 'https://example.com/report.pdf',
  upload_file_id: 'upload-1',
  remote_url: '',
  ...overrides,
})

describe('OutputPanel', () => {
  it('renders the loading animation while the workflow is running', () => {
    render(<OutputPanel isRunning />)

    expect(screen.getByTestId('loading-anim')).toBeInTheDocument()
  })

  it('renders the failed status container when there is an error', () => {
    render(<OutputPanel error="Execution failed" />)

    expect(screen.getByTestId('status-container')).toHaveAttribute('data-status', 'failed')
    expect(screen.getByText('Execution failed')).toBeInTheDocument()
  })

  it('renders the no-output placeholder when there are no outputs', () => {
    render(<OutputPanel />)

    expect(screen.getByTestId('markdown')).toHaveTextContent('No Output')
  })

  it('renders a plain text output as markdown', () => {
    render(<OutputPanel outputs={{ answer: 'Hello Dify' }} />)

    expect(screen.getByTestId('markdown')).toHaveTextContent('Hello Dify')
  })

  it('renders array text outputs as joined markdown content', () => {
    render(<OutputPanel outputs={{ answer: ['Line 1', 'Line 2'] }} />)

    expect(screen.getByTestId('markdown')).toHaveTextContent(/Line 1\s+Line 2/)
  })

  it('renders a file list for a single file output', () => {
    render(<OutputPanel outputs={{ attachment: createFileOutput() }} />)

    expect(screen.getByTestId('file-list')).toHaveTextContent('report.pdf')
  })

  it('renders a file list for an array of file outputs', () => {
    render(
      <OutputPanel
        outputs={{
          attachments: [
            createFileOutput(),
            createFileOutput({
              related_id: 'file-2',
              filename: 'summary.md',
              extension: 'md',
              mime_type: 'text/markdown',
              type: 'custom',
              upload_file_id: 'upload-2',
              url: 'https://example.com/summary.md',
            }),
          ],
        }}
      />,
    )

    expect(screen.getByTestId('file-list')).toHaveTextContent('report.pdf, summary.md')
  })

  it('renders structured outputs inside the code editor when height is available', () => {
    render(<OutputPanel height={200} outputs={{ answer: 'hello', score: 1 }} />)

    expect(screen.getByTestId('code-editor')).toHaveAttribute('data-language', 'json')
    expect(screen.getByTestId('code-editor')).toHaveAttribute('data-height', '92')
    expect(screen.getByTestId('code-editor')).toHaveAttribute('data-value', `{
  "answer": "hello",
  "score": 1
}`)
  })

  it('skips the code editor when structured outputs have no positive height', () => {
    render(<OutputPanel height={0} outputs={{ answer: 'hello', score: 1 }} />)

    expect(screen.queryByTestId('code-editor')).not.toBeInTheDocument()
  })
})
