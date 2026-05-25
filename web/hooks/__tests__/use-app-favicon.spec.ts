import { renderHook, waitFor } from '@testing-library/react'
import { useAppFavicon } from '../use-app-favicon'

describe('useAppFavicon', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
  })

  describe('favicon rendering', () => {
    it('should keep server-rendered icon links and add an app-owned favicon', async () => {
      document.head.innerHTML = '<link rel="icon" href="/icon-192x192.png">'
      const serverIcon = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')!

      const { unmount } = renderHook(() => useAppFavicon({
        icon_type: 'image',
        icon_url: '/app-icon.png',
      }))

      await waitFor(() => {
        expect(document.head.querySelector('link[data-dify-runtime-favicon="app"]')).toHaveAttribute('href', '/app-icon.png')
      })
      expect(document.head).toContainElement(serverIcon)
      expect(serverIcon).toHaveAttribute('href', '/icon-192x192.png')

      unmount()

      expect(document.head.querySelector('link[data-dify-runtime-favicon="app"]')).not.toBeInTheDocument()
      expect(document.head).toContainElement(serverIcon)
    })
  })
})
