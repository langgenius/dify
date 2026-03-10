/* eslint-disable next/no-img-element */
import type { ExtraProps } from 'streamdown'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePluginReadmeAsset } from '@/service/use-plugins'
import { PluginParagraph } from '../plugin-paragraph'
import { getMarkdownImageURL, hasImageChild } from '../utils'

// Mock dependencies
vi.mock('@/service/use-plugins', () => ({
  usePluginReadmeAsset: vi.fn(),
}))

vi.mock('../utils', () => ({
  getMarkdownImageURL: vi.fn(),
  hasImageChild: vi.fn((): boolean => false),
}))

vi.mock('@/app/components/base/image-uploader/image-preview', () => ({
  default: ({ url, onCancel }: { url: string, onCancel: () => void }) => (
    <div data-testid="image-preview-modal">
      <span>{url}</span>
      <button onClick={onCancel} type="button">Close</button>
    </div>
  ),
}))

/**
 * Helper to build a minimal hast-compatible Element node for testing.
 * The runtime code only reads `node.children[*].tagName` and `.properties.src`,
 * so we keep the mock minimal and cast to satisfy the full hast Element type.
 */
type MockChild = { tagName?: string, properties?: { src?: string } }

function mockNode(children: MockChild[]): ExtraProps['node'] {
  return { type: 'element', tagName: 'p', properties: {}, children } as unknown as ExtraProps['node']
}

type HookReturn = {
  data?: Blob
  isLoading?: boolean
  error?: Error | null
}

describe('PluginParagraph', () => {
  const mockPluginInfo = {
    pluginUniqueIdentifier: 'test-plugin-id',
    pluginId: 'plugin-123',
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Ensure URL globals exist in the test environment using globalThis
    if (!globalThis.URL.createObjectURL) {
      globalThis.URL.createObjectURL = vi.fn()
      globalThis.URL.revokeObjectURL = vi.fn()
    }

    // Default mock return to prevent destructuring errors
    vi.mocked(usePluginReadmeAsset).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as HookReturn as ReturnType<typeof usePluginReadmeAsset>)
  })

  it('should render a standard paragraph when not an image', () => {
    const node = mockNode([{ tagName: 'span' }])
    render(
      <PluginParagraph node={node}>
        Hello World
      </PluginParagraph>,
    )

    expect(screen.getByTestId('standard-paragraph')).toHaveTextContent('Hello World')
  })

  it('should render an ImageGallery when the first child is an image', () => {
    const node = mockNode([{ tagName: 'img', properties: { src: 'test-img.png' } }])
    vi.mocked(getMarkdownImageURL).mockReturnValue('https://cdn.com/test-img.png')

    const { container } = render(
      <PluginParagraph pluginInfo={mockPluginInfo} node={node}>
        <img src="test-img.png" alt="" />
      </PluginParagraph>,
    )

    expect(screen.getByTestId('image-paragraph-wrapper')).toBeInTheDocument()
    // Query by selector since alt="" removes the 'img' role from the accessibility tree
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', 'https://cdn.com/test-img.png')
  })

  it('should use a blob URL when asset data is successfully fetched', () => {
    const node = mockNode([{ tagName: 'img', properties: { src: 'test-img.png' } }])
    const mockBlob = new Blob([''], { type: 'image/png' })
    vi.mocked(usePluginReadmeAsset).mockReturnValue({
      data: mockBlob,
    } as HookReturn as ReturnType<typeof usePluginReadmeAsset>)

    vi.spyOn(globalThis.URL, 'createObjectURL').mockReturnValue('blob:actual-blob-url')

    const { container } = render(
      <PluginParagraph pluginInfo={mockPluginInfo} node={node}>
        <img src="test-img.png" alt="" />
      </PluginParagraph>,
    )

    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', 'blob:actual-blob-url')
  })

  it('should render remaining children below the image gallery', () => {
    const node = mockNode([
      { tagName: 'img', properties: { src: 'test-img.png' } },
      { tagName: 'text' },
    ])

    render(
      <PluginParagraph pluginInfo={mockPluginInfo} node={node}>
        <img src="test-img.png" alt="" />
        <span>Caption Text</span>
      </PluginParagraph>,
    )

    expect(screen.getByTestId('remaining-children')).toHaveTextContent('Caption Text')
  })

  it('should revoke the blob URL on unmount to prevent memory leaks', () => {
    const node = mockNode([{ tagName: 'img', properties: { src: 'test-img.png' } }])
    const mockBlob = new Blob([''], { type: 'image/png' })
    vi.mocked(usePluginReadmeAsset).mockReturnValue({
      data: mockBlob,
    } as HookReturn as ReturnType<typeof usePluginReadmeAsset>)

    const revokeSpy = vi.spyOn(globalThis.URL, 'revokeObjectURL')
    vi.spyOn(globalThis.URL, 'createObjectURL').mockReturnValue('blob:cleanup-test')

    const { unmount } = render(
      <PluginParagraph pluginInfo={mockPluginInfo} node={node}>
        <img src="test-img.png" alt="" />
      </PluginParagraph>,
    )

    unmount()
    expect(revokeSpy).toHaveBeenCalledWith('blob:cleanup-test')
  })

  it('should open the image preview modal when an image in the gallery is clicked', async () => {
    const user = userEvent.setup()
    const node = mockNode([{ tagName: 'img', properties: { src: 'test-img.png' } }])
    vi.mocked(getMarkdownImageURL).mockReturnValue('https://cdn.com/gallery.png')

    const { container } = render(
      <PluginParagraph pluginInfo={mockPluginInfo} node={node}>
        <img src="test-img.png" alt="" />
      </PluginParagraph>,
    )

    const img = container.querySelector('img')
    if (img)
      await user.click(img)

    // ImageGallery is not mocked, so it should trigger the preview
    expect(screen.getByTestId('image-preview-modal')).toBeInTheDocument()
    expect(screen.getByText('https://cdn.com/gallery.png')).toBeInTheDocument()

    const closeBtn = screen.getByText('Close')
    await user.click(closeBtn)
    expect(screen.queryByTestId('image-preview-modal')).not.toBeInTheDocument()
  })

  it('should render div instead of p when image is not the first child', () => {
    vi.mocked(hasImageChild).mockReturnValue(true)

    const node = mockNode([
      { tagName: 'span' },
      { tagName: 'img', properties: { src: 'test.png' } },
    ])

    render(
      <PluginParagraph node={node}>
        <span>Text</span>
      </PluginParagraph>,
    )

    expect(screen.getByTestId('image-fallback-paragraph')).toBeInTheDocument()
    expect(screen.getByTestId('image-fallback-paragraph').tagName).toBe('DIV')
  })
})
