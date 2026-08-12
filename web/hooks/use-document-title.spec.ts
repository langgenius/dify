import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import useDocumentTitle from './use-document-title'

describe('useDocumentTitle', () => {
  it('keeps the title empty while system features are pending', () => {
    renderHookWithConsoleQuery(() => useDocumentTitle('Settings'), { systemFeatures: null })
    expect(document.title).toBe('')
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
})
