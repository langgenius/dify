import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { PluginImg } from '../plugin-img'
import { PluginParagraph } from '../plugin-paragraph'
import { getMarkdownImageURL } from '../utils'

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<
      (
        url: string,
        init: RequestInit,
        options: { request: Request; silent?: boolean },
      ) => Promise<Response>
    >(),
}))
vi.mock('@/service/base', () => ({ request }))

const pluginInfo = { pluginUniqueIdentifier: 'org/plugin:1.0.0@hash', pluginId: 'org/plugin' }
const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
let queryClient: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 300_000 } },
  })
  request.mockImplementation(
    async () => new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }),
  )
  let nextUrl = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:asset-${++nextUrl}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
})

const renderImage = (src: string, info = pluginInfo) =>
  render(<PluginImg src={src} pluginInfo={info} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })

it('shares normalized resource requests between image and paragraph consumers and caches binary bytes', async () => {
  render(
    <QueryClientProvider client={queryClient}>
      <PluginImg src="./_assets/logo.png" pluginInfo={pluginInfo} />
      <PluginParagraph
        pluginInfo={pluginInfo}
        node={{
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'img',
              properties: { src: '_assets/logo.png' },
              children: [],
            },
          ],
        }}
      />
    </QueryClientProvider>,
  )
  await waitFor(() =>
    expect(
      screen.getAllByTestId('gallery-image').map((image) => image.getAttribute('src')),
    ).toEqual(['blob:asset-1', 'blob:asset-2']),
  )
  expect(request).toHaveBeenCalledOnce()
  const [url, , options] = request.mock.calls[0]!
  expect(new URL(url).pathname).toBe('/console/api/workspaces/current/plugin/asset')
  expect(new URL(url).searchParams.get('file_name')).toBe('logo.png')
  expect(new URL(url).searchParams.get('plugin_unique_identifier')).toBe(
    pluginInfo.pluginUniqueIdentifier,
  )
  expect(options.request.method).toBe('GET')
  expect(options.silent).toBe(true)
  const cached = queryClient.getQueryData(
    consoleQuery.workspaces.current.plugin.asset.get.queryKey({
      input: {
        query: {
          file_name: 'logo.png',
          plugin_unique_identifier: pluginInfo.pluginUniqueIdentifier,
        },
      },
    }),
  )
  expect(cached).toBeInstanceOf(Blob)
  if (!(cached instanceof Blob)) throw new TypeError('Expected binary asset cache')
  expect(cached.type).toBe('application/octet-stream')
  expect(new Uint8Array(await cached.arrayBuffer())).toEqual(bytes)
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
})

it.each([
  { src: 'https://example.com/logo.png', info: pluginInfo },
  { src: '_assets/logo.png', info: { ...pluginInfo, pluginUniqueIdentifier: '' } },
  { src: '', info: pluginInfo },
])('keeps non-requestable resources on their existing fallback ($src)', ({ src, info }) => {
  renderImage(src, info)
  if (src)
    expect(screen.getByTestId('gallery-image')).toHaveAttribute(
      'src',
      getMarkdownImageURL(src, info.pluginId),
    )
  else expect(screen.queryByTestId('gallery-image')).not.toBeInTheDocument()
  expect(request).not.toHaveBeenCalled()
})

it.each(['plugin', 'source'] as const)(
  'retires the old image and open preview when its %s changes',
  async (change) => {
    const user = userEvent.setup()
    const { rerender, unmount } = renderImage('_assets/logo.png')
    await waitFor(() =>
      expect(screen.getByTestId('gallery-image')).toHaveAttribute('src', 'blob:asset-1'),
    )
    await user.click(screen.getByRole('button', { name: /^common\.imageGallery\.previewImage/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    let resolveResponse: ((response: Response) => void) | undefined
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve
        }),
    )
    const src = change === 'source' ? '_assets/other.png' : '_assets/logo.png'
    const info =
      change === 'plugin'
        ? { ...pluginInfo, pluginUniqueIdentifier: 'org/plugin:2.0.0@new' }
        : pluginInfo
    rerender(<PluginImg src={src} pluginInfo={info} />)
    expect(screen.getByTestId('gallery-image')).toHaveAttribute(
      'src',
      getMarkdownImageURL(src, info.pluginId),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:asset-1')
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    resolveResponse?.(
      new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('gallery-image')).toHaveAttribute('src', 'blob:asset-2'),
    )
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:asset-2')
  },
)

it('retains the marketplace fallback when the asset request fails', async () => {
  request.mockImplementation(async () =>
    Response.json({ message: 'Missing asset' }, { status: 404 }),
  )
  renderImage('_assets/missing.png')
  await waitFor(() => expect(queryClient.getQueryCache().getAll()[0]?.state.status).toBe('error'))
  expect(screen.getByTestId('gallery-image')).toHaveAttribute(
    'src',
    getMarkdownImageURL('_assets/missing.png', pluginInfo.pluginId),
  )
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('inherits asset retries from the client and stays silent when the first HTTP attempt fails', async () => {
  queryClient.setDefaultOptions({ queries: { retry: 2, retryDelay: 0, staleTime: 300_000 } })
  request.mockImplementationOnce(async () =>
    Response.json({ message: 'Temporarily unavailable' }, { status: 503 }),
  )
  const errorToast = vi.spyOn(toast, 'error')
  renderImage('_assets/retry.png')

  await waitFor(() =>
    expect(screen.getByTestId('gallery-image')).toHaveAttribute('src', 'blob:asset-1'),
  )
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls.every(([, , options]) => options.silent === true)).toBe(true)
  expect(errorToast).not.toHaveBeenCalled()
})

it.each([
  { kind: 'image', status: 'pending' },
  { kind: 'image', status: 'failed' },
  { kind: 'paragraph', status: 'pending' },
  { kind: 'paragraph', status: 'failed' },
])(
  'closes a $status $kind fallback preview when only the plugin version changes',
  async ({ kind, status }) => {
    const user = userEvent.setup()
    request.mockImplementation(() =>
      status === 'pending'
        ? new Promise<Response>(() => {})
        : Promise.resolve(Response.json({ message: 'Missing asset' }, { status: 404 })),
    )
    const src = '_assets/logo.png'
    const view = (info: typeof pluginInfo) =>
      kind === 'image' ? (
        <PluginImg src={src} pluginInfo={info} />
      ) : (
        <PluginParagraph
          pluginInfo={info}
          node={{
            type: 'element',
            tagName: 'p',
            properties: {},
            children: [{ type: 'element', tagName: 'img', properties: { src }, children: [] }],
          }}
        />
      )
    const { rerender } = render(view(pluginInfo), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })
    await waitFor(() => expect(request).toHaveBeenCalledOnce())
    if (status === 'failed')
      await waitFor(() =>
        expect(queryClient.getQueryCache().getAll()[0]?.state.status).toBe('error'),
      )
    await user.click(screen.getByRole('button', { name: /^common\.imageGallery\.previewImage/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    rerender(view({ ...pluginInfo, pluginUniqueIdentifier: 'org/plugin:2.0.0@new' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('gallery-image')).toHaveAttribute(
      'src',
      getMarkdownImageURL(src, pluginInfo.pluginId),
    )
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  },
)
