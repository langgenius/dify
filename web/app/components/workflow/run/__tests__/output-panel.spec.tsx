import type { FileResponse } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import OutputPanel from '../output-panel'

type FileOutput = FileResponse & { dify_model_identity: '__dify__file__' }

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
  it('shows no-output only after execution finishes without a result', async () => {
    const { rerender } = render(<OutputPanel isRunning outputs={{ answer: 'Partial output' }} />)
    expect(screen.queryByText('No Output')).not.toBeInTheDocument()
    expect(await screen.findByText('Partial output', {}, { timeout: 5000 })).toBeVisible()
    rerender(<OutputPanel isRunning={false} />)
    expect(await screen.findByText('No Output', {}, { timeout: 5000 })).toBeVisible()
  }, 10_000)

  it('shows and copies a failed execution message', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    render(<OutputPanel error="Execution failed" />)

    expect(screen.getByRole('status')).toHaveTextContent('Execution failed')
    await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))
    expect(writeText).toHaveBeenCalledWith('Execution failed')
    expect(screen.getByText('Execution failed')).toBeInTheDocument()
  })

  it('renders a plain text output as semantic markdown', async () => {
    render(
      <OutputPanel
        outputs={{ answer: '# Run summary\n\n[Review output](https://example.com/review)' }}
      />,
    )

    expect(
      await screen.findByRole('heading', { name: 'Run summary' }, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review output' })).toHaveAttribute(
      'href',
      'https://example.com/review',
    )
  }, 10_000)

  it('renders array text outputs as joined semantic markdown content', async () => {
    render(<OutputPanel outputs={{ answer: ['## First result', '## Second result'] }} />)

    expect(
      await screen.findByRole('heading', { name: 'First result' }, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Second result' })).toBeInTheDocument()
  }, 10_000)

  it('renders a file list for a single file output', () => {
    render(<OutputPanel outputs={{ attachment: createFileOutput() }} />)

    expect(screen.getByRole('button', { name: 'report.pdf' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.download' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.remove' }),
    ).not.toBeInTheDocument()
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

    expect(screen.getByRole('button', { name: 'report.pdf' })).toBeInTheDocument()
    expect(screen.getByText('summary.md')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'common.operation.download' })).toHaveLength(2)
    expect(
      screen.queryByRole('button', { name: 'common.operation.remove' }),
    ).not.toBeInTheDocument()
  })

  // TODO: OutputPanel pre-serializes the object before CodeEditor serializes it again.
  // Remove `.fails` when the editor receives the original object and exposes semantic JSON.
  it.fails('renders structured outputs inside the code editor when height is available', () => {
    const outputs = { answer: 'hello', score: 1 }
    render(<OutputPanel height={200} outputs={outputs} />)

    const editor = screen.getByTestId<HTMLInputElement>('monaco-editor')
    expect(editor).toHaveAttribute('readonly')
    expect(JSON.parse(editor.value)).toEqual(outputs)
  })

  it('skips the code editor when structured outputs have no positive height', () => {
    render(<OutputPanel height={0} outputs={{ answer: 'hello', score: 1 }} />)

    expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument()
  })
})
