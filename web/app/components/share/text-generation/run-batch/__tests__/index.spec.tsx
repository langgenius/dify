import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RunBatch from '../index'

let acceptCSV: (payload: { data: string[][] }) => void
vi.mock('react-papaparse', () => ({
  useCSVReader: () => ({
    CSVReader: ({
      onUploadAccepted,
      children,
    }: {
      onUploadAccepted: typeof acceptCSV
      children: (context: { getRootProps: () => object; acceptedFile: null }) => React.ReactNode
    }) => {
      acceptCSV = onUploadAccepted
      return children({ getRootProps: () => ({}), acceptedFile: null })
    },
  }),
  useCSVDownloader: () => ({
    CSVDownloader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Type: { Link: 'link' },
  }),
}))

it('runs parsed CSV rows only after a file is accepted and the previous batch has finished', async () => {
  const user = userEvent.setup()
  const onSend = vi.fn()
  const props = { vars: [{ name: 'prompt' }], onSend }
  const { rerender } = render(<RunBatch {...props} isAllFinished />)
  const run = screen.getByRole('button', { name: 'share.generation.run' })
  expect(run).toBeDisabled()
  const rows = [['prompt'], ['First'], ['Second']]
  act(() => acceptCSV({ data: rows }))
  expect(run).toBeEnabled()
  await user.click(run)
  expect(onSend).toHaveBeenCalledExactlyOnceWith(rows)

  rerender(<RunBatch {...props} isAllFinished={false} />)
  expect(run).toBeDisabled()
  await user.click(run)
  expect(onSend).toHaveBeenCalledTimes(1)
  rerender(<RunBatch {...props} isAllFinished />)
  await user.click(run)
  expect(onSend).toHaveBeenLastCalledWith(rows)
  expect(onSend).toHaveBeenCalledTimes(2)
})
