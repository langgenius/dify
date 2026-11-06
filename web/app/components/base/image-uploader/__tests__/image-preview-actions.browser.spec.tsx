import type { ComponentProps } from 'react'
import type { Mock, MockInstance } from 'vite-plus/test'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createDeferred } from '@/test/deferred'
import { createImageFile, readImagePixels } from '@/test/fixtures/image-files'
import fixtureUrl from '@/test/fixtures/media/preview.svg?url&no-inline'
import ImagePreview from '../image-preview'

let png: File
let dataImage: string
let copied: Blob | undefined
let fetchImage: Mock<typeof fetch>
let clipboardWrite: MockInstance<Clipboard['write']>
let unexpectedFetch: Mock<(url: string) => void>
const button = (action: string) => page.getByRole('button', { name: `common.operation.${action}` })
const fullUrl = () => new URL(fixtureUrl, window.location.href).href

beforeEach(async () => {
  png = await createImageFile()
  dataImage = await new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(png)
  })
  copied = undefined
  unexpectedFetch = vi.fn()
  const nativeFetch = globalThis.fetch.bind(globalThis)
  fetchImage = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.startsWith('data:') || url.startsWith('blob:')) return nativeFetch(input, init)
    if (url === fixtureUrl || url === fullUrl()) return new Response(png)
    unexpectedFetch(url)
    throw new Error(`Unexpected image request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchImage)
  // The system clipboard is the boundary; ClipboardItem, decoding and canvas conversion stay real.
  clipboardWrite = vi.spyOn(navigator.clipboard, 'write').mockImplementation(async (items) => {
    copied = await items[0]!.getType('image/png')
  })
})
afterEach(() => {
  toast.dismiss()
  expect(unexpectedFetch).not.toHaveBeenCalled()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function setup(props: Partial<ComponentProps<typeof ImagePreview>> = {}) {
  function PreviewCaller() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Open preview</button>
        {open && (
          <ImagePreview
            url={dataImage}
            title="Preview Image"
            {...props}
            onCancel={() => setOpen(false)}
          />
        )}
        <AppToaster timeout={0} />
      </>
    )
  }
  await render(<PreviewCaller />)
  await page.getByRole('button', { name: 'Open preview' }).click()
}

it.each(['data URL', 'raw base64'])('decodes a preview supplied as %s', async (source) => {
  await page.viewport(640, 480)
  await setup({ url: source === 'data URL' ? dataImage : dataImage.split(',')[1] })
  const image = page.getByRole('img', { name: 'Preview Image' })
  await expect.element(page.getByRole('dialog', { name: 'Preview Image' })).toBeVisible()
  await expect.element(image).toHaveAttribute('src', dataImage)
  await expect.poll(() => (image.element() as HTMLImageElement).naturalWidth).toBe(120)
})

it('names an untitled preview and keeps it open until Close is activated', async () => {
  await page.viewport(640, 480)
  await setup({ title: '   ' })
  const dialog = page.getByRole('dialog', { name: 'workflow.common.preview' })
  await expect.element(dialog).toBeVisible()
  await page.getByTestId('image-preview-image').click()
  await expect.element(dialog).toBeVisible()
  await button('cancel').click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Open preview' })).toHaveFocus()
})

it.each(['absolute', 'relative'])(
  'opens a served image with an %s URL in a new tab',
  async (kind) => {
    await page.viewport(640, 480)
    const url = kind === 'absolute' ? fullUrl() : fixtureUrl
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null)
    await setup({ url })
    await button('openInNewTab').click()
    expect(windowOpen).toHaveBeenCalledExactlyOnceWith(url, '_blank')
  },
)

it.each(['data URL', 'raw base64'])(
  'opens an inline %s with its title treated as text',
  async (source) => {
    await page.viewport(640, 480)
    await render(<iframe title="Image tab" />)
    const frame = page.getByTitle('Image tab')
    await expect.element(frame).toBeInTheDocument()
    const popup = (frame.element() as HTMLIFrameElement).contentWindow!
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(popup)
    const title = '"><script>window.injected = true</script>'
    await setup({ url: source === 'data URL' ? dataImage : dataImage.split(',')[1], title })
    await button('openInNewTab').click()
    expect(windowOpen).toHaveBeenCalledOnce()
    // This is the public document emitted to the new browsing context.
    const image = popup.document.querySelector('img')!
    await image.decode()
    expect(image.src).toBe(dataImage)
    expect(image.alt).toBe(title)
    expect(image.naturalWidth).toBe(120)
    expect(popup.document.querySelector('script')).toBeNull()
  },
)

it('reports an unsupported URL without opening a tab', async () => {
  await page.viewport(640, 480)
  const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null)
  await setup({ url: 'file:///tmp/image.png' })
  await button('openInNewTab').click()
  await expect.element(page.getByText('Unable to open image: file:///tmp/image.png')).toBeVisible()
  expect(windowOpen).not.toHaveBeenCalled()
})

it.each(['permission', 'fetch'] as const)(
  'keeps the preview open after a clipboard %s failure',
  async (failure) => {
    await page.viewport(640, 480)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    if (failure === 'permission')
      clipboardWrite.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
    else fetchImage.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null)
    await setup()
    await button('copyImage').click()
    await expect.element(page.getByText('common.operation.imageCopyFailed')).toBeVisible()
    await expect.element(page.getByRole('dialog', { name: 'Preview Image' })).toBeVisible()
    expect(copied).toBeUndefined()
    expect(download).not.toHaveBeenCalled()
    expect(windowOpen).not.toHaveBeenCalled()
  },
)

it('starts clipboard writing during the native click before the PNG request settles', async () => {
  await page.viewport(640, 480)
  const request = createDeferred<Response>()
  fetchImage.mockReturnValueOnce(request.promise)
  let activeGesture = false
  clipboardWrite.mockImplementationOnce(async (items) => {
    activeGesture = navigator.userActivation.isActive
    copied = await items[0]!.getType('image/png')
  })
  await setup({ url: fullUrl() })
  await button('copyImage').click()
  expect(clipboardWrite).toHaveBeenCalledOnce()
  expect(activeGesture).toBe(true)
  expect(copied).toBeUndefined()
  await expect.element(page.getByText('common.operation.imageCopied')).not.toBeInTheDocument()
  request.resolve(new Response(png))
  await expect.element(page.getByText('common.operation.imageCopied')).toBeVisible()
  expect(await readImagePixels(copied!)).toEqual({
    width: 120,
    height: 80,
    left: [255, 0, 0, 255],
    right: [0, 0, 255, 255],
  })
})

it('converts real JPEG pixels into a decodable PNG for the clipboard', async () => {
  await page.viewport(640, 480)
  fetchImage.mockResolvedValueOnce(
    new Response(await createImageFile({ name: 'photo.jpg', type: 'image/jpeg' })),
  )
  await setup()
  await button('copyImage').click()
  await expect.element(page.getByText('common.operation.imageCopied')).toBeVisible()
  expect(copied!.type).toBe('image/png')
  const pixels = await readImagePixels(copied!)
  expect([pixels.width, pixels.height]).toEqual([120, 80])
  expect(pixels.left[0]).toBeGreaterThan(240)
  expect(pixels.left[2]).toBeLessThan(10)
  expect(pixels.right[2]).toBeGreaterThan(240)
  expect(pixels.right[0]).toBeLessThan(10)
})

it('copies the actual inline PNG bytes', async () => {
  await page.viewport(640, 480)
  await setup()
  await button('copyImage').click()
  await expect.element(page.getByText('common.operation.imageCopied')).toBeVisible()
  expect(new Uint8Array(await copied!.arrayBuffer())).toEqual(
    new Uint8Array(await png.arrayBuffer()),
  )
})

it.each(['absolute', 'relative', 'inline'])(
  'downloads the %s image bytes with their filename',
  async (source) => {
    await page.viewport(640, 480)
    const title = source === 'relative' ? '' : 'Screenshot.png'
    const url = source === 'inline' ? dataImage : source === 'absolute' ? fullUrl() : fixtureUrl
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
    const downloads: { href: string; name: string; target: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ href: this.href, name: this.download, target: this.target })
    })
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null)
    await setup({ url, title })
    await button('download').click()
    await expect.poll(() => downloads.length).toBe(1)
    expect(downloads[0]).toEqual({
      href: expect.stringMatching(/^blob:/),
      name: title || 'image.png',
      target: '',
    })
    const blob = createObjectURL.mock.calls[0]![0] as Blob
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array(await png.arrayBuffer()),
    )
    expect(revokeObjectURL).toHaveBeenCalledWith(downloads[0]!.href)
    expect(windowOpen).not.toHaveBeenCalled()
    await expect.element(page.getByRole('dialog')).toBeVisible()
  },
)

it.each(['network', 'http'])(
  'keeps the preview open after a %s download failure',
  async (failure) => {
    await page.viewport(640, 480)
    if (failure === 'network') fetchImage.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    else fetchImage.mockResolvedValueOnce(new Response(null, { status: 403 }))
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null)
    await setup()
    await button('download').click()
    await expect.element(page.getByText('common.operation.downloadFailed')).toBeVisible()
    await expect.element(page.getByRole('dialog', { name: 'Preview Image' })).toBeVisible()
    expect(download).not.toHaveBeenCalled()
    expect(windowOpen).not.toHaveBeenCalled()
  },
)
