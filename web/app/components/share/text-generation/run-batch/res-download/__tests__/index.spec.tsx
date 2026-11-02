import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { captureDownloads } from '@/test/download'
import ResDownload from '../index'

afterEach(() => vi.restoreAllMocks())

it('downloads generated results with commas, quotes, and newlines preserved', async () => {
  const user = userEvent.setup()
  const downloads = captureDownloads()
  render(<ResDownload isMobile={false} values={[{ text: 'Hello, "world"\nNext line' }]} />)

  await user.click(screen.getByRole('button', { name: 'common.operation.download' }))

  expect(downloads).toHaveLength(1)
  expect(downloads[0]!.filename).toBe('result.csv')
  expect(await downloads[0]!.blob.text()).toBe('\uFEFFtext\r\n"Hello, ""world""\nNext line"')
})
