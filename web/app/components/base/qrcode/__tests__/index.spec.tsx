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

  describe('Rendering', () => {
    it('renders correctly', () => {
      render(<ShareQRCode content={content} />)
      expect(screen.getByRole('button', { name: 'appOverview.overview.appInfo.qrcode.title' })).toBeInTheDocument()
    })
  })

  describe('Interaction', () => {
    it('toggles QR code panel when clicking the icon', async () => {
      const user = userEvent.setup()
      render(<ShareQRCode content={content} />)

      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      const trigger = screen.getByRole('button', { name: 'appOverview.overview.appInfo.qrcode.title' })
      await user.click(trigger)

      expect(screen.getByRole('img')).toBeInTheDocument()

      await user.click(trigger)
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('closes panel when clicking outside', async () => {
      const user = userEvent.setup()
      render(
        <div>
          <div>Outside</div>
          <ShareQRCode content={content} />
        </div>,
      )

      const trigger = screen.getByRole('button', { name: 'appOverview.overview.appInfo.qrcode.title' })
      await user.click(trigger)
      expect(screen.getByRole('img')).toBeInTheDocument()

      await user.click(screen.getByText('Outside'))
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('does not close panel when clicking inside the panel', async () => {
      const user = userEvent.setup()
      render(<ShareQRCode content={content} />)

      const trigger = screen.getByRole('button', { name: 'appOverview.overview.appInfo.qrcode.title' })
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

        const trigger = screen.getByRole('button', { name: 'appOverview.overview.appInfo.qrcode.title' })
        await user.click(trigger!)

        const downloadBtn = screen.getByRole('button', { name: 'appOverview.overview.appInfo.qrcode.download' })
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

    it('does not call downloadUrl when canvas is not found', async () => {
      const user = userEvent.setup()
      render(<ShareQRCode content={content} />)

      const trigger = screen.getByRole('button', { name: 'appOverview.overview.appInfo.qrcode.title' })
      await user.click(trigger)

      // Override querySelector on the panel to simulate canvas not being found
      const panel = screen.getByRole('img').parentElement!
      const origQuerySelector = panel.querySelector.bind(panel)
      panel.querySelector = ((sel: string) => {
        if (sel === 'canvas')
          return null
        return origQuerySelector(sel)
      }) as typeof panel.querySelector

      try {
        const downloadBtn = screen.getByRole('button', { name: 'appOverview.overview.appInfo.qrcode.download' })
        await user.click(downloadBtn)
        expect(downloadUrl).not.toHaveBeenCalled()
      }
      finally {
        panel.querySelector = origQuerySelector
      }
    })

    it('does not close when clicking inside the qrcode ref area', async () => {
      const user = userEvent.setup()
      render(<ShareQRCode content={content} />)

      const trigger = screen.getByRole('button', { name: 'appOverview.overview.appInfo.qrcode.title' })
      await user.click(trigger)

      // Click on the scan text inside the panel — panel should remain open
      const scanText = screen.getByText('appOverview.overview.appInfo.qrcode.scan')
      await user.click(scanText)

      expect(screen.getByRole('img')).toBeInTheDocument()
    })
  })
})
