import type { AccessPointAppInfo, PublishedWorkflow } from '../shared/utils'
import type { InputVar, Node } from '@/app/components/workflow/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { AccessMode } from '@/models/access-control'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'
import { WebAppAccessPointCard } from '../built-in-access-points/web-app-card'

const mocks = vi.hoisted(() => ({
  resetSiteAccessToken: vi.fn().mockResolvedValue({}),
  toastError: vi.fn(),
  updateSiteStatus: vi.fn().mockResolvedValue({}),
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
        siteEnable: {
          post: {
            mutationOptions: (options = {}) => ({
              mutationFn: mocks.updateSiteStatus,
              ...options,
            }),
          },
        },
        site: {
          accessTokenReset: {
            post: {
              mutationOptions: (options = {}) => ({
                mutationFn: mocks.resetSiteAccessToken,
                ...options,
              }),
            },
          },
        },
      },
    },
  },
}))

vi.mock('@/service/access-control/use-app-access-control', () => ({
  useAppWhiteListSubjects: () => ({
    data: undefined,
  }),
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => <div aria-label="app-icon" />,
}))

vi.mock('@/app/components/app/app-access-control', () => ({
  default: () => null,
}))

vi.mock('@/app/components/app/overview/customize', () => ({
  default: () => null,
}))

vi.mock('@/app/components/app/overview/settings', () => ({
  default: () => null,
}))

vi.mock('@/app/components/app/overview/embedded', () => ({
  default: ({
    hiddenInputs = [],
    isShow,
  }: {
    hiddenInputs?: Array<{ variable: string }>
    isShow: boolean
  }) =>
    isShow ? (
      <div role="dialog" aria-label="embed into site">
        {hiddenInputs.map((input) => input.variable).join(',')}
      </div>
    ) : null,
}))

function createAppInfo(mode: AppModeEnum): AccessPointAppInfo {
  return {
    access_mode: AccessMode.PUBLIC,
    api_base_url: 'https://api.example.test/v1',
    enable_site: true,
    icon: '🤖',
    icon_background: '#FFEAD5',
    icon_type: 'emoji',
    icon_url: null,
    id: 'app-1',
    mode,
    site: {
      access_token: 'site-code',
      app_base_url: 'https://site.example.test',
    },
  } as AccessPointAppInfo
}

function renderCard(
  mode: AppModeEnum,
  availability: 'available' | 'loading' | 'unavailable' = 'available',
  workflow?: PublishedWorkflow,
  {
    canManageAccessPoint = true,
    onAppStateChanged = vi.fn().mockResolvedValue(undefined),
  }: {
    canManageAccessPoint?: boolean
    onAppStateChanged?: () => Promise<void>
  } = {},
) {
  const queryClient = createTestQueryClient()
  render(
    <WebAppAccessPointCard
      appInfo={createAppInfo(mode)}
      availability={availability}
      canDeploy
      canManageAccess
      canManageAccessPoint={canManageAccessPoint}
      showAccessControl
      onAppStateChanged={onAppStateChanged}
      onRefreshApp={vi.fn().mockResolvedValue(undefined)}
      onSaveSiteConfig={vi.fn().mockResolvedValue(undefined)}
      workflow={workflow}
    />,
    { wrapper: createQueryClientWrapper(queryClient) },
  )
}

const startNode: Node<{ variables: InputVar[] }> = {
  id: 'start',
  position: { x: 0, y: 0 },
  data: {
    title: 'Start',
    desc: '',
    type: BlockEnum.Start,
    variables: [
      {
        variable: 'secret',
        label: 'Secret',
        type: InputVarType.textInput,
        hide: true,
        required: true,
        default: '',
      },
    ],
  },
}

const workflowWithHiddenInput: NonNullable<PublishedWorkflow> = {
  conversation_variables: [],
  environment_variables: [],
  features: {},
  id: 'workflow-id',
  graph: {
    nodes: [startNode],
    edges: [],
  },
  created_at: 0,
  created_by: { id: 'user-id', name: 'User', email: 'user@example.com' },
  hash: 'workflow-hash',
  updated_at: 0,
  updated_by: { id: 'user-id', name: 'User', email: 'user@example.com' },
  tool_published: false,
  version: '1',
  marked_name: '',
  marked_comment: '',
  rag_pipeline_variables: [],
}

