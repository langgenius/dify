import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import ResultText from '../result-text'

describe('ResultText', () => {
  it('suppresses the empty action while running or paused and displays a failed result', () => {
    const { rerender } = render(<ResultText isRunning />)
    expect(
      screen.queryByRole('button', { name: 'runLog.resultEmpty.link' }),
    ).not.toBeInTheDocument()
    rerender(<ResultText isPaused />)
    expect(
      screen.queryByRole('button', { name: 'runLog.resultEmpty.link' }),
    ).not.toBeInTheDocument()
    rerender(<ResultText error="Run failed" />)
    expect(screen.getByRole('status')).toHaveTextContent('Run failed')
    expect(
      screen.queryByRole('button', { name: 'runLog.resultEmpty.link' }),
    ).not.toBeInTheDocument()
  })

  it('opens configuration from the empty result', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<ResultText onClick={onClick} />)

    expect(screen.getByText('runLog.resultEmpty.title')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'runLog.resultEmpty.link' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders markdown content when text outputs are available', async () => {
    render(<ResultText outputs="hello workflow" />)

    expect(await screen.findByText('hello workflow')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'runLog.resultEmpty.link' }),
    ).not.toBeInTheDocument()
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
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'runLog.resultEmpty.link' }),
    ).not.toBeInTheDocument()
  })
})
