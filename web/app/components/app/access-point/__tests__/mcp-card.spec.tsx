import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { PublishedWorkflow } from '../shared/utils'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { render } from '@/test/console/render'
import { createAppDetailFixture, createAppModelConfigFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { AppModeEnum } from '@/types/app'
import { MCPAccessPointCard } from '../built-in-access-points/mcp-card'

const mocks = vi.hoisted(() => ({
  getServer: vi.fn(),
  createServer: vi.fn(),
  saveServer: vi.fn(),
  serverDetail: {
    data: undefined as
      | undefined
      | {
          id: string
          server_code: string
          status: string
          description?: string
          parameters?: Record<string, string>
        },
    isPending: false,
  },
  updateServer: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: (path: string[], input: unknown) => {
      if (path.join('.') === 'apps.byAppId.server.put') return mocks.updateServer(input)
      throw new Error(`Unexpected console request: ${path.join('.')}`)
    },
  },
}))

vi.mock('@/service/base', () => ({
  get: (url: string) => mocks.getServer(url),
  post: (url: string, options: unknown) => mocks.createServer(url, options),
  put: (url: string, options: unknown) => mocks.saveServer(url, options),
}))

const appInfo = createAppDetailFixture({
  api_base_url: 'https://api.example.test/v1',
  id: 'app-1',
  mode: AppModeEnum.CHAT,
  model_config: createAppModelConfigFixture({
    updated_at: 1_710_000_000,
    user_input_form: [
      {
        'text-input': {
          label: 'Question',
          required: true,
          variable: 'question',
        },
      },
    ],
  }),
})

const workflowAppInfo = createAppDetailFixture({
  ...appInfo,
  mode: AppModeEnum.WORKFLOW,
  model_config: null,
})

const publishedWorkflow = {
  graph: {
    nodes: [
      {
        data: {
          type: BlockEnum.Start,
          variables: [{ label: 'Query', variable: 'query' }],
        },
      },
    ],
  },
} as unknown as PublishedWorkflow

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

function renderCard(cardAppInfo: AppDetailWithSite = appInfo, workflow?: PublishedWorkflow) {
  const queryClient = createTestQueryClient()

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MCPAccessPointCard
        appInfo={cardAppInfo}
        canManageAccessPoint
        triggerModeDisabled={false}
        workflow={workflow}
        workflowLoading={false}
      />
    </QueryClientProvider>,
  )
  return { ...result, queryClient }
}

