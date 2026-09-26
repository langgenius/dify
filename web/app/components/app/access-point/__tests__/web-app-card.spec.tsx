import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { PublishedWorkflow } from '../shared/utils'
import type { InputVar, Node } from '@/app/components/workflow/types'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { AccessMode } from '@/models/access-control'
import { consoleQuery } from '@/service/console'
import { seedAppDetail } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { createAppDetailFixture, createAppSiteFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'
import { WebAppAccessPointCard } from '../built-in-access-points/web-app-card'

const mocks = vi.hoisted(() => ({
  getUserCanAccess: vi.fn<() => Promise<{ result: boolean }>>(),
  siteEnable: vi.fn(),
  resetSiteAccessToken: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

let serverAppDetail: AppDetailWithSite
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: async (url: string, _init: RequestInit, { request }: { request: Request }) => {
    if (request.method === 'GET') return Response.json(serverAppDetail)
    if (request.method === 'POST' && new URL(url).pathname.endsWith('/site-enable')) {
      const body = await request.json()
      const response = await mocks.siteEnable({ params: { app_id: 'app-1' }, body })
      serverAppDetail = { ...serverAppDetail, ...response }
      return Response.json(response)
    }
    if (request.method === 'POST' && new URL(url).pathname.endsWith('/site/access-token-reset')) {
      const response = await mocks.resetSiteAccessToken({ params: { app_id: 'app-1' } })
      serverAppDetail = {
        ...serverAppDetail,
        site: serverAppDetail.site
          ? { ...serverAppDetail.site, access_token: 'new-site-code' }
          : null,
      }
      return Response.json(response)
    }
    throw new Error(`Unexpected request: ${request.method} ${url}`)
  },
}))

vi.mock('@/service/access-control/use-app-access-control', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/service/access-control/use-app-access-control')>()
  return {
    ...actual,
    useAppWhiteListSubjects: () => ({
      data: undefined,
    }),
  }
})

vi.mock('@/service/share', () => ({
  getUserCanAccess: mocks.getUserCanAccess,
}))

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['system-features'],
  }),
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => <div aria-label="app-icon" />,
}))

