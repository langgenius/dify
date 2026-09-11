import { renderHook, waitFor } from '@testing-library/react'
import { useAppFavicon } from './use-app-favicon'

vi.mock('@/utils/emoji', () => ({
  searchEmoji: vi.fn(async () => '🤖'),
}))

const firstAppIcon = 'https://example.com/app-one.png'
const secondAppIcon = 'https://example.com/app-two.png'

describe('useAppFavicon', () => {
  beforeEach(() => {
    document.head.querySelectorAll('link[rel*="icon"]').forEach((link) => link.remove())
  })

  afterEach(() => {
    document.head.querySelectorAll('link[rel*="icon"]').forEach((link) => link.remove())
  })

  it('leaves the framework favicon untouched and cleans up only its own icon', async () => {
    const frameworkFavicon = document.createElement('link')
    frameworkFavicon.rel = 'icon'
    frameworkFavicon.href = '/favicon.ico'
    document.head.appendChild(frameworkFavicon)

    const { unmount } = renderHook(() =>
      useAppFavicon({ icon_type: 'image', icon_url: firstAppIcon }),
    )

    await waitFor(() => {
      expect(document.head.querySelector('link[data-dify-app-favicon]')).toHaveAttribute(
        'href',
        firstAppIcon,
      )
    })
    expect(frameworkFavicon.isConnected).toBe(true)
    expect(frameworkFavicon).toHaveAttribute('href', '/favicon.ico')

    unmount()

    expect(frameworkFavicon.isConnected).toBe(true)
    expect(document.head.querySelector('link[data-dify-app-favicon]')).not.toBeInTheDocument()
  })

  it('replaces its managed icon when the image URL changes and removes it when disabled', async () => {
    const { rerender } = renderHook(
      ({ enable, iconUrl }) => useAppFavicon({ enable, icon_type: 'image', icon_url: iconUrl }),
      {
        initialProps: { enable: true, iconUrl: firstAppIcon },
      },
    )

    await waitFor(() => {
      expect(document.head.querySelector('link[data-dify-app-favicon]')).toHaveAttribute(
        'href',
        firstAppIcon,
      )
    })

    rerender({ enable: true, iconUrl: secondAppIcon })

    await waitFor(() => {
      expect(document.head.querySelector('link[data-dify-app-favicon]')).toHaveAttribute(
        'href',
        secondAppIcon,
      )
    })
    expect(document.head.querySelectorAll('link[data-dify-app-favicon]')).toHaveLength(1)

    rerender({ enable: false, iconUrl: secondAppIcon })

    await waitFor(() => {
      expect(document.head.querySelector('link[data-dify-app-favicon]')).not.toBeInTheDocument()
    })
  })

  it('renders emoji icons as SVG favicons', async () => {
    renderHook(() =>
      useAppFavicon({ icon_type: 'emoji', icon: 'robot', icon_background: '#ffffff' }),
    )

    await waitFor(() => {
      const favicon = document.head.querySelector('link[data-dify-app-favicon]')
      expect(favicon).toHaveAttribute('rel', 'icon')
      expect(favicon).toHaveAttribute('type', 'image/svg+xml')
      expect(favicon?.getAttribute('href')).toContain('data:image/svg+xml')
      expect(favicon?.getAttribute('href')).toContain('%23ffffff')
      expect(favicon?.getAttribute('href')).toContain('🤖')
    })
  })

  it('uses linked icons as direct favicon URLs', async () => {
    renderHook(() => useAppFavicon({ icon_type: 'link', icon: firstAppIcon }))

    await waitFor(() => {
      expect(document.head.querySelector('link[data-dify-app-favicon]')).toHaveAttribute(
        'href',
        firstAppIcon,
      )
    })
  })

  it('preserves the fallback icon for legacy null icon metadata', async () => {
    renderHook(() => useAppFavicon({ icon_type: null }))

    await waitFor(() => {
      expect(
        document.head.querySelector('link[data-dify-app-favicon]')?.getAttribute('href'),
      ).toContain('🤖')
    })
  })
})
