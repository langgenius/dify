import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import ShareQRCode from '..'

const downloads = vi.hoisted(() => ({
  save: vi.fn<(value: { url: string; fileName: string }) => void>(),
}))
// boundary: capture the file-save request; Chromium still encodes and decodes the actual QR PNG.
vi.mock('@/utils/download', () => ({ downloadUrl: downloads.save }))

it.each([
  { custom: true, trigger: 'Show QR code', download: 'Download QR code' },
  {
    custom: false,
    trigger: 'appOverview.overview.appInfo.qrcode.title',
    download: 'appOverview.overview.appInfo.qrcode.download',
  },
])(
  'exports the rendered QR image with caller labels enabled: $custom',
  async ({ custom, trigger, download }) => {
    const screen = await render(
      <ShareQRCode
        content="https://example.com"
        {...(custom && {
          triggerLabel: trigger,
          scanLabel: 'Scan to share',
          downloadLabel: download,
        })}
      />,
    )
    const button = screen.getByRole('button', { name: trigger, exact: true })
    button.element().focus()
    await userEvent.keyboard('{Enter}')
    const popup = screen.getByRole('dialog', { name: trigger })
    await expect.element(popup).toBeVisible()
    if (custom) await expect.element(popup.getByText('Scan to share')).toBeVisible()
    await popup.getByRole('button', { name: download, exact: true }).click()
    expect(downloads.save).toHaveBeenCalledOnce()
    const saved = downloads.save.mock.calls[0]![0]
    expect(saved.fileName).toBe('qrcode.png')
    // Decode the real export: a fake toDataURL string cannot prove the PNG is usable.
    const image = new Image()
    image.src = saved.url
    await image.decode()
    expect([image.naturalWidth, image.naturalHeight]).toEqual([160, 160])
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data)
    // The finder pattern has a black border, white ring, and black center.
    expect(pixel(3, 3)).toEqual([0, 0, 0, 255])
    expect(pixel(10, 10)).toEqual([255, 255, 255, 255])
    expect(pixel(20, 20)).toEqual([0, 0, 0, 255])
  },
)