vi.mock('@/app/components/app/app-access-control', () => ({
  default: ({ onConfirm }: { onConfirm: () => Promise<void> }) => (
    <button type="button" onClick={() => void onConfirm()}>
      Save access control
    </button>
  ),
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

function createAppInfo(mode: AppModeEnum): AppDetailWithSite {
  return createAppDetailFixture({
    access_mode: AccessMode.PUBLIC,
    api_base_url: 'https://api.example.test/v1',
    enable_site: true,
    icon: '🤖',
    icon_background: '#FFEAD5',
    icon_type: 'emoji',
    icon_url: null,
    id: 'app-1',
    mode,
    site: createAppSiteFixture({
      access_token: 'site-code',
      app_base_url: 'https://site.example.test',
    }),
  })
}

function renderCard(
  mode: AppModeEnum,
  availability: 'available' | 'loading' | 'unavailable' = 'available',
  workflow?: PublishedWorkflow,
  {
    accessMode = AccessMode.PUBLIC,
    appOverrides = {},
    canManageAccessPoint = true,
    showAccessControl = true,
  }: {
    accessMode?: AccessMode | null
    appOverrides?: Partial<AppDetailWithSite>
    canManageAccessPoint?: boolean
    showAccessControl?: boolean
  } = {},
) {
  serverAppDetail = { ...createAppInfo(mode), ...appOverrides, access_mode: accessMode }
  const queryClient = createTestQueryClient()
  seedAppDetail(queryClient, serverAppDetail)
  queryClient.setQueryData(['system-features'], {
    webapp_auth: { enabled: showAccessControl },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <QueryConnectedWebAppCard
        availability={availability}
        canManageAccessPoint={canManageAccessPoint}
        showAccessControl={showAccessControl}
        workflow={workflow}
      />
    </QueryClientProvider>,
  )
}

function QueryConnectedWebAppCard({
  availability,
  canManageAccessPoint,
  showAccessControl,
  workflow,
}: {
  availability: 'available' | 'loading' | 'unavailable'
  canManageAccessPoint: boolean
  showAccessControl: boolean
  workflow?: PublishedWorkflow
}) {
  const appInfo = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({ input: { params: { app_id: 'app-1' } } }),
  ).data
  if (!appInfo) return null

  return (
    <WebAppAccessPointCard
      appInfo={appInfo}
      availability={availability}
      canDeploy
      canManageAccessPoint={canManageAccessPoint}
      showAccessControl={showAccessControl}
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
    mocks.getUserCanAccess.mockResolvedValue({ result: true })
    mocks.siteEnable.mockResolvedValue({
      enable_site: true,
    })
    mocks.resetSiteAccessToken.mockResolvedValue({})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('disables site actions when the app has no site', () => {
    renderCard(AppModeEnum.CHAT, 'available', undefined, { appOverrides: { site: null } })

    expect(screen.getByRole('button', { name: /settings\.settings/ })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /studio\.accessPoint\.embedIntoSite/ }),
    ).toBeDisabled()
    expect(
      screen.queryByRole('link', { name: /studio\.accessPoint\.open/ }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('https://site.example.test/chat/')).not.toBeInTheDocument()
  })

  it('does not present an unknown access mode as public or allow launching', () => {
    renderCard(AppModeEnum.CHAT, 'available', undefined, { accessMode: null })

    expect(
      screen.queryByRole('button', { name: /accessControlDialog\.accessItems\.anyone/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /studio\.accessPoint\.open/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /studio\.accessPoint\.open/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('shows the current access mode without a redundant section label', () => {
    renderCard(AppModeEnum.CHAT)

    expect(screen.queryByText(/publishApp\.title/)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /accessControlDialog\.accessItems\.anyone/ }),
    ).toBeEnabled()
  })

  it('disables Open and explains when the user cannot access the Web App', async () => {
    const user = userEvent.setup()
    mocks.getUserCanAccess.mockResolvedValue({ result: false })
    renderCard(AppModeEnum.WORKFLOW, 'available', undefined, {
      accessMode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
    })

    const openButton = screen.getByRole('button', { name: /studio\.accessPoint\.open/ })
    await user.hover(openButton)

    expect(await screen.findByText('app.noAccessPermission')).toBeVisible()
    expect(openButton).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: /settings\.settings/ })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: /accessControlDialog\.accessItems\.specific/ }),
    ).toBeEnabled()
    expect(
      screen.queryByRole('link', { name: /studio\.accessPoint\.open/ }),
    ).not.toBeInTheDocument()
  })

  it('keeps Open disabled until access is granted', async () => {
    const permission = createDeferredPromise<{ result: boolean }>()
    mocks.getUserCanAccess.mockReturnValueOnce(permission.promise)
    renderCard(AppModeEnum.WORKFLOW)

    expect(screen.getByRole('button', { name: /studio\.accessPoint\.open/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    permission.resolve({ result: true })

    expect(await screen.findByRole('link', { name: /studio\.accessPoint\.open/ })).toHaveAttribute(
      'href',
      `https://site.example.test${basePath}/workflow/site-code`,
    )
  })

  it('allows opening external-member Web Apps independently of platform access', () => {
    mocks.getUserCanAccess.mockResolvedValue({ result: false })
    renderCard(AppModeEnum.WORKFLOW, 'available', undefined, {
      accessMode: AccessMode.EXTERNAL_MEMBERS,
    })

    expect(screen.getByRole('link', { name: /studio\.accessPoint\.open/ })).toHaveAttribute(
      'href',
      `https://site.example.test${basePath}/workflow/site-code`,
    )
  })

  it('allows opening Web Apps without querying permissions when access control is disabled', () => {
    renderCard(AppModeEnum.CHAT, 'available', undefined, { showAccessControl: false })

    expect(screen.getByRole('link', { name: /studio\.accessPoint\.open/ })).toHaveAttribute(
      'href',
      `https://site.example.test${basePath}/chat/site-code`,
    )
    expect(mocks.getUserCanAccess).not.toHaveBeenCalled()
  })

  it('updates Open after saving Web App access permissions', async () => {
    const user = userEvent.setup()
    mocks.getUserCanAccess.mockResolvedValue({ result: false })
    renderCard(AppModeEnum.CHAT, 'available', undefined, {
      accessMode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
    })

    await user.click(
      screen.getByRole('button', { name: /accessControlDialog\.accessItems\.specific/ }),
    )
    expect(screen.getByRole('button', { name: /studio\.accessPoint\.open/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    mocks.getUserCanAccess.mockResolvedValue({ result: true })
    await user.click(screen.getByRole('button', { name: 'Save access control' }))

    expect(await screen.findByRole('link', { name: /studio\.accessPoint\.open/ })).toHaveAttribute(
      'href',
      `https://site.example.test${basePath}/chat/site-code`,
    )
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
    renderCard(AppModeEnum.CHAT)

    await user.click(screen.getByRole('switch'))

    await waitFor(() => {
      expect(mocks.siteEnable.mock.calls[0]?.[0]).toEqual({
        params: { app_id: 'app-1' },
        body: { enable_site: false },
      })
    })
  })

  it('keeps site status changes behind Access Point management permission', async () => {
    const user = userEvent.setup()
    renderCard(AppModeEnum.CHAT, 'available', undefined, { canManageAccessPoint: false })

    await user.click(screen.getByRole('switch'))

    expect(mocks.siteEnable).not.toHaveBeenCalled()
  })

  it('resets the site access token through the generated contract', async () => {
    const user = userEvent.setup()
    renderCard(AppModeEnum.CHAT)

    await user.click(screen.getByRole('button', { name: /overview\.appInfo\.regenerate/ }))
    await user.click(screen.getByRole('button', { name: /operation\.confirm/ }))

    await waitFor(() => {
      expect(mocks.resetSiteAccessToken.mock.calls[0]?.[0]).toEqual({
        params: { app_id: 'app-1' },
      })
      expect(screen.getByRole('link', { name: /studio\.accessPoint\.open/ })).toHaveAttribute(
        'href',
        `https://site.example.test${basePath}/chat/new-site-code`,
      )
    })
  })

  it('keeps generated mutation failures inside the card owner', async () => {
    const user = userEvent.setup()
    const error = new Error('request failed')
    mocks.siteEnable.mockRejectedValueOnce(error)
    renderCard(AppModeEnum.CHAT)

    await user.click(screen.getByRole('switch'))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully')
    })
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

  it('allows configuring workflow inputs but prevents launching without Web App access', async () => {
    const user = userEvent.setup()
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    mocks.getUserCanAccess.mockResolvedValue({ result: false })
    renderCard(AppModeEnum.WORKFLOW, 'available', workflowWithHiddenInput, {
      accessMode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
    })

    const configButton = screen.getByRole('button', { name: /operation\.config/ })
    expect(configButton).toBeEnabled()
    await user.click(configButton)
    await user.type(screen.getByLabelText('Secret'), 'top-secret')

    const launchButton = screen.getByRole('button', { name: /overview\.appInfo\.launch/ })
    expect(launchButton).toBeDisabled()
    await user.click(launchButton)
    await user.keyboard('{Enter}')

    expect(openSpy).not.toHaveBeenCalled()
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

  it('disables Web App management actions without Access Point management', async () => {
    renderCard(AppModeEnum.CHAT, 'available', undefined, { canManageAccessPoint: false })

    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: /embedIntoSite/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /customize\.entry/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /settings\.settings/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /regenerate/ })).toBeDisabled()
    expect(await screen.findByRole('link', { name: /studio\.accessPoint\.open/ })).toHaveAttribute(
      'href',
      `https://site.example.test${basePath}/chat/site-code`,
    )
    expect(
      screen.getByRole('button', { name: /accessControlDialog\.accessItems\.anyone/ }),
    ).toBeDisabled()
  })
})
