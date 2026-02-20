import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { downloadUrl } from '@/utils/download'
import ShareQRCode from '.'

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

describe('ShareQRCode', () => {
  const content = 'https://example.com'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('renders correctly', () => {
      render(<ShareQRCode content={content} />)
      expect(screen.getByRole('button').firstElementChild).toBeInTheDocument()
    })
  })

  describe('Interaction', () => {
    it('toggles QR code panel when clicking the icon', async () => {
      const user = userEvent.setup()
      render(<ShareQRCode content={content} />)

      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      const trigger = screen.getByTestId('qrcode-container')
      await user.click(trigger)

      expect(screen.getByRole('img')).toBeInTheDocument()

      await user.click(trigger)
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('closes panel when clicking outside', async () => {
      const user = userEvent.setup()
      render(
        <div>
          <div data-testid="outside">Outside</div>
          <ShareQRCode content={content} />
        </div>,
      )

      const trigger = screen.getByTestId('qrcode-container')
      await user.click(trigger)
      expect(screen.getByRole('img')).toBeInTheDocument()

      await user.click(screen.getByTestId('outside'))
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('does not close panel when clicking inside the panel', async () => {
      const user = userEvent.setup()
      render(<ShareQRCode content={content} />)

      const trigger = screen.getByTestId('qrcode-container')
      await user.click(trigger)

      const canvas = screen.getByRole('img')
      const panel = canvas.parentElement
      await user.click(panel!)

      expect(canvas).toBeInTheDocument()
    })

    it('calls downloadUrl when clicking download', async () => {
      const user = userEvent.setup()
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL
      HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,test')

      try {
        render(<ShareQRCode content={content} />)

        const trigger = screen.getByTestId('qrcode-container')
        await user.click(trigger!)

        const downloadBtn = screen.getByText('appOverview.overview.appInfo.qrcode.download')
        await user.click(downloadBtn)

        expect(downloadUrl).toHaveBeenCalledWith({
          url: 'data:image/png;base64,test',
          fileName: 'qrcode.png',
        })
      }
      finally {
        HTMLCanvasElement.prototype.toDataURL = originalToDataURL
      }
    })
  })
})
