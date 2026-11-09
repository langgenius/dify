import type { AppDetailWithSite, AppMode } from '@dify/contracts/api/console/apps/types.gen'
import { QueryClientProvider, useSuspenseQuery } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { render } from '@/test/console/render'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { ServiceApiAccessPointCard } from '../built-in-access-points/service-api-card'

const mocks = vi.hoisted(() => ({
  appInfo: null as AppDetailWithSite | null,
  getAppDetail: vi.fn(),
  apiKeys: vi.fn(),
  apiEnable: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.get': mocks.getAppDetail,
      'apps.byAppId.apiEnable.post': async (input) => {
        const response = await mocks.apiEnable(input)
        mocks.appInfo = { ...mocks.appInfo!, ...response }
        return mocks.appInfo
      },
      'apps.byResourceId.apiKeys.get': mocks.apiKeys,
    }),
  }
})

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.test/en${path}`,
}))

function createAppInfo(
  mode: AppMode,
  overrides: Partial<AppDetailWithSite> = {},
): AppDetailWithSite {
  return createAppDetailFixture({
    api_base_url: 'https://api.example.test/v1',
    enable_api: true,
    id: 'app-1',
    mode,
    ...overrides,
  })
}

function renderCard(
  mode: AppMode,
  availability: 'available' | 'loading' | 'unavailable' = 'available',
  canManage = true,
  overrides: Partial<AppDetailWithSite> = {},
) {
  mocks.appInfo = createAppInfo(mode, overrides)
  const queryClient = createTestQueryClient()
  seedAccountProfileQuery(queryClient)
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
    createAppInfo(mode, overrides),
  )

  return render(
    <QueryClientProvider client={queryClient}>
      <QueryConnectedServiceApiCard availability={availability} canManage={canManage} />
    </QueryClientProvider>,
  )
}

function QueryConnectedServiceApiCard({
  availability,
  canManage,
}: {
  availability: 'available' | 'loading' | 'unavailable'
  canManage: boolean
}) {
  const { data: appInfo } = useSuspenseQuery(
    consoleQuery.apps.byAppId.get.queryOptions({ input: { params: { app_id: 'app-1' } } }),
  )
  if (!appInfo) return null

  return (
    <ServiceApiAccessPointCard
      appInfo={appInfo}
      availability={availability}
      canManage={canManage}
    />
  )
}

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

describe('ServiceApiAccessPointCard', () => {
  beforeEach(() => {
    mocks.getAppDetail.mockImplementation(async () => mocks.appInfo)
    mocks.apiEnable.mockImplementation(async ({ body }) => {
      mocks.appInfo = { ...mocks.appInfo!, ...body }
      return mocks.appInfo
    })
    mocks.apiKeys.mockResolvedValue({
      data: [
        { id: 'key-1', type: 'app', token: 'app-existing-key', last_used_at: null, created_at: 1 },
      ],
    })
  })

  it.each([
    ['advanced-chat', '/api-reference/guides/chatflow'],
    ['workflow', '/api-reference/guides/workflow'],
    ['chat', '/api-reference/guides/chat'],
    ['agent-chat', '/api-reference/guides/chat'],
    ['completion', '/api-reference/guides/completion'],
  ] as const)('links %s apps to the matching external API reference', (mode, path) => {
    renderCard(mode)

    const apiReferenceLink = screen.getByRole('link', { name: /apiInfo\.doc/ })

    expect(apiReferenceLink).toHaveAttribute('href', `https://docs.example.test/en${path}`)
    expect(apiReferenceLink).toHaveAttribute('target', '_blank')
    expect(apiReferenceLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows loading without reporting an environment failure', () => {
    renderCard('workflow', 'loading')

    const card = screen.getByRole('region', { name: /serviceApi\.title/ })
    expect(card).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('common.loading')).toBeInTheDocument()
    expect(
      screen.queryByText('deployments.health.ENVIRONMENT_STATUS_FAILED'),
    ).not.toBeInTheDocument()
  })

  it('keeps API keys and external documentation available when the API is stopped', async () => {
    const user = userEvent.setup()
    renderCard('workflow', 'available', true, { enable_api: false })

    expect(screen.getByRole('button', { name: /apiKeyModal\.apiSecretKey/ })).toBeEnabled()
    const apiReferenceLink = screen.getByRole('link', { name: /apiInfo\.doc/ })
    expect(apiReferenceLink).toHaveAttribute(
      'href',
      'https://docs.example.test/en/api-reference/guides/workflow',
    )
    await user.click(screen.getByRole('button', { name: /apiKeyModal\.apiSecretKey/ }))
    expect(
      await screen.findByRole('dialog', { name: 'appApi.apiKeyModal.apiSecretKey' }),
    ).toBeVisible()
    expect(await screen.findByText('app-e...-key')).toBeVisible()
    expect(mocks.apiKeys).toHaveBeenCalledWith({ params: { resource_id: 'app-1' } })
  })

  it('disables API management without Access Point management permission', () => {
    renderCard('workflow', 'available', false)

    expect(screen.getByRole('button', { name: /apiKeyModal\.apiSecretKey/ })).toBeDisabled()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
  })

  it('disables API keys and external documentation when the access point is unavailable', () => {
    renderCard('workflow', 'unavailable')

    expect(screen.getByRole('button', { name: /apiKeyModal\.apiSecretKey/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /apiInfo\.doc/ })).toBeDisabled()
  })

  it('rolls back a failed status change and shows only an error toast', async () => {
    const user = userEvent.setup()
    const toggle = createDeferredPromise<{ enable_api: boolean }>()
    mocks.apiEnable.mockReturnValueOnce(toggle.promise)
    renderCard('workflow')

    const accessSwitch = screen.getByRole('switch')
    await user.click(accessSwitch)

    expect(accessSwitch).toHaveAttribute('aria-checked', 'false')

    await waitFor(() => {
      expect(mocks.apiEnable).toHaveBeenCalledWith({
        params: { app_id: 'app-1' },
        body: { enable_api: false },
      })
    })

    toggle.reject(new Error('request failed'))

    await waitFor(() => {
      expect(accessSwitch).toHaveAttribute('aria-checked', 'true')
    })
    expect(toast.error).toHaveBeenCalledWith('request failed')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('keeps successful status changes silent', async () => {
    const user = userEvent.setup()
    mocks.apiEnable.mockResolvedValueOnce(createAppDetailFixture({ enable_api: false }))
    renderCard('workflow')

    const accessSwitch = screen.getByRole('switch')
    await user.click(accessSwitch)

    await waitFor(() => {
      expect(screen.getByRole('switch')).not.toBeChecked()
    })
    expect(mocks.apiEnable).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
      body: { enable_api: false },
    })
    expect(accessSwitch).toHaveAttribute('aria-checked', 'false')
    expect(toast.success).not.toHaveBeenCalled()
  })
})
