import { clearRuntimeFavicon, setRuntimeFavicon } from '../favicon'

describe('runtime favicon utilities', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
  })

  describe('favicon rendering', () => {
    it('should add runtime favicon links without removing server-rendered links', () => {
      document.head.innerHTML = `
        <link rel="apple-touch-icon" href="/apple-touch-icon.png">
        <link rel="icon" href="/icon-192x192.png">
      `
      const serverAppleIcon = document.head.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')!
      const serverIcon = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')!

      setRuntimeFavicon('document', '/custom-favicon.ico', {
        appleTouchIconHref: '/custom-apple-icon.png',
      })

      expect(document.head).toContainElement(serverAppleIcon)
      expect(document.head).toContainElement(serverIcon)
      expect(document.head.querySelector('link[data-dify-runtime-favicon="document"]')).toHaveAttribute('href', '/custom-favicon.ico')
      expect(document.head.querySelector('link[data-dify-runtime-apple-touch-icon="document"]')).toHaveAttribute('href', '/custom-apple-icon.png')
    })

    it('should update existing runtime links instead of appending duplicates', () => {
      setRuntimeFavicon('document', '/first.ico', {
        appleTouchIconHref: '/first-apple.png',
      })
      setRuntimeFavicon('document', '/second.ico', {
        appleTouchIconHref: '/second-apple.png',
      })

      expect(document.head.querySelectorAll('link[data-dify-runtime-favicon="document"]')).toHaveLength(1)
      expect(document.head.querySelectorAll('link[data-dify-runtime-apple-touch-icon="document"]')).toHaveLength(1)
      expect(document.head.querySelector('link[data-dify-runtime-favicon="document"]')).toHaveAttribute('href', '/second.ico')
      expect(document.head.querySelector('link[data-dify-runtime-apple-touch-icon="document"]')).toHaveAttribute('href', '/second-apple.png')
    })

    it('should clear only runtime links for the requested kind', () => {
      document.head.innerHTML = '<link rel="icon" href="/icon-192x192.png">'
      const serverIcon = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')!
      setRuntimeFavicon('document', '/document.ico')
      setRuntimeFavicon('app', '/app.ico')

      clearRuntimeFavicon('document')

      expect(document.head).toContainElement(serverIcon)
      expect(document.head.querySelector('link[data-dify-runtime-favicon="document"]')).not.toBeInTheDocument()
      expect(document.head.querySelector('link[data-dify-runtime-favicon="app"]')).toBeInTheDocument()
    })
  })
})