describe('MCPAccessPointCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.serverDetail.data = undefined
    mocks.serverDetail.isPending = false
    mocks.updateServer.mockResolvedValue(undefined)
    mocks.getServer.mockImplementation(() =>
      mocks.serverDetail.isPending
        ? new Promise(() => {})
        : Promise.resolve(mocks.serverDetail.data ?? {}),
    )
    mocks.createServer.mockResolvedValue({})
    mocks.saveServer.mockResolvedValue({})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the provided basic app model config without refetching app detail', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    renderCard()

    const configure = screen.getByRole('button', { name: /addDescription/ })
    await waitFor(() => expect(configure).toBeEnabled())
    await user.click(configure)

    expect(screen.getByRole('textbox', { name: 'Question' })).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('uses workflow inputs when the app model config is null', async () => {
    const user = userEvent.setup()

    renderCard(workflowAppInfo, publishedWorkflow)

    const configure = screen.getByRole('button', { name: /addDescription/ })
    await waitFor(() => expect(configure).toBeEnabled())
    await user.click(configure)

    expect(screen.getByRole('textbox', { name: 'Query' })).toBeInTheDocument()
  })

  it('shows loading without reporting an environment failure', () => {
    mocks.serverDetail.isPending = true

    renderCard(workflowAppInfo, publishedWorkflow)

    const card = screen.getByRole('region', { name: /mcp\.server\.title/ })
    expect(card).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('common.loading')).toBeInTheDocument()
    expect(
      screen.queryByText('deployments.health.ENVIRONMENT_STATUS_FAILED'),
    ).not.toBeInTheDocument()
  })

  it('rolls back a failed status change and shows only an error toast', async () => {
    const user = userEvent.setup()
    const toggle = createDeferredPromise<void>()
    mocks.serverDetail.data = {
      id: 'server-1',
      server_code: 'server-code',
      status: 'active',
    }
    mocks.updateServer.mockReturnValueOnce(toggle.promise)
    renderCard()

    const accessSwitch = await screen.findByRole('switch')
    await waitFor(() => expect(accessSwitch).toHaveAttribute('aria-checked', 'true'))
    await user.click(accessSwitch)

    expect(accessSwitch).toHaveAttribute('aria-checked', 'false')

    toggle.reject(new Error('request failed'))

    await waitFor(() => {
      expect(accessSwitch).toHaveAttribute('aria-checked', 'true')
    })
    expect(toast.error).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('optimistically serializes rapid status changes without a busy switch', async () => {
    const user = userEvent.setup()
    const firstToggle = createDeferredPromise<void>()
    const secondToggle = createDeferredPromise<void>()
    mocks.serverDetail.data = {
      id: 'server-1',
      server_code: 'server-code',
      status: 'active',
    }
    mocks.updateServer
      .mockReturnValueOnce(firstToggle.promise)
      .mockReturnValueOnce(secondToggle.promise)
    renderCard()

    const accessSwitch = await screen.findByRole('switch')
    await waitFor(() => expect(accessSwitch).toHaveAttribute('aria-checked', 'true'))
    await user.click(accessSwitch)

    expect(accessSwitch).toHaveAttribute('aria-checked', 'false')
    expect(accessSwitch).toBeEnabled()

    await user.click(accessSwitch)

    expect(accessSwitch).toHaveAttribute('aria-checked', 'true')
    expect(mocks.updateServer).toHaveBeenCalledTimes(1)

    firstToggle.resolve()

    await waitFor(() => {
      expect(mocks.updateServer).toHaveBeenCalledTimes(2)
    })

    secondToggle.resolve()

    await waitFor(() => {
      expect(mocks.getServer).toHaveBeenCalledTimes(3)
    })
    expect(accessSwitch).toHaveAttribute('aria-checked', 'true')
  })
  it('opens first-time configuration from the switch without changing server status', async () => {
    const user = userEvent.setup()
    renderCard()
    const configure = screen.getByRole('button', { name: /addDescription/ })
    await waitFor(() => expect(configure).toBeEnabled())
    const accessSwitch = await screen.findByRole('switch')
    await user.click(accessSwitch)
    expect(
      screen.getByRole('dialog', { name: 'tools.mcp.server.modal.addTitle' }),
    ).toBeInTheDocument()
    expect(mocks.updateServer).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(accessSwitch).toHaveAttribute('aria-checked', 'false')
  })

  it('keeps pending and failed creation open, retries its exact draft, and closes without awaiting refresh', async () => {
    const user = userEvent.setup()
    const pending = createDeferredPromise<unknown>()
    const refresh = createDeferredPromise<unknown>()
    mocks.createServer.mockReturnValueOnce(pending.promise)
    const { queryClient } = renderCard()
    const configure = screen.getByRole('button', { name: /addDescription/ })
    await waitFor(() => expect(configure).toBeEnabled())
    await user.click(configure)
    const description = screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
    const parameter = screen.getByRole('textbox', { name: 'Question' })
    await user.clear(description)
    await user.type(description, 'Server draft')
    await user.type(parameter, 'Question hint')
    const submit = screen.getByRole('button', { name: 'tools.mcp.server.modal.confirm' })
    await user.click(submit)
    await waitFor(() => expect(submit).toHaveAttribute('aria-disabled', 'true'))
    expect(description).toHaveAttribute('readonly')
    expect(parameter).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'tools.mcp.modal.cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    await user.click(submit)
    expect(mocks.createServer).toHaveBeenCalledTimes(1)
    await act(async () => pending.reject(new Error('Save failed')))
    await waitFor(() => expect(submit).not.toHaveAttribute('aria-disabled', 'true'))
    expect(description).toHaveValue('Server draft')
    mocks.getServer.mockReturnValue(refresh.promise)
    await user.click(submit)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.createServer).toHaveBeenNthCalledWith(2, 'apps/app-1/server', {
      body: { description: 'Server draft', parameters: { question: 'Question hint' } },
    })
    expect(queryClient.isFetching()).toBeGreaterThan(0)
    await act(async () =>
      refresh.resolve({ id: 'server-1', status: 'active', server_code: 'server-code' }),
    )
  })

  it('updates existing configuration with the server id and only current parameter values', async () => {
    mocks.serverDetail.data = {
      id: 'server-1',
      server_code: 'server-code',
      status: 'active',
      description: 'Existing',
      parameters: { question: 'Old hint', removed: 'Do not send' },
    }
    const user = userEvent.setup()
    renderCard()
    await user.click(await screen.findByRole('button', { name: 'tools.mcp.server.edit' }))
    const description = screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
    const parameter = screen.getByRole('textbox', { name: 'Question' })
    await user.clear(description)
    await user.type(description, 'Updated')
    await user.clear(parameter)
    await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.saveServer).toHaveBeenCalledWith('apps/app-1/server', {
      body: { id: 'server-1', description: 'Updated', parameters: { question: '' } },
    })
    expect(mocks.createServer).not.toHaveBeenCalled()
  })
})
