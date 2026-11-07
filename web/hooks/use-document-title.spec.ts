import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import useDocumentTitle from './use-document-title'

describe('useDocumentTitle', () => {
  let originalTitle: string
  beforeEach(() => {
    originalTitle = document.title
  })
  afterEach(() => {
    document.title = originalTitle
  })

  it('preserves route metadata while system features are pending', () => {
    document.title = 'Route title'
    renderHookWithConsoleQuery(() => useDocumentTitle('Settings'), { systemFeatures: null })
    expect(document.title).toBe('Route title')
  })

  it('uses the default product name', () => {
    renderHookWithConsoleQuery(() => useDocumentTitle('Settings'), {
      systemFeatures: { branding: { enabled: false } },
    })
    expect(document.title).toBe('Settings - Dify')
  })

  it('uses the configured product name with or without a page title', () => {
    const { rerender } = renderHookWithConsoleQuery(({ title }) => useDocumentTitle(title), {
      initialProps: { title: 'Settings' },
      systemFeatures: { branding: { enabled: true, application_title: 'Acme' } },
    })

    expect(document.title).toBe('Settings - Acme')
    rerender({ title: '' })
    expect(document.title).toBe('Acme')
  })

  it('preserves route metadata when no client title is provided', () => {
    document.title = 'Route title - Dify'

    renderHookWithConsoleQuery(() => useDocumentTitle(null))

    expect(document.title).toBe('Route title - Dify')
  })

  it('does not mutate framework-owned favicon metadata', () => {
    const favicon = document.createElement('link')
    favicon.rel = 'icon'
    favicon.href = '/favicon.ico'
    document.head.appendChild(favicon)
    onTestFinished(() => favicon.remove())

    renderHookWithConsoleQuery(() => useDocumentTitle('Settings'), {
      systemFeatures: {
        branding: {
          application_title: 'Acme',
          enabled: true,
          favicon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
        },
      },
    })

    expect(favicon.isConnected).toBe(true)
    expect(favicon).toHaveAttribute('rel', 'icon')
    expect(favicon).toHaveAttribute('href', '/favicon.ico')
  })
})