describe('WebAppAccessPointCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the current access mode without a redundant section label', () => {
    renderCard(AppModeEnum.CHAT)

    expect(screen.queryByText(/publishApp\.title/)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /accessControlDialog\.accessItems\.anyone/ }),
    ).toBeEnabled()
  })

  it.each([AppModeEnum.WORKFLOW, AppModeEnum.COMPLETION])(
    'does not offer Embed into site for %s apps',
    (mode) => {
      renderCard(mode)

      expect(screen.queryByRole('button', { name: /embedIntoSite/ })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /customize\.entry/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /settings\.settings/ })).toBeInTheDocument()
    },
  )

  it('keeps Embed into site for non-workflow Web apps', async () => {
    const user = userEvent.setup()
    renderCard(AppModeEnum.CHAT)

    await user.click(screen.getByRole('button', { name: /embedIntoSite/ }))

    expect(screen.getByRole('dialog', { name: 'embed into site' })).toBeInTheDocument()
  })

  it('updates site status through the generated contract', async () => {
    const user = userEvent.setup()
    const onAppStateChanged = vi.fn().mockResolvedValue(undefined)
    renderCard(AppModeEnum.CHAT, 'available', undefined, { onAppStateChanged })

    await user.click(screen.getByRole('switch'))

    await waitFor(() => {
      expect(mocks.updateSiteStatus.mock.calls[0]?.[0]).toEqual({
        params: { app_id: 'app-1' },
        body: { enable_site: false },
      })
      expect(onAppStateChanged).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps the status switch pending until the app state refresh completes', async () => {
    const user = userEvent.setup()
    let resolveRefresh: (() => void) | undefined
    const refresh = new Promise<void>((resolve) => {
      resolveRefresh = resolve
    })
    const onAppStateChanged = vi.fn(() => refresh)
    renderCard(AppModeEnum.CHAT, 'available', undefined, { onAppStateChanged })

    const statusSwitch = screen.getByRole('switch')
    await user.click(statusSwitch)

    await waitFor(() => {
      expect(onAppStateChanged).toHaveBeenCalledTimes(1)
      expect(statusSwitch).toHaveAttribute('aria-busy', 'true')
      expect(statusSwitch).toHaveAttribute('aria-disabled', 'true')
    })

    resolveRefresh?.()

    await waitFor(() => {
      expect(statusSwitch).not.toHaveAttribute('aria-busy', 'true')
      expect(statusSwitch).not.toHaveAttribute('aria-disabled', 'true')
    })
  })

  it('keeps site status changes behind Access Point management permission', async () => {
    const user = userEvent.setup()
    renderCard(AppModeEnum.CHAT, 'available', undefined, { canManageAccessPoint: false })

    await user.click(screen.getByRole('switch'))

    expect(mocks.updateSiteStatus).not.toHaveBeenCalled()
  })

  it('resets the site access token through the generated contract', async () => {
    const user = userEvent.setup()
    const onAppStateChanged = vi.fn().mockResolvedValue(undefined)
    renderCard(AppModeEnum.CHAT, 'available', undefined, { onAppStateChanged })

    await user.click(screen.getByRole('button', { name: /overview\.appInfo\.regenerate/ }))
    await user.click(screen.getByRole('button', { name: /operation\.confirm/ }))

    await waitFor(() => {
      expect(mocks.resetSiteAccessToken.mock.calls[0]?.[0]).toEqual({
        params: { app_id: 'app-1' },
      })
      expect(onAppStateChanged).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps generated mutation failures inside the card owner', async () => {
    const user = userEvent.setup()
    const error = new Error('request failed')
    const onAppStateChanged = vi.fn().mockResolvedValue(undefined)
    mocks.updateSiteStatus.mockRejectedValueOnce(error)
    renderCard(AppModeEnum.CHAT, 'available', undefined, { onAppStateChanged })

    await user.click(screen.getByRole('switch'))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully')
    })
    expect(onAppStateChanged).not.toHaveBeenCalled()
  })

  it('passes hidden Chatflow inputs to the embed dialog', async () => {
    const user = userEvent.setup()
    renderCard(AppModeEnum.ADVANCED_CHAT, 'available', workflowWithHiddenInput)

    await user.click(screen.getByRole('button', { name: /embedIntoSite/ }))

    expect(screen.getByRole('dialog', { name: 'embed into site' })).toHaveTextContent('secret')
  })

  it('configures hidden workflow inputs before opening the Web App', async () => {
    const user = userEvent.setup()
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderCard(AppModeEnum.WORKFLOW, 'available', workflowWithHiddenInput)

    await user.click(screen.getByRole('button', { name: /operation\.config/ }))
    await user.type(screen.getByLabelText('Secret'), 'top-secret')
    await user.click(screen.getByRole('button', { name: /overview\.appInfo\.launch/ }))

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        `https://site.example.test${basePath}/workflow/site-code?secret=top-secret`,
        '_blank',
      )
    })
  })

  it('shows loading without reporting an environment failure', () => {
    renderCard(AppModeEnum.WORKFLOW, 'loading')

    const card = screen.getByRole('region', { name: /webApp\.title/ })
    expect(card).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('common.loading')).toBeInTheDocument()
    expect(
      screen.queryByText('deployments.health.ENVIRONMENT_STATUS_FAILED'),
    ).not.toBeInTheDocument()
  })

  it('disables Web App management actions without Access Point management', () => {
    renderCard(AppModeEnum.CHAT, 'available', undefined, { canManageAccessPoint: false })

    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: /embedIntoSite/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /customize\.entry/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /settings\.settings/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /regenerate/ })).toBeDisabled()
    expect(screen.getByRole('link', { name: /studio\.accessPoint\.open/ })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: /accessControlDialog\.accessItems\.anyone/ }),
    ).toBeEnabled()
  })
})
