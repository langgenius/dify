import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { seedSystemFeatures } from '@/test/console/query-data'
import { OpenApiConsent } from '../components/openapi-consent'

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/service/base', () => ({
  request: async (url: string) => {
    if (url.endsWith('/account/profile')) {
      return new Response(
        JSON.stringify({ avatar_url: null, email: 'user@example.com', name: 'Test User' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    throw new Error(`Unexpected request: ${url}`)
  },
  post: vi.fn(),
  sseGeneratorPost: vi.fn(),
}))

const client = {
  client_id: 'openapi-client',
  display_name: 'Local CLI',
  logo_uri: null,
  redirect_host: '127.0.0.1',
  localhost_only: true,
}

function renderConsent(params: Record<string, string>, view = client) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  seedSystemFeatures(queryClient)
  return render(
    <QueryClientProvider client={queryClient}>
      <OpenApiConsent client={view} searchParams={new URLSearchParams(params)} />
    </QueryClientProvider>,
  )
}

describe('OpenApiConsent', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockImplementation(async (url: string) => {
      const decision = String(url).split('/').pop()
      return new Response(
        JSON.stringify({ redirect_to: `http://127.0.0.1:8123/callback?result=${decision}` }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('location', {
      href: 'https://dify.test/account/oauth/authorize',
      origin: 'https://dify.test',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the client, redirect host, localhost warning and signed-in account', async () => {
    renderConsent({})

    expect(await screen.findByText('Local CLI')).toBeInTheDocument()
    expect(screen.getByText('user@example.com')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('oauth.openapi.localhostWarning')
  })

  it('omits the localhost warning for a regular client', async () => {
    renderConsent({}, { ...client, localhost_only: false, redirect_host: 'app.example.com' })

    await screen.findByText('Local CLI')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('always says the app is not verified', async () => {
    renderConsent({})

    expect(await screen.findByText('oauth.openapi.unverified')).toBeInTheDocument()
  })

  it('shows who published the details for an https client_id', async () => {
    renderConsent({}, { ...client, client_id: 'https://app.example.com/oauth/client.json' })

    expect(
      await screen.findByText(/oauth\.openapi\.detailsFrom.*app\.example\.com/),
    ).toBeInTheDocument()
  })

  it('shows no details line for a dcr_ client_id', async () => {
    renderConsent({}, { ...client, client_id: 'dcr_abc123' })

    await screen.findByText('Local CLI')
    expect(screen.queryByText(/oauth\.openapi\.detailsFrom/)).not.toBeInTheDocument()
  })

  it('shows no details line and does not crash for a malformed URL-like client_id', async () => {
    renderConsent({}, { ...client, client_id: 'https://' })

    expect(await screen.findByText('oauth.openapi.unverified')).toBeInTheDocument()
    expect(screen.queryByText(/oauth\.openapi\.detailsFrom/)).not.toBeInTheDocument()
  })

  it('shows no details line for a non-https URL client_id', async () => {
    renderConsent({}, { ...client, client_id: 'http://app.example.com/client.json' })

    await screen.findByText('Local CLI')
    expect(screen.queryByText(/oauth\.openapi\.detailsFrom/)).not.toBeInTheDocument()
  })

  it('approves with the PKCE request and navigates to redirect_to', async () => {
    const user = userEvent.setup()
    renderConsent({
      redirect_uri: 'http://127.0.0.1:8123/callback',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
      state: 'state-1',
    })

    await user.click(await screen.findByRole('button', { name: 'oauth.openapi.authorize' }))

    await waitFor(() =>
      expect(globalThis.location.href).toBe('http://127.0.0.1:8123/callback?result=approve'),
    )
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/openapi/v1/oauth/authorize/approve')
    expect(JSON.parse(init.body)).toEqual({
      client_id: 'openapi-client',
      redirect_uri: 'http://127.0.0.1:8123/callback',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
      resource: null,
      scope: null,
      state: 'state-1',
    })
  })

  it('calls deny on cancel and navigates to its redirect_to', async () => {
    const user = userEvent.setup()
    renderConsent({ redirect_uri: 'http://127.0.0.1:8123/callback' })

    await user.click(await screen.findByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() =>
      expect(globalThis.location.href).toBe('http://127.0.0.1:8123/callback?result=deny'),
    )
    expect(fetchMock.mock.calls[0]![0]).toBe('/openapi/v1/oauth/authorize/deny')
  })

  it('stays on the page when approve fails', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400 }),
    )
    renderConsent({})

    await user.click(await screen.findByRole('button', { name: 'oauth.openapi.authorize' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(globalThis.location.href).toBe('https://dify.test/account/oauth/authorize')
  })
})
