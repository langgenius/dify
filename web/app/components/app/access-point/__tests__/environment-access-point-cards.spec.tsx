import type { ReactElement } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { EnvironmentServiceApiCard } from '../deployed-environment-access-points/environment-service-api-card'
import { EnvironmentWebAppCard } from '../deployed-environment-access-points/environment-web-app-card'

const mocks = vi.hoisted(() => ({
  getApi: vi.fn(),
  getSite: vi.fn(),
  getSubjects: vi.fn(),
  resetSite: vi.fn(),
  updateApi: vi.fn(),
  updateSite: vi.fn(),
  environmentAccessControlProps: vi.fn(),
  apiKeyButtonProps: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      appDeploy: {
        accessService: {
          getEnvironmentApi: {
            queryOptions: ({
              input,
            }: {
              input: { params: { app_id: string; environment_id: string } }
            }) => ({
              queryKey: ['environment-api', input.params.app_id, input.params.environment_id],
              queryFn: () => mocks.getApi(input),
            }),
          },
          getEnvironmentSite: {
            queryOptions: ({
              input,
            }: {
              input: { params: { app_id: string; environment_id: string } }
            }) => ({
              queryKey: ['environment-site', input.params.app_id, input.params.environment_id],
              queryFn: () => mocks.getSite(input),
            }),
          },
          getEnvironmentWebAppSubjects: {
            queryOptions: ({
              input,
            }: {
              input: { params: { app_id: string; environment_id: string } }
            }) => ({
              queryKey: ['environment-subjects', input.params.app_id, input.params.environment_id],
              queryFn: () => mocks.getSubjects(input),
            }),
          },
          resetEnvironmentSiteAccessToken: {
            mutationOptions: (options = {}) => ({
              mutationFn: mocks.resetSite,
              ...options,
            }),
          },
          updateEnvironmentApi: {
            mutationOptions: (options = {}) => ({
              mutationFn: mocks.updateApi,
              ...options,
            }),
          },
          updateEnvironmentSite: {
            mutationOptions: (options = {}) => ({
              mutationFn: mocks.updateSite,
              ...options,
            }),
          },
        },
      },
    },
  },
}))

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['system-features'],
    queryFn: vi.fn(),
  }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.test/en${path}`,
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      appDetail: {
        id: 'app-1',
        icon: '🤖',
        icon_background: '#FFEAD5',
        icon_type: 'emoji',
        icon_url: null,
        mode: 'workflow',
        site: {
          access_token: 'built-in-code',
          app_base_url: 'https://built-in.example.test',
        },
      },
    }),
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => <div aria-label="app-icon" />,
}))

vi.mock('@/app/components/app/access-point/shared/use-access-point-actions', () => ({
  useAccessPointActions: () => ({
    saveSiteConfig: vi.fn(),
  }),
}))

vi.mock('@/app/components/app/overview/customize', () => ({
  default: ({ api_base_url, isShow }: { api_base_url: string; isShow: boolean }) =>
    isShow ? (
      <div role="dialog" aria-label="environment customize">
        {api_base_url}
      </div>
    ) : null,
}))

vi.mock('@/app/components/app/overview/settings', () => ({
  default: ({ isShow }: { isShow: boolean }) =>
    isShow ? <div role="dialog" aria-label="environment settings" /> : null,
}))

vi.mock('../deployed-environment-access-points/environment-access-control', () => ({
  EnvironmentAccessControl: (props: {
    appId: string
    environmentId: string
    accessMode: string
    canManage: boolean
  }) => {
    mocks.environmentAccessControlProps(props)
    return <div role="dialog" aria-label="environment access mode" />
  },
}))

vi.mock('@/app/components/app/access-point/shared/api-secret-key-button', () => ({
  ApiSecretKeyButton: (props: {
    apiKeyCount?: number
    appId: string
    canManage: boolean
    disabled?: boolean
    environmentId?: string
  }) => {
    mocks.apiKeyButtonProps(props)
    return (
      <button type="button" disabled={!props.canManage || props.disabled}>
        environment-api-keys
      </button>
    )
  },
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const environmentParams = {
  app_id: 'app-1',
  environment_id: 'staging',
}

const site = {
  access_mode: 'private',
  app_base_url: 'https://site.example.test',
  code: 'site-code',
  enabled: true,
}

const api = {
  api_key_count: 3,
  base_url: 'https://api.example.test/v1',
  enabled: true,
}

function renderCard(ui: ReactElement) {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(['system-features'], {
    webapp_auth: {
      enabled: true,
    },
  })

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('environment access point cards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getApi.mockResolvedValue(api)
    mocks.getSite.mockResolvedValue(site)
    mocks.getSubjects.mockResolvedValue({
      subjects: [
        {
          account_data: {
            email: 'ada@example.com',
            id: 'account-1',
            name: 'Ada',
          },
          subject_id: 'account-1',
          subject_type: 'account',
        },
      ],
    })
    mocks.resetSite.mockResolvedValue({
      ...site,
      code: 'regenerated-code',
    })
    mocks.updateApi.mockResolvedValue({
      ...api,
      enabled: false,
    })
    mocks.updateSite.mockResolvedValue({
      ...site,
      enabled: false,
    })
  })

  it('renders the real environment Web app URL and workflow actions without Embed', async () => {
    renderCard(<EnvironmentWebAppCard appId="app-1" environmentId="staging" canEdit canManage />)

    expect(await screen.findByText(/env\/workflow\/site-code/)).toHaveTextContent(
      'https://site.example.test/env/workflow/site-code',
    )
    expect(
      await screen.findByRole('button', {
        name: /accessControlDialog\.accessItems\.specific/,
      }),
    ).toBeEnabled()
    expect(screen.queryByRole('button', { name: /embedIntoSite/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /customize\.entry/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /settings\.settings/ })).toBeEnabled()
  })

  it('renders authenticated external users as the environment Web app access mode', async () => {
    mocks.getSite.mockResolvedValue({
      ...site,
      access_mode: 'sso_verified',
    })

    renderCard(<EnvironmentWebAppCard appId="app-1" environmentId="staging" canEdit canManage />)

    expect(
      await screen.findByRole('button', {
        name: /accessControlDialog\.accessItems\.external/,
      }),
    ).toBeEnabled()
  })

  it('shows the environment Web app query as loading instead of failed', () => {
    mocks.getSite.mockImplementation(() => new Promise(() => {}))

    renderCard(<EnvironmentWebAppCard appId="app-1" environmentId="staging" canEdit canManage />)

    const card = screen.getByRole('region', { name: /webApp\.title/ })
    expect(card).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('common.loading')).toBeInTheDocument()
    expect(
      screen.queryByText('deployments.health.ENVIRONMENT_STATUS_FAILED'),
    ).not.toBeInTheDocument()
  })

  it('uses environment Site mutations for status and URL reset, and opens its access container', async () => {
    const user = userEvent.setup()
    renderCard(<EnvironmentWebAppCard appId="app-1" environmentId="staging" canEdit canManage />)

    const accessModeButton = await screen.findByRole('button', {
      name: /accessControlDialog\.accessItems\.specific/,
    })
    await user.click(accessModeButton)
    await waitFor(() => {
      expect(mocks.environmentAccessControlProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          appId: 'app-1',
          environmentId: 'staging',
          accessMode: 'private',
          canManage: true,
        }),
      )
    })

    await user.click(screen.getByRole('button', { name: /regenerate/ }))
    await user.click(screen.getByRole('button', { name: /operation\.confirm/ }))

    await waitFor(() => {
      expect(mocks.resetSite.mock.calls[0]?.[0]).toEqual({
        params: environmentParams,
      })
    })

    await user.click(screen.getByRole('switch'))

    await waitFor(() => {
      expect(mocks.updateSite.mock.calls[0]?.[0]).toEqual({
        body: {
          enabled: false,
        },
        params: environmentParams,
      })
    })
  })

  it('opens Customize and Settings with environment endpoint data', async () => {
    const user = userEvent.setup()
    renderCard(<EnvironmentWebAppCard appId="app-1" environmentId="staging" canEdit canManage />)

    await screen.findByText(/env\/workflow\/site-code/)
    await user.click(screen.getByRole('button', { name: /customize\.entry/ }))
    expect(screen.getByRole('dialog', { name: 'environment customize' })).toHaveTextContent(
      'https://api.example.test/v1',
    )

    await user.click(screen.getByRole('button', { name: /settings\.settings/ }))
    expect(screen.getByRole('dialog', { name: 'environment settings' })).toBeInTheDocument()
  })

  it('renders the real Service API endpoint, environment keys entry, docs entry, and API toggle', async () => {
    const user = userEvent.setup()
    renderCard(<EnvironmentServiceApiCard appId="app-1" environmentId="staging" canManage />)

    expect(await screen.findByText(api.base_url)).toBeInTheDocument()
    expect(mocks.apiKeyButtonProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apiKeyCount: 3,
        appId: 'app-1',
        canManage: true,
        environmentId: 'staging',
      }),
    )
    expect(screen.getByRole('button', { name: 'environment-api-keys' })).toBeInTheDocument()
    const apiReferenceLink = screen.getByRole('button', { name: /apiInfo\.doc/ })
    expect(apiReferenceLink).toHaveAttribute(
      'href',
      'https://docs.example.test/en/api-reference/guides/workflow',
    )
    expect(apiReferenceLink).toHaveAttribute('target', '_blank')
    expect(apiReferenceLink).toHaveAttribute('rel', 'noopener noreferrer')

    await user.click(screen.getByRole('switch'))

    await waitFor(() => {
      expect(mocks.updateApi.mock.calls[0]?.[0]).toEqual({
        body: {
          enabled: false,
        },
        params: environmentParams,
      })
    })
  })

  it('keeps environment API keys and external documentation available when the API is stopped', async () => {
    mocks.getApi.mockResolvedValue({
      ...api,
      enabled: false,
    })

    renderCard(<EnvironmentServiceApiCard appId="app-1" environmentId="staging" canManage />)

    await screen.findByText(api.base_url)
    expect(await screen.findByRole('button', { name: 'environment-api-keys' })).toBeEnabled()
    const apiReferenceLink = screen.getByRole('button', { name: /apiInfo\.doc/ })
    expect(apiReferenceLink).not.toHaveAttribute('aria-disabled')
    expect(apiReferenceLink).toHaveAttribute(
      'href',
      'https://docs.example.test/en/api-reference/guides/workflow',
    )
  })

  it('distinguishes the Service API loading and failed query states', async () => {
    mocks.getApi.mockRejectedValue(new Error('API unavailable'))

    renderCard(<EnvironmentServiceApiCard appId="app-1" environmentId="staging" canManage />)

    const card = screen.getByRole('region', { name: /serviceApi\.title/ })
    expect(card).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('common.loading')).toBeInTheDocument()
    expect(
      screen.queryByText('deployments.health.ENVIRONMENT_STATUS_FAILED'),
    ).not.toBeInTheDocument()

    expect(await screen.findAllByText('deployments.health.ENVIRONMENT_STATUS_FAILED')).toHaveLength(
      2,
    )
    expect(card).not.toHaveAttribute('aria-busy')
    expect(screen.queryByText('common.loading')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'environment-api-keys' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /apiInfo\.doc/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})
