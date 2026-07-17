import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OAuthAuthorize from '../page'

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  push: vi.fn(),
  request: vi.fn(),
  searchParams: new URLSearchParams(),
  toastError: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: mocks.toastError,
  },
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div role="status">Loading</div>,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/features/account-profile/client', () => ({
  isLegacyBase401: () => false,
  userProfileQueryOptions: () => ({
    queryKey: ['account-profile'],
    queryFn: async () => ({
      profile: {
        avatar_url: null,
        email: 'user@example.com',
        name: 'Test User',
      },
    }),
  }),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => mocks.searchParams,
}))

vi.mock('@/service/base', () => ({
  request: (...args: unknown[]) => mocks.request(...args),
  sseGeneratorPost: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useLogout: () => ({ mutateAsync: mocks.logout }),
}))

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <OAuthAuthorize />
    </QueryClientProvider>,
  )
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function findRequest(path: string) {
  return mocks.request.mock.calls.find(([url]) => String(url).endsWith(path))
}

describe('OAuthAuthorize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.searchParams = new URLSearchParams()
    mocks.logout.mockResolvedValue(undefined)
    mocks.request.mockImplementation(async (url: string) => {
      if (url.endsWith('/oauth/provider/authorize')) return jsonResponse({ code: 'oauth-code' })
      if (url.endsWith('/oauth/provider')) {
        return jsonResponse({
          app_icon: '',
          app_label: { en_US: 'Test OAuth App' },
          scope: '',
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('location', {
      href: 'https://dify.test/account/oauth/authorize',
      origin: 'https://dify.test',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not request provider information and disables authorization without OAuth params', async () => {
    renderPage()

    const continueButton = await screen.findByRole('button', { name: /continue/i })

    expect(continueButton).toBeDisabled()
    expect(findRequest('/oauth/provider')).toBeUndefined()
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled())
  })

  it('authorizes the displayed app and redirects with the returned code', async () => {
    const user = userEvent.setup()
    mocks.searchParams = new URLSearchParams({
      client_id: 'client-1',
      redirect_uri: 'https://client.example.com/callback?state=state-1',
    })
    renderPage()

    expect((await screen.findAllByText('Test OAuth App')).length).toBeGreaterThan(0)

    const providerRequest = findRequest('/oauth/provider')
    const providerTransportRequest = providerRequest?.[2]?.request as Request
    expect(providerTransportRequest).toEqual(
      expect.objectContaining({
        method: 'POST',
      }),
    )
    await expect(providerTransportRequest.clone().json()).resolves.toEqual({
      client_id: 'client-1',
      redirect_uri: 'https://client.example.com/callback?state=state-1',
    })
    expect(providerRequest?.[2]).toEqual(expect.objectContaining({ silent: true }))

    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(findRequest('/oauth/provider/authorize')).toBeDefined())
    const authorizeRequest = findRequest('/oauth/provider/authorize')
    const authorizeTransportRequest = authorizeRequest?.[2]?.request as Request
    expect(authorizeTransportRequest).toEqual(
      expect.objectContaining({
        method: 'POST',
      }),
    )
    await expect(authorizeTransportRequest.clone().json()).resolves.toEqual({
      client_id: 'client-1',
    })
    await waitFor(() =>
      expect(globalThis.location.href).toBe(
        'https://client.example.com/callback?state=state-1&code=oauth-code',
      ),
    )
  })
})
