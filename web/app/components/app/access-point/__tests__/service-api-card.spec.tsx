import type { ReactElement } from 'react'
import type { AccessPointAppInfo } from '../shared/utils'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { AppModeEnum } from '@/types/app'
import { ServiceApiAccessPointCard } from '../built-in-access-points/service-api-card'

const mocks = vi.hoisted(() => ({
  apiSecretKeyButtonProps: vi.fn(),
  toastError: vi.fn(),
  updateApiStatus: vi.fn().mockResolvedValue({}),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: mocks.toastError,
  },
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      byAppId: {
        apiEnable: {
          post: {
            mutationOptions: (options = {}) => ({
              mutationFn: mocks.updateApiStatus,
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

function renderWithQueryClient(ui: ReactElement) {
  return render(ui, { wrapper: createQueryClientWrapper(createTestQueryClient()) })
}

describe('ServiceApiAccessPointCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    [AppModeEnum.ADVANCED_CHAT, '/api-reference/guides/chatflow'],
    [AppModeEnum.WORKFLOW, '/api-reference/guides/workflow'],
    [AppModeEnum.CHAT, '/api-reference/guides/chat'],
    [AppModeEnum.AGENT_CHAT, '/api-reference/guides/chat'],
    [AppModeEnum.COMPLETION, '/api-reference/guides/completion'],
  ])('links %s apps to the matching external API reference', (mode, path) => {
    renderWithQueryClient(
      <ServiceApiAccessPointCard
        appInfo={createAppInfo(mode)}
        availability="available"
        canManage
        onAppStateChanged={vi.fn()}
      />,
    )

    const apiReferenceLink = screen.getByRole('link', { name: /apiInfo\.doc/ })

    expect(apiReferenceLink).toHaveAttribute('href', `https://docs.example.test/en${path}`)
    expect(apiReferenceLink).toHaveAttribute('target', '_blank')
    expect(apiReferenceLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('updates API status through the generated contract', async () => {
    const user = userEvent.setup()
    const onAppStateChanged = vi.fn()
    renderWithQueryClient(
      <ServiceApiAccessPointCard
        appInfo={createAppInfo(AppModeEnum.WORKFLOW)}
        availability="available"
        canManage
        onAppStateChanged={onAppStateChanged}
      />,
    )

    await user.click(screen.getByRole('switch'))

    await waitFor(() => {
      expect(mocks.updateApiStatus.mock.calls[0]?.[0]).toEqual({
        params: { app_id: 'app-1' },
        body: { enable_api: false },
      })
      expect(onAppStateChanged).toHaveBeenCalledTimes(1)
    })
  })

  it('shows loading without reporting an environment failure', () => {
    renderWithQueryClient(
      <ServiceApiAccessPointCard
        appInfo={createAppInfo(AppModeEnum.WORKFLOW)}
        availability="loading"
        canManage
        onAppStateChanged={vi.fn()}
      />,
    )

    const card = screen.getByRole('region', { name: /serviceApi\.title/ })
    expect(card).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('common.loading')).toBeInTheDocument()
    expect(
      screen.queryByText('deployments.health.ENVIRONMENT_STATUS_FAILED'),
    ).not.toBeInTheDocument()
  })

  it('keeps API keys and external documentation available when the API is stopped', () => {
    renderWithQueryClient(
      <ServiceApiAccessPointCard
        appInfo={createAppInfo(AppModeEnum.WORKFLOW, { enable_api: false })}
        availability="available"
        canManage
        onAppStateChanged={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'api-secret-keys' })).toBeEnabled()
    const apiReferenceLink = screen.getByRole('link', { name: /apiInfo\.doc/ })
    expect(apiReferenceLink).toHaveAttribute(
      'href',
      'https://docs.example.test/en/api-reference/guides/workflow',
    )
  })

  it('disables API management without release permission', () => {
    renderWithQueryClient(
      <ServiceApiAccessPointCard
        appInfo={createAppInfo(AppModeEnum.WORKFLOW)}
        availability="available"
        canManage={false}
        onAppStateChanged={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'api-secret-keys' })).toBeDisabled()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
  })

  it('disables API keys and external documentation when the access point is unavailable', () => {
    renderWithQueryClient(
      <ServiceApiAccessPointCard
        appInfo={createAppInfo(AppModeEnum.WORKFLOW)}
        availability="unavailable"
        canManage
        onAppStateChanged={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'api-secret-keys' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /apiInfo\.doc/ })).toBeDisabled()
  })
})
