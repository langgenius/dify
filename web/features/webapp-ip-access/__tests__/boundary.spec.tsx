import { QueryClient, QueryClientProvider, queryOptions, useQuery } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { StrictMode } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import enShare from '@/i18n/en-US/share.json'
import IpAccessBoundary from '../boundary'
import { captureIpAccessScope, handleIpAccessDenied } from '../state'

vi.unmock('react-i18next')
vi.mock('@/i18n-config', () => ({ setLocaleOnClient: vi.fn() }))
vi.mock('@/next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

const i18n = createInstance()

function AppBootstrap({ request }: { request: () => Promise<never> }) {
  useQuery(queryOptions({ queryKey: ['app-bootstrap'], queryFn: request }))
  return <p>Application loading</p>
}

describe('IP denial page boundary', () => {
  beforeEach(async () => {
    window.history.replaceState({}, '', '/')
    captureIpAccessScope()
    await i18n.use(initReactI18next).init({
      lng: 'en-US',
      fallbackLng: 'en-US',
      defaultNS: 'share',
      keySeparator: false,
      interpolation: { escapeValue: false },
      resources: { 'en-US': { share: enShare } },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['/chat/app', '/environment/workflow/app', '/form/token'])(
    'replaces %s and stops query retries after the first IP rejection',
    async (path) => {
      vi.useFakeTimers()
      window.history.replaceState({}, '', path)
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: 3, retryDelay: 100 } },
      })
      const request = vi.fn(async () => {
        const scope = captureIpAccessScope()
        const error = new Response('', { status: 403 })
        handleIpAccessDenied(
          403,
          { code: 'ip_access_denied', client_ip: '203.0.113.42' },
          scope,
          error,
        )
        throw error
      })
      render(
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <IpAccessBoundary>
              <AppBootstrap request={request} />
            </IpAccessBoundary>
          </QueryClientProvider>
        </I18nextProvider>,
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(request).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('heading', { name: 'Access restricted' })).toBeInTheDocument()
      expect(screen.queryByText('Application loading')).not.toBeInTheDocument()
      expect(screen.getByText('203.0.113.42', { selector: 'code' })).toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })
      expect(request).toHaveBeenCalledTimes(1)
      queryClient.clear()
    },
  )

  it('renders the new app immediately and ignores the old app response after navigation', () => {
    window.history.replaceState({}, '', '/chat/first')
    const previousScope = captureIpAccessScope()
    const contents = (
      <I18nextProvider i18n={i18n}>
        <IpAccessBoundary>
          <p>Current application</p>
        </IpAccessBoundary>
      </I18nextProvider>
    )
    const { rerender } = render(contents)
    act(() => {
      handleIpAccessDenied(403, { code: 'ip_access_denied' }, previousScope)
    })
    expect(screen.getByRole('heading', { name: 'Access restricted' })).toBeInTheDocument()

    window.history.replaceState({}, '', '/agent/second')
    rerender(
      <I18nextProvider i18n={i18n}>
        <IpAccessBoundary>
          <p>Current application</p>
        </IpAccessBoundary>
      </I18nextProvider>,
    )
    act(() => {
      handleIpAccessDenied(403, { code: 'ip_access_denied' }, previousScope)
    })
    expect(screen.getByText('Current application')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Access restricted' })).not.toBeInTheDocument()
  })

  it('starts a new visit after leaving for a console page with no public requests', () => {
    window.history.replaceState({}, '', '/chat/app')
    const previousScope = captureIpAccessScope()
    const application = (
      <I18nextProvider i18n={i18n}>
        <IpAccessBoundary>
          <p>Current application</p>
        </IpAccessBoundary>
      </I18nextProvider>
    )
    const { rerender } = render(application)
    act(() => {
      handleIpAccessDenied(403, { code: 'ip_access_denied' }, previousScope)
    })
    expect(screen.getByRole('heading', { name: 'Access restricted' })).toBeInTheDocument()

    window.history.replaceState({}, '', '/apps')
    rerender(
      <I18nextProvider i18n={i18n}>
        <IpAccessBoundary>
          <p>Console</p>
        </IpAccessBoundary>
      </I18nextProvider>,
    )
    expect(screen.getByText('Console')).toBeInTheDocument()

    window.history.replaceState({}, '', '/chat/app')
    rerender(application)
    const currentScope = captureIpAccessScope()
    expect(currentScope?.key).toBe(previousScope?.key)
    expect(currentScope?.epoch).not.toBe(previousScope?.epoch)
    act(() => {
      handleIpAccessDenied(403, { code: 'ip_access_denied' }, previousScope)
    })
    expect(screen.getByText('Current application')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Access restricted' })).not.toBeInTheDocument()

    act(() => {
      handleIpAccessDenied(403, { code: 'ip_access_denied' }, currentScope)
    })
    expect(screen.getByRole('heading', { name: 'Access restricted' })).toBeInTheDocument()
  })

  it('preserves a bootstrap rejection when Strict Mode replays effects', async () => {
    window.history.replaceState({}, '', '/chat/app')
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const request = vi.fn(async () => {
      const scope = captureIpAccessScope()
      const error = new Response('', { status: 403 })
      handleIpAccessDenied(
        403,
        { code: 'ip_access_denied', client_ip: '203.0.113.42' },
        scope,
        error,
      )
      throw error
    })
    render(
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <IpAccessBoundary>
              <AppBootstrap request={request} />
            </IpAccessBoundary>
          </QueryClientProvider>
        </I18nextProvider>
      </StrictMode>,
    )

    expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeInTheDocument()
    expect(screen.queryByText('Application loading')).not.toBeInTheDocument()
    expect(screen.getByText('203.0.113.42', { selector: 'code' })).toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)
    queryClient.clear()
  })
})
