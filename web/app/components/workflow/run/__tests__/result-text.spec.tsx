import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import ResultText from '../result-text'

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

describe('ResultText', () => {
  it('renders the loading animation while waiting for a text result', () => {
    render(<ResultText isRunning />)

    expect(screen.getByTestId('loading-anim')).toBeInTheDocument()
  })

  it('renders the error state when the run fails', () => {
    render(<ResultText error="Run failed" />)

    expect(screen.getByTestId('status-container')).toHaveAttribute('data-status', 'failed')
    expect(screen.getByText('Run failed')).toBeInTheDocument()
  })

  it('renders the empty-state call to action and forwards clicks', () => {
    const onClick = vi.fn()
    render(<ResultText onClick={onClick} />)

    expect(screen.getByText('runLog.resultEmpty.title')).toBeInTheDocument()

    fireEvent.click(screen.getByText('runLog.resultEmpty.link'))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not render the empty state for paused runs', () => {
    render(<ResultText isPaused />)

    expect(screen.queryByText('runLog.resultEmpty.title')).not.toBeInTheDocument()
  })

  it('renders markdown content when text outputs are available', () => {
    render(<ResultText outputs="hello workflow" />)

    expect(screen.getByTestId('markdown')).toHaveTextContent('hello workflow')
  })

  it('renders file groups when file outputs are available', () => {
    render(
      <ResultText
        allFiles={[
          {
            varName: 'attachments',
            list: [
              {
                id: 'file-1',
                name: 'report.pdf',
                size: 128,
                type: 'application/pdf',
                progress: 100,
                transferMethod: TransferMethod.local_file,
                supportFileType: 'document',
              } satisfies FileEntity,
            ],
          },
        ]}
      />,
    )

    expect(screen.getByText('attachments')).toBeInTheDocument()
    expect(screen.getByTestId('file-list')).toHaveTextContent('report.pdf')
  })
})
