import type { ComponentProps } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { AppToastHost } from '@/app/notifications/host'
import { createDeferred } from '@/test/deferred'
import ImagePreview from '../image-preview'

const base64Image = 'aGVsbG8='
const dataImage = `data:image/png;base64,${base64Image}`
const button = (action: string) =>
  screen.getByRole('button', { name: `common.operation.${action}` })

const setup = (props: Partial<ComponentProps<typeof ImagePreview>> = {}) => {
  const user = userEvent.setup()
  const write = navigator.clipboard.write.bind(navigator.clipboard)
  const clipboardWrite = vi
    .spyOn(navigator.clipboard, 'write')
    .mockImplementation(async (items) => {
      // A browser consumes promised image data before reporting a successful clipboard write.
      await Promise.all(items.map((item) => item.getType('image/png')))
      await write(items)
    })
  const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null)
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const onCancel = vi.fn()
  render(
    <>
      <ImagePreview
        url="https://example.com/image.png"
        title="Preview Image"
        onCancel={onCancel}
        {...props}
      />
      <AppToastHost timeout={0} />
    </>,
  )
  return { user, clipboardWrite, windowOpen, download, onCancel }
}
const readPng = async () => {
  const [item] = await navigator.clipboard.read()
  expect(item?.types).toEqual(['image/png'])
  return item!.getType('image/png')
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(new Blob(['image'], { type: 'image/png' }))),
  )
})
afterEach(() => {
  toast.dismiss()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each([
  ['https://example.com/image.png', 'https://example.com/image.png'],
  [base64Image, dataImage],
])('shows the preview source for %s', (url, src) => {
  setup({ url })
  expect(screen.getByRole('dialog', { name: 'Preview Image' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Preview Image' })).toHaveAttribute('src', src)
})

it.each(['', '   '])('names an untitled preview for %j', (title) => {
  setup({ title })
  expect(screen.getByRole('dialog', { name: 'workflow.common.preview' })).toBeInTheDocument()
})

it('navigates the preview with arrows and closes with Escape', async () => {
  const onPrev = vi.fn()
  const onNext = vi.fn()
  const { user, onCancel } = setup({ onPrev, onNext })
  await user.click(screen.getByRole('img', { name: 'Preview Image' }))
  await user.keyboard('{ArrowLeft}{ArrowRight}{Escape}')
  expect(onPrev).toHaveBeenCalledOnce()
  expect(onNext).toHaveBeenCalledOnce()
  expect(onCancel).toHaveBeenCalledOnce()
})

it('leaves outside arrows and unavailable navigation unclaimed', () => {
  setup()
  const outside = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
  fireEvent(document.body, outside)
  expect(outside.defaultPrevented).toBe(false)
  const unavailable = new KeyboardEvent('keydown', {
    key: 'ArrowRight',
    bubbles: true,
    cancelable: true,
  })
  fireEvent(screen.getByRole('dialog', { name: 'Preview Image' }), unavailable)
  expect(unavailable.defaultPrevented).toBe(false)
})

it('keeps the image open until the close action is chosen', async () => {
  const { user, onCancel } = setup()
  await user.click(screen.getByRole('img', { name: 'Preview Image' }))
  expect(onCancel).not.toHaveBeenCalled()
  await user.click(button('cancel'))
  expect(onCancel).toHaveBeenCalledOnce()
})

it.each(['https://example.com/image.png', '/image-proxy/github/example'])(
  'opens %s in a new tab',
  async (url) => {
    const { user, windowOpen } = setup({ url })
    await user.click(button('openInNewTab'))
    expect(windowOpen).toHaveBeenCalledWith(url, '_blank')
  },
)

it.each([dataImage, base64Image])(
  'opens inline image %s with its title treated as text',
  async (url) => {
    render(<iframe title="Image tab" />)
    const popup = screen.getByTitle<HTMLIFrameElement>('Image tab').contentWindow
    if (!popup) throw new Error('Popup document unavailable')
    const title = '\" /><script>window.injected = true</script>'
    const { user, windowOpen } = setup({ url, title })
    windowOpen.mockReturnValue(popup)
    await user.click(button('openInNewTab'))
    expect(windowOpen).toHaveBeenCalledOnce()
    const image = popup.document.querySelector('img')
    expect(image?.src).toBe(dataImage)
    expect(image?.alt).toBe(title)
    expect(popup.document.querySelector('script')).toBeNull()
  },
)

it('reports unsupported URLs without opening a tab', async () => {
  const { user, windowOpen } = setup({ url: 'file:///tmp/image.png' })
  await user.click(button('openInNewTab'))
  expect(await screen.findByText('Unable to open image: file:///tmp/image.png')).toBeInTheDocument()
  expect(windowOpen).not.toHaveBeenCalled()
})

it.each(['permission', 'fetch'] as const)(
  'reports clipboard %s failure without downloading or navigating',
  async (failure) => {
    const { user, clipboardWrite, windowOpen, download, onCancel } = setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    if (failure === 'permission')
      clipboardWrite.mockRejectedValueOnce(new Error('Clipboard denied'))
    else vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await user.click(button('copyImage'))
    expect(await screen.findByText('common.operation.imageCopyFailed')).toBeInTheDocument()
    expect(download).not.toHaveBeenCalled()
    expect(windowOpen).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Preview Image' })).toBeInTheDocument()
  },
)

it('starts the clipboard write in the click gesture before the remote PNG arrives', async () => {
  const request = createDeferred<Response>()
  vi.mocked(fetch).mockReturnValueOnce(request.promise)
  const { user, clipboardWrite, download } = setup()
  await user.click(button('copyImage'))
  expect(clipboardWrite).toHaveBeenCalledOnce()
  expect(screen.queryByText('common.operation.imageCopied')).not.toBeInTheDocument()
  expect(await navigator.clipboard.read()).toEqual([])
  await act(async () =>
    request.resolve(new Response(new Blob(['png bytes'], { type: 'image/png' }))),
  )
  expect(await screen.findByText('common.operation.imageCopied')).toBeInTheDocument()
  const png = await readPng()
  expect(png.type).toBe('image/png')
  expect(await png.text()).toBe('png bytes')
  expect(download).not.toHaveBeenCalled()
})

it('converts JPEG bytes to PNG for the clipboard', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(new Blob(['jpeg bytes'], { type: 'image/jpeg' })),
  )
  const png = new Blob(['encoded png'], { type: 'image/png' })
  const bitmap: ImageBitmap = { width: 12, height: 8, close: vi.fn() }
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
  const context = document.createElement('canvas').getContext('2d')
  if (!context) throw new Error('Canvas context unavailable')
  vi.spyOn(context, 'drawImage').mockImplementation(() => {})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(png))
  const { user } = setup({ url: 'https://example.com/image.jpg' })
  await user.click(button('copyImage'))
  expect(await screen.findByText('common.operation.imageCopied')).toBeInTheDocument()
  const copied = await readPng()
  expect(copied.type).toBe('image/png')
  expect(await copied.text()).toBe('encoded png')
  expect(bitmap.close).toHaveBeenCalledOnce()
})

it('copies an inline image and reports success', async () => {
  const { user } = setup({ url: dataImage })
  await user.click(button('copyImage'))
  expect(await screen.findByText('common.operation.imageCopied')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith(dataImage)
  expect(await (await readPng()).text()).toBe('image')
})

it.each([
  ['https://example.com/image.png', 'Preview Image'],
  ['/image-proxy/github/example', ''],
  [dataImage, 'Screenshot.png'],
])('downloads image bytes without opening a tab for %s', async (url, title) => {
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download-image')
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const { user, download, windowOpen, onCancel } = setup({ url, title })
  const downloads: { href: string; name: string; target: string }[] = []
  download.mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ href: this.href, name: this.download, target: this.target })
  })
  await user.click(button('download'))
  await waitFor(() =>
    expect(downloads).toEqual([
      { href: 'blob:download-image', name: title || 'image.png', target: '' },
    ]),
  )
  const blob = createObjectURL.mock.calls[0]?.[0]
  if (!(blob instanceof Blob)) throw new Error('Expected downloaded image bytes')
  expect(blob.type).toBe('image/png')
  expect(await blob.text()).toBe('image')
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:download-image')
  expect(windowOpen).not.toHaveBeenCalled()
  expect(onCancel).not.toHaveBeenCalled()
})

it.each(['network', 'http'])(
  'keeps the preview open when a download fails: %s',
  async (failure) => {
    if (failure === 'network')
      vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    else vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 403 }))
    const { user, download, windowOpen, onCancel } = setup()
    await user.click(button('download'))
    expect(await screen.findByText('common.operation.downloadFailed')).toBeInTheDocument()
    expect(download).not.toHaveBeenCalled()
    expect(windowOpen).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  },
)
