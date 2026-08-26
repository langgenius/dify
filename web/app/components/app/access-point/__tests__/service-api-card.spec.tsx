import type { AccessPointAppInfo } from '../shared/utils'
import { toast } from '@langgenius/dify-ui/toast'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore as useAppStore } from '@/app/components/app/store'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { AppModeEnum } from '@/types/app'
import { ServiceApiAccessPointCard } from '../built-in-access-points/service-api-card'

const mocks = vi.hoisted(() => ({
  apiSecretKeyButtonProps: vi.fn(),
  apiEnable: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      byAppId: {
        apiEnable: {
          post: {
            mutationOptions: (options = {}) => ({
              mutationFn: mocks.apiEnable,
              ...options,
            }),
          },
        },
      },
    },
  },
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.test/en${path}`,
}))

vi.mock('../shared/api-secret-key-button', () => ({
  ApiSecretKeyButton: (props: { canManage: boolean; disabled?: boolean }) => {
    mocks.apiSecretKeyButtonProps(props)
    return (
      <button type="button" disabled={!props.canManage || props.disabled}>
        api-secret-keys
      </button>
    )
  },
}))

function createAppInfo(
  mode: AppModeEnum,
  overrides: Partial<AccessPointAppInfo> = {},
): AccessPointAppInfo {
  return {
    api_base_url: 'https://api.example.test/v1',
    enable_api: true,
    id: 'app-1',
    mode,
    ...overrides,
  } as AccessPointAppInfo
}

function renderCard(
  mode: AppModeEnum,
  availability: 'available' | 'loading' | 'unavailable' = 'available',
  canManage = true,
  overrides: Partial<AccessPointAppInfo> = {},
) {
  useAppStore.setState({ appDetail: createAppInfo(mode, overrides) })
  const queryClient = createTestQueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <StoreConnectedServiceApiCard availability={availability} canManage={canManage} />
    </QueryClientProvider>,
  )
}

function StoreConnectedServiceApiCard({
  availability,
  canManage,
}: {
  availability: 'available' | 'loading' | 'unavailable'
  canManage: boolean
}) {
  const appInfo = useAppStore((state) => state.appDetail)
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
    vi.clearAllMocks()
    mocks.apiEnable.mockResolvedValue({
      enable_api: true,
    })
  })

  it.each([
    [AppModeEnum.ADVANCED_CHAT, '/api-reference/guides/chatflow'],
    [AppModeEnum.WORKFLOW, '/api-reference/guides/workflow'],
    [AppModeEnum.CHAT, '/api-reference/guides/chat'],
    [AppModeEnum.AGENT_CHAT, '/api-reference/guides/chat'],
    [AppModeEnum.COMPLETION, '/api-reference/guides/completion'],
  ])('links %s apps to the matching external API reference', (mode, path) => {
    renderCard(mode)

    const apiReferenceLink = screen.getByRole('button', { name: /apiInfo\.doc/ })

    expect(apiReferenceLink).toHaveAttribute('href', `https://docs.example.test/en${path}`)
    expect(apiReferenceLink).toHaveAttribute('target', '_blank')
    expect(apiReferenceLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows loading without reporting an environment failure', () => {
    renderCard(AppModeEnum.WORKFLOW, 'loading')

    const card = screen.getByRole('region', { name: /serviceApi\.title/ })
    expect(card).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('common.loading')).toBeInTheDocument()
    expect(
      screen.queryByText('deployments.health.ENVIRONMENT_STATUS_FAILED'),
    ).not.toBeInTheDocument()
  })

  it('keeps API keys and external documentation available when the API is stopped', () => {
    renderCard(AppModeEnum.WORKFLOW, 'available', true, { enable_api: false })

    expect(screen.getByRole('button', { name: 'api-secret-keys' })).toBeEnabled()
    const apiReferenceLink = screen.getByRole('button', { name: /apiInfo\.doc/ })
    expect(apiReferenceLink).not.toHaveAttribute('aria-disabled')
    expect(apiReferenceLink).toHaveAttribute(
      'href',
      'https://docs.example.test/en/api-reference/guides/workflow',
    )
  })

  it('disables API management without release permission', () => {
    renderCard(AppModeEnum.WORKFLOW, 'available', false)

    expect(screen.getByRole('button', { name: 'api-secret-keys' })).toBeDisabled()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
  })

  it('disables API keys and external documentation when the access point is unavailable', () => {
    renderCard(AppModeEnum.WORKFLOW, 'unavailable')

    expect(screen.getByRole('button', { name: 'api-secret-keys' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /apiInfo\.doc/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('rolls back a failed status change and shows only an error toast', async () => {
    const user = userEvent.setup()
    const toggle = createDeferredPromise<{ enable_api: boolean }>()
    mocks.apiEnable.mockReturnValueOnce(toggle.promise)
    renderCard(AppModeEnum.WORKFLOW)

    const accessSwitch = screen.getByRole('switch')
    await user.click(accessSwitch)

    expect(accessSwitch).toHaveAttribute('aria-checked', 'false')

    toggle.reject(new Error('request failed'))

    await waitFor(() => {
      expect(accessSwitch).toHaveAttribute('aria-checked', 'true')
    })
    expect(toast.error).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('keeps successful status changes silent', async () => {
    const user = userEvent.setup()
    mocks.apiEnable.mockResolvedValueOnce({ enable_api: false })
    renderCard(AppModeEnum.WORKFLOW)

    const accessSwitch = screen.getByRole('switch')
    await user.click(accessSwitch)

    await waitFor(() => {
      expect(useAppStore.getState().appDetail?.enable_api).toBe(false)
    })
    expect(accessSwitch).toHaveAttribute('aria-checked', 'false')
    expect(toast.success).not.toHaveBeenCalled()
  })
})
