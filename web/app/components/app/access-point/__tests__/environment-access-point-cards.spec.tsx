import type { ReactElement } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { EnvironmentServiceApiCard } from '../environment-service-api-card'
import { EnvironmentWebAppCard } from '../environment-web-app-card'

const mocks = vi.hoisted(() => ({
  getApi: vi.fn(),
  getSite: vi.fn(),
  getSubjects: vi.fn(),
  resetSite: vi.fn(),
  updateAccessMode: vi.fn(),
  updateApi: vi.fn(),
  updateSite: vi.fn(),
  accessControlProps: vi.fn(),
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
          updateEnvironmentWebAppAccessMode: {
            mutationOptions: (options = {}) => ({
              mutationFn: mocks.updateAccessMode,
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

vi.mock('@/app/components/app/access-point/use-built-in-actions', () => ({
  useBuiltInAccessPointActions: () => ({
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

vi.mock('@/app/components/app/app-access-control', () => ({
  default: (props: {
    adapter: {
      supportedModes: string[]
      subjectsQuery: {
        data?: {
          groups: Array<{ id: string }>
          members: Array<{ email: string; id: string; name: string }>
        }
      }
      updateAccessMode: (input: {
        accessMode: string
        subjects: Array<{ subjectId: string; subjectType: string }>
      }) => Promise<void>
    }
    app: { access_mode: string; id: string }
  }) => {
    mocks.accessControlProps(props)
    return (
      <div role="dialog" aria-label="environment access mode">
        <button
          type="button"
          onClick={() =>
            void props.adapter.updateAccessMode({
              accessMode: 'private',
              subjects: [
                {
                  subjectId: 'account-2',
                  subjectType: 'account',
                },
              ],
            })
          }
        >
          save-specific-access
        </button>
      </div>
    )
  },
}))

vi.mock('@/app/components/app/access-point/api-secret-key-button', () => ({
  ApiSecretKeyButton: (props: {
    apiKeyCount?: number
    appId: string
    canManage: boolean
    disabled?: boolean
    environmentId?: string
  }) => {
    mocks.apiKeyButtonProps(props)
    return <button type="button">environment-api-keys</button>
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
    mocks.updateAccessMode.mockResolvedValue(site)
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

    expect(await screen.findByText(/workflow\/site-code/)).toHaveTextContent(
      'https://site.example.test/workflow/site-code',
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

  it('uses environment Site mutations for status, URL reset, and access mode', async () => {
    const user = userEvent.setup()
    renderCard(<EnvironmentWebAppCard appId="app-1" environmentId="staging" canEdit canManage />)

    const accessModeButton = await screen.findByRole('button', {
      name: /accessControlDialog\.accessItems\.specific/,
    })
    await user.click(accessModeButton)
    await waitFor(() => {
      expect(mocks.accessControlProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          app: {
            access_mode: 'private',
            id: 'app-1',
          },
          adapter: expect.objectContaining({
            subjectsQuery: {
              data: {
                groups: [],
                members: [
                  {
                    avatar: '',
                    avatarUrl: '',
                    email: 'ada@example.com',
                    id: 'account-1',
                    name: 'Ada',
                  },
                ],
              },
              isPending: false,
            },
            supportedModes: ['private_all', 'private', 'public'],
          }),
        }),
      )
    })
    await user.click(screen.getByRole('button', { name: 'save-specific-access' }))

    await waitFor(() => {
      expect(mocks.updateAccessMode.mock.calls[0]?.[0]).toEqual({
        body: {
          access_mode: 'private',
          subjects: [
            {
              subject_id: 'account-2',
              subject_type: 'account',
            },
          ],
        },
        params: environmentParams,
      })
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

    await screen.findByText(/workflow\/site-code/)
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
        disabled: false,
        environmentId: 'staging',
      }),
    )
    expect(screen.getByRole('button', { name: 'environment-api-keys' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /apiInfo\.doc/ })).toHaveAttribute(
      'href',
      '/app/app-1/develop',
    )

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
})
