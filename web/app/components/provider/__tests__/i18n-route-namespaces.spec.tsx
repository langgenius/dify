import { render, waitFor } from '@testing-library/react'
import { I18nRouteNamespacesSync } from '../i18n-route-namespaces'

const mocks = vi.hoisted(() => ({
  pathname: '/apps',
  loadNamespaces: vi.fn().mockResolvedValue(undefined),
  hasLoadedNamespace: vi.fn(() => false),
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => mocks.pathname,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      loadNamespaces: mocks.loadNamespaces,
      hasLoadedNamespace: mocks.hasLoadedNamespace,
    },
  }),
}))

describe('I18nRouteNamespacesSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pathname = '/apps'
    mocks.hasLoadedNamespace.mockReturnValue(false)
    mocks.loadNamespaces.mockResolvedValue(undefined)
  })

  it('loads route namespaces for the current pathname', async () => {
    render(<I18nRouteNamespacesSync />)

    await waitFor(() => {
      expect(mocks.loadNamespaces).toHaveBeenCalled()
    })

    const loadedNamespaces = mocks.loadNamespaces.mock.calls.flatMap((call) => call[0] as string[])
    expect(loadedNamespaces).toContain('common')
    expect(loadedNamespaces).toContain('explore')
  })

  it('prefetches studio namespaces while on the apps list', async () => {
    render(<I18nRouteNamespacesSync />)

    await waitFor(() => {
      expect(mocks.loadNamespaces.mock.calls.length).toBeGreaterThan(1)
    })

    const loadedNamespaces = mocks.loadNamespaces.mock.calls.flatMap((call) => call[0] as string[])
    expect(loadedNamespaces).toContain('workflow')
    expect(loadedNamespaces).toContain('appOverview')
  })

  it('prefetches explore namespaces on sign-in routes', async () => {
    mocks.pathname = '/signin'
    render(<I18nRouteNamespacesSync />)

    await waitFor(() => {
      expect(mocks.loadNamespaces).toHaveBeenCalled()
    })

    const loadedNamespaces = mocks.loadNamespaces.mock.calls.flatMap((call) => call[0] as string[])
    expect(loadedNamespaces).toContain('explore')
  })
})
