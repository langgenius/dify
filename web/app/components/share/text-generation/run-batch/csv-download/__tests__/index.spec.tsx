import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { captureDownloads } from '@/test/download'
import CSVDownload from '../index'

afterEach(() => vi.restoreAllMocks())

it('previews the variables and downloads a CSV template with matching columns', async () => {
  const user = userEvent.setup()
  const downloads = captureDownloads()
  render(<CSVDownload vars={[{ name: 'prompt' }, { name: 'context' }]} />)

  expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
    'prompt',
    'context',
  ])
  expect(screen.getByText('prompt share.generation.field')).toBeVisible()
  expect(screen.getByText('context share.generation.field')).toBeVisible()
  await user.click(screen.getByText('share.generation.downloadTemplate'))

  expect(downloads).toHaveLength(1)
  expect(downloads[0]!.filename).toBe('template.csv')
  expect(await downloads[0]!.blob.text()).toBe('\uFEFFprompt,context\r\n,')
})
