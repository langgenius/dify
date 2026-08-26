import type { AccessPointAppInfo, PublishedWorkflow } from '../shared/utils'
import type { InputVar, Node } from '@/app/components/workflow/types'
import { toast } from '@langgenius/dify-ui/toast'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore as useAppStore } from '@/app/components/app/store'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { AccessMode } from '@/models/access-control'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'
import { WebAppAccessPointCard } from '../built-in-access-points/web-app-card'

const mocks = vi.hoisted(() => ({
  siteEnable: vi.fn(),
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
        siteEnable: {
          post: {
            mutationOptions: (options = {}) => ({
              mutationFn: mocks.siteEnable,
              ...options,
            }),
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
) {
  useAppStore.setState({ appDetail: createAppInfo(mode) })
  const queryClient = createTestQueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <StoreConnectedWebAppCard availability={availability} workflow={workflow} />
    </QueryClientProvider>,
  )
}

function StoreConnectedWebAppCard({
  availability,
  workflow,
}: {
  availability: 'available' | 'loading' | 'unavailable'
  workflow?: PublishedWorkflow
}) {
  const appInfo = useAppStore((state) => state.appDetail)
  if (!appInfo) return null

  return (
    <WebAppAccessPointCard
      appInfo={appInfo}
      availability={availability}
      canEdit
      canDeploy
      canManageAccess
      showAccessControl
      onRefreshApp={vi.fn().mockResolvedValue(undefined)}
      onRegenerate={vi.fn().mockResolvedValue(undefined)}
      onSaveSiteConfig={vi.fn().mockResolvedValue(undefined)}
      workflow={workflow}
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
    mocks.siteEnable.mockResolvedValue({
      enable_site: true,
    })
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

  it('does not announce an unavailable access control entry as loading', () => {
    renderCard(AppModeEnum.WORKFLOW, 'unavailable')

    const card = screen.getByRole('region', { name: /webApp\.title/ })
    expect(within(card).queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument()
  })

  it('optimistically serializes status changes without a success toast', async () => {
    const user = userEvent.setup()
    const firstToggle = createDeferredPromise<{ enable_site: boolean }>()
    const secondToggle = createDeferredPromise<{ enable_site: boolean }>()
    mocks.siteEnable
      .mockReturnValueOnce(firstToggle.promise)
      .mockReturnValueOnce(secondToggle.promise)
    renderCard(AppModeEnum.CHAT)

    const accessSwitch = screen.getByRole('switch')
    await user.click(accessSwitch)

    expect(accessSwitch).toHaveAttribute('aria-checked', 'false')
    expect(mocks.siteEnable).toHaveBeenCalledTimes(1)

    await user.click(accessSwitch)

    expect(accessSwitch).toHaveAttribute('aria-checked', 'true')
    expect(mocks.siteEnable).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByRole('link', { name: /studio\.accessPoint\.open/ }),
    ).not.toBeInTheDocument()

    firstToggle.resolve({ enable_site: false })

    await waitFor(() => {
      expect(mocks.siteEnable).toHaveBeenCalledTimes(2)
    })
    expect(mocks.siteEnable.mock.calls[1]?.[0]).toEqual({
      body: { enable_site: true },
      params: { app_id: 'app-1' },
    })

    secondToggle.resolve({ enable_site: true })

    await screen.findByRole('link', { name: /studio\.accessPoint\.open/ })
    expect(accessSwitch).toHaveAttribute('aria-checked', 'true')
    expect(toast.success).not.toHaveBeenCalled()
  })
})
