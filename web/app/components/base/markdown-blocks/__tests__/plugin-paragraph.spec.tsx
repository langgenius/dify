import type { ExtraProps } from 'streamdown'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginParagraph } from '../plugin-paragraph'
import { getMarkdownImageURL } from '../utils'

const { request } = vi.hoisted(() => ({ request: vi.fn<() => Promise<Response>>() }))
vi.mock('@/service/base', () => ({ request }))
const pluginInfo = { pluginUniqueIdentifier: 'org/plugin:1@hash', pluginId: 'org/plugin' }
const imageNode = (src: string): ExtraProps['node'] => ({
  type: 'element',
  tagName: 'p',
  properties: {},
  children: [{ type: 'element', tagName: 'img', properties: { src }, children: [] }],
})
let queryClient: QueryClient
beforeEach(() => {
  vi.clearAllMocks()
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 300_000 } },
  })
  request.mockImplementation(
    async () =>
      new Response('image-bytes', { headers: { 'content-type': 'application/octet-stream' } }),
  )
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:paragraph-image')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
})
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

it('displays the leading asset with its caption and preserves ordinary paragraph content without requesting assets', async () => {
  const { unmount } = render(
    <>
      <PluginParagraph pluginInfo={pluginInfo} node={imageNode('./_assets/caption.png')}>
        <img src="./_assets/caption.png" alt="" />
        <span>Image caption</span>
      </PluginParagraph>
      <PluginParagraph pluginInfo={pluginInfo}>Ordinary paragraph</PluginParagraph>
    </>,
    { wrapper },
  )
  await waitFor(() =>
    expect(screen.getByTestId('gallery-image')).toHaveAttribute('src', 'blob:paragraph-image'),
  )
  expect(screen.getByText('Image caption')).toBeInTheDocument()
  expect(screen.getByText('Ordinary paragraph').tagName).toBe('P')
  expect(request).toHaveBeenCalledOnce()
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()

  unmount()

  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:paragraph-image')
})

it('uses nested image children without issuing a duplicate leading-image request', () => {
  render(
    <PluginParagraph
      pluginInfo={pluginInfo}
      node={{
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [
          { type: 'text', value: 'Description' },
          {
            type: 'element',
            tagName: 'img',
            properties: { src: '_assets/nested.png' },
            children: [],
          },
        ],
      }}
    >
      <span>Description</span>
      <img src="https://example.com/nested.png" alt="Nested diagram" />
    </PluginParagraph>,
    { wrapper },
  )
  expect(screen.getByText('Description')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Nested diagram' })).toHaveAttribute(
    'src',
    'https://example.com/nested.png',
  )
  expect(request).not.toHaveBeenCalled()
})

it('closes the obsolete asset preview when the paragraph changes to an external image and releases its URL', async () => {
  const user = userEvent.setup()
  const { rerender, unmount } = render(
    <PluginParagraph pluginInfo={pluginInfo} node={imageNode('_assets/old.png')} />,
    { wrapper },
  )
  await waitFor(() =>
    expect(screen.getByTestId('gallery-image')).toHaveAttribute('src', 'blob:paragraph-image'),
  )
  await user.click(screen.getByRole('button', { name: /^common\.imageGallery\.previewImage/ }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  rerender(
    <PluginParagraph pluginInfo={pluginInfo} node={imageNode('https://example.com/new.png')} />,
  )
  expect(screen.getByTestId('gallery-image')).toHaveAttribute(
    'src',
    getMarkdownImageURL('https://example.com/new.png', pluginInfo.pluginId),
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:paragraph-image')
  expect(request).toHaveBeenCalledOnce()
  unmount()
})
