import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { PluginImg } from '../plugin-img'

const { request } = vi.hoisted(() => ({ request: vi.fn<() => Promise<Response>>() }))
vi.mock('@/service/base', () => ({ request }))
// Keep the unrelated marketplace image fallback local; all asset bytes still go
// through the generated Console client and the browser's real image decoder.
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  MARKETPLACE_API_PREFIX:
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#',
}))

async function pngResponse(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas context unavailable')
  context.fillStyle = 'red'
  context.fillRect(0, 0, width, height)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => {
      if (value) resolve(value)
      else reject(new Error('PNG encoding failed'))
    }, 'image/png'),
  )
  return new Response(await blob.arrayBuffer(), {
    headers: { 'content-type': 'application/octet-stream' },
  })
}

// happy-dom cannot decode an octet-stream asset, or establish that a revoked
// object URL is unusable. These are the additional browser regression contracts.
it('decodes binary assets and retires object URLs on source replacement and unmount', async () => {
  request.mockReset()
  request.mockImplementation(() => pngResponse(2, 3))
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 300_000 } },
  })
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  const pluginInfo = { pluginUniqueIdentifier: 'org/plugin:1@hash', pluginId: 'org/plugin' }
  const view = (src: string) => (
    <QueryClientProvider client={queryClient}>
      <PluginImg pluginInfo={pluginInfo} src={src} />
    </QueryClientProvider>
  )
  const screen = await render(view('_assets/first.png'))
  try {
    await expect
      .poll(() => screen.getByTestId('gallery-image').element().getAttribute('src'))
      .toMatch(/^blob:/)
    const firstImage = screen.getByTestId('gallery-image').element()
    if (!(firstImage instanceof HTMLImageElement)) throw new TypeError('Expected an image')
    await firstImage.decode()
    expect([firstImage.naturalWidth, firstImage.naturalHeight]).toEqual([2, 3])
    const firstUrl = firstImage.src
    expect(revoke).not.toHaveBeenCalled()
    request.mockImplementation(() => pngResponse(4, 5))
    await screen.rerender(view('_assets/second.png'))
    await expect
      .poll(() => screen.getByTestId('gallery-image').element().getAttribute('src'))
      .not.toBe(firstUrl)
    await expect
      .poll(() => screen.getByTestId('gallery-image').element().getAttribute('src'))
      .toMatch(/^blob:/)
    const secondImage = screen.getByTestId('gallery-image').element()
    if (!(secondImage instanceof HTMLImageElement)) throw new TypeError('Expected an image')
    await secondImage.decode()
    expect([secondImage.naturalWidth, secondImage.naturalHeight]).toEqual([4, 5])
    expect(revoke).toHaveBeenCalledWith(firstUrl)
    const secondUrl = secondImage.src
    await screen.unmount()
    expect(revoke).toHaveBeenCalledWith(secondUrl)
    const releasedImage = new Image()
    releasedImage.src = secondUrl
    await expect(releasedImage.decode()).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(2)
  } finally {
    await screen.unmount()
    queryClient.clear()
    revoke.mockRestore()
  }
})

it('recovers after a malformed asset causes the real gallery to remove its image button', async () => {
  request.mockReset()
  request.mockImplementation(
    async () =>
      new Response(new Uint8Array([0, 1, 2, 3]), {
        headers: { 'content-type': 'application/octet-stream' },
      }),
  )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 300_000 } },
  })
  const failedImages: string[] = []
  const handleImageError = (event: Event) => {
    if (event.target instanceof HTMLImageElement && event.target.src.startsWith('blob:'))
      failedImages.push(event.target.src)
  }
  document.addEventListener('error', handleImageError, true)
  const pluginInfo = { pluginUniqueIdentifier: 'org/plugin:1@hash', pluginId: 'org/plugin' }
  const view = (src: string) => (
    <QueryClientProvider client={queryClient}>
      <PluginImg pluginInfo={pluginInfo} src={src} />
    </QueryClientProvider>
  )
  const screen = await render(view('_assets/malformed.png'))
  try {
    await expect.poll(() => failedImages.length).toBe(1)
    await expect.element(screen.getByTestId('gallery-image')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: /^common\.imageGallery\.previewImage/ }))
      .not.toBeInTheDocument()

    request.mockImplementation(() => pngResponse(6, 7))
    await screen.rerender(view('_assets/valid.png'))
    await expect
      .element(screen.getByRole('button', { name: /^common\.imageGallery\.previewImage/ }))
      .toBeVisible()
    await expect
      .poll(() => screen.getByTestId('gallery-image').element().getAttribute('src'))
      .toMatch(/^blob:/)
    const recoveredImage = screen.getByTestId('gallery-image').element()
    if (!(recoveredImage instanceof HTMLImageElement)) throw new TypeError('Expected an image')
    await recoveredImage.decode()
    expect([recoveredImage.naturalWidth, recoveredImage.naturalHeight]).toEqual([6, 7])
    expect(request).toHaveBeenCalledTimes(2)
  } finally {
    document.removeEventListener('error', handleImageError, true)
    await screen.unmount()
    queryClient.clear()
  }
})
