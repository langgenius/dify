import { cleanup, render, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PluginImg } from './plugin-img'

/* -------------------- Mocks -------------------- */

vi.mock('@/app/components/base/image-gallery', () => ({
  __esModule: true,
  default: ({ srcs }: { srcs: string[] }) => (
    <div data-testid="image-gallery">{srcs[0]}</div>
  ),
}))

const mockUsePluginReadmeAsset = vi.fn()
vi.mock('@/service/use-plugins', () => ({
  usePluginReadmeAsset: (args: unknown) => mockUsePluginReadmeAsset(args),
}))

const mockGetMarkdownImageURL = vi.fn()
vi.mock('./utils', () => ({
  getMarkdownImageURL: (src: string, pluginId?: string) =>
    mockGetMarkdownImageURL(src, pluginId),
}))

/* -------------------- Tests -------------------- */

describe('PluginImg', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('uses blob URL when assetData exists', () => {
    const fakeBlob = new Blob(['test'])
    const fakeObjectUrl = 'blob:test-url'

    mockUsePluginReadmeAsset.mockReturnValue({ data: fakeBlob })
    mockGetMarkdownImageURL.mockReturnValue('fallback-url')

    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue(fakeObjectUrl)

    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL')

    const { unmount } = render(
      <PluginImg
        src="file.png"
        pluginInfo={{ pluginUniqueIdentifier: 'abc', pluginId: '123' }}
      />,
    )

    const gallery = screen.getByTestId('image-gallery')
    expect(gallery.textContent).toBe(fakeObjectUrl)

    expect(createSpy).toHaveBeenCalledWith(fakeBlob)

    unmount()

    expect(revokeSpy).toHaveBeenCalledWith(fakeObjectUrl)
  })

  it('falls back to getMarkdownImageURL when no assetData', () => {
    mockUsePluginReadmeAsset.mockReturnValue({ data: undefined })
    mockGetMarkdownImageURL.mockReturnValue('computed-url')

    render(
      <PluginImg
        src="file.png"
        pluginInfo={{ pluginUniqueIdentifier: 'abc', pluginId: '123' }}
      />,
    )

    const gallery = screen.getByTestId('image-gallery')
    expect(gallery.textContent).toBe('computed-url')

    expect(mockGetMarkdownImageURL).toHaveBeenCalledWith('file.png', '123')
  })

  it('works without pluginInfo', () => {
    mockUsePluginReadmeAsset.mockReturnValue({ data: undefined })
    mockGetMarkdownImageURL.mockReturnValue('default-url')

    render(<PluginImg src="file.png" />)

    const gallery = screen.getByTestId('image-gallery')
    expect(gallery.textContent).toBe('default-url')

    expect(mockGetMarkdownImageURL).toHaveBeenCalledWith('file.png', undefined)
  })
})
