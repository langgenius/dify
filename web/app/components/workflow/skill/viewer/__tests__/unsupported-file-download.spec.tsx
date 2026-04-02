import { fireEvent, render, screen } from '@testing-library/react'

import UnsupportedFileDownload from '../unsupported-file-download'

const mocks = vi.hoisted(() => ({
  downloadUrl: vi.fn(),
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: (args: { url: string, fileName: string }) => mocks.downloadUrl(args),
}))

describe('UnsupportedFileDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render file metadata and trigger a download when a url is available', () => {
    render(
      <UnsupportedFileDownload
        name="archive.zip"
        size={1024}
        downloadUrl="https://example.com/archive.zip"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.download' }))

    expect(screen.getByText('archive.zip')).toBeInTheDocument()
    expect(screen.getByText('1.00 KB')).toBeInTheDocument()
    expect(mocks.downloadUrl).toHaveBeenCalledWith({
      url: 'https://example.com/archive.zip',
      fileName: 'archive.zip',
    })
  })

  it('should disable the download action when no url is available', () => {
    render(<UnsupportedFileDownload name="archive.zip" />)

    const button = screen.getByRole('button', { name: 'common.operation.download' })
    expect(button).toBeDisabled()

    fireEvent.click(button)
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
  })
})
