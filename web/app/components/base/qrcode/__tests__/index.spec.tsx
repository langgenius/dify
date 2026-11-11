import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { downloadUrl } from '@/utils/download'
import ShareQRCode from '..'

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

describe('ShareQRCode', () => {
  const content = 'https://example.com'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses caller-provided labels instead of App-specific defaults', async () => {
    const user = userEvent.setup()
    render(
      <ShareQRCode
        content={content}
        triggerLabel="Show QR code"
        scanLabel="Scan to share"
        downloadLabel="Download QR code"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Show QR code' }))

    expect(screen.getByText('Scan to share')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download QR code' })).toBeInTheDocument()
  })

  describe('Interaction', () => {
    it('calls downloadUrl when clicking download', async () => {
      const user = userEvent.setup()
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL
      HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,test')

      try {
        render(<ShareQRCode content={content} />)

        const trigger = screen.getByRole('button', {
          name: 'appOverview.overview.appInfo.qrcode.title',
        })
        await user.click(trigger)

        const downloadBtn = screen.getByRole('button', {
          name: 'appOverview.overview.appInfo.qrcode.download',
        })
        await user.click(downloadBtn)

        expect(downloadUrl).toHaveBeenCalledWith({
          url: 'data:image/png;base64,test',
          fileName: 'qrcode.png',
        })
      } finally {
        HTMLCanvasElement.prototype.toDataURL = originalToDataURL
      }
    })
  })
})
