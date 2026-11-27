import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { PublishedWorkflow } from '../shared/utils'
import { zAppMcpServerResponse } from '@dify/contracts/api/console/apps/zod.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { render } from '@/test/console/render'
import { createAppDetailFixture, createAppModelConfigFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { MCPAccessPointCard } from '../built-in-access-points/mcp-card'

const mocks = vi.hoisted(() => ({
  serverDetail: {
    data: undefined as undefined | { id: string; server_code: string; status: string },
    failure: undefined as Error | undefined,
    isPending: false,
  },
  refreshServerCode: vi.fn(),
  updateServer: vi.fn(),
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
      'apps.byAppId.server.get': () =>
        mocks.serverDetail.isPending
          ? new Promise(() => {})
          : mocks.serverDetail.failure
            ? Promise.reject(mocks.serverDetail.failure)
            : Promise.resolve(mocks.serverDetail.data ?? {}),
      'apps.byAppId.server.put': async (input) => {
        await mocks.updateServer(input)
        if (mocks.serverDetail.data)
          mocks.serverDetail.data = {
            ...mocks.serverDetail.data,
            status: (input as { body: { status: string } }).body.status,
          }
      },
      'apps.byAppId.server.refresh.post': (input) => mocks.refreshServerCode(input),
    }),
  }
})

const appInfo = createAppDetailFixture({
  api_base_url: 'https://api.example.test/v1',
  id: 'app-1',
  mode: 'chat' as const,
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
  mode: 'workflow' as const,
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
  if (!mocks.serverDetail.isPending && !mocks.serverDetail.failure)
    queryClient.setQueryData(
      consoleQuery.apps.byAppId.server.get.queryKey({
        input: { params: { app_id: cardAppInfo.id } },
      }),
      zAppMcpServerResponse.parse({
        id: '',
        server_code: '',
        name: '',
        description: '',
        parameters: {},
        status: 'inactive',
        ...mocks.serverDetail.data,
      }),
    )
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MCPAccessPointCard
        appInfo={cardAppInfo}
        canManageAccessPoint
        availability="available"
        workflow={workflow}
      />
    </QueryClientProvider>,
  )
  return { ...view, queryClient }
}

describe('MCPAccessPointCard', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.serverDetail.data = undefined
    mocks.serverDetail.failure = undefined
    mocks.serverDetail.isPending = false
    mocks.updateServer.mockResolvedValue(undefined)
  })

  it('shows a failed server load as unavailable with a retry instead of an unpublished server', async () => {
    const user = userEvent.setup()
    mocks.serverDetail.failure = new Error('Offline')
    renderCard()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('deployments.common.loadFailed')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /tools\.mcp\.server\.addDescription/ }),
    ).toBeDisabled()

    mocks.serverDetail.failure = undefined
    mocks.serverDetail.data = { id: 'server-1', server_code: 'code-1', status: 'active' }
    await user.click(within(alert).getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /tools\.mcp\.server\.edit/ })).toBeEnabled()
  })

  it('opens settings with the provided basic app model config', async () => {
    const user = userEvent.setup()

    renderCard()

    await user.click(screen.getByRole('button', { name: /addDescription/ }))

    expect(
      screen.getByRole('dialog', { name: 'tools.mcp.server.modal.addTitle' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Question' })).toBeInTheDocument()
    expect(screen.getByText('question')).toBeInTheDocument()
    expect(screen.getByText('text-input')).toBeInTheDocument()
  })

  it('uses workflow inputs when the app model config is null', async () => {
    const user = userEvent.setup()

    renderCard(workflowAppInfo, publishedWorkflow)

    await user.click(screen.getByRole('button', { name: /addDescription/ }))

    expect(
      screen.getByRole('dialog', { name: 'tools.mcp.server.modal.addTitle' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Query' })).toBeInTheDocument()
    expect(screen.getByText('query')).toBeInTheDocument()
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

  it('rotates once, leaves the card in charge after Escape, and uses the returned URL', async () => {
    const user = userEvent.setup()
    const request = createDeferredPromise<ReturnType<typeof zAppMcpServerResponse.parse>>()
    mocks.serverDetail.data = { id: 'server-1', server_code: 'old-url', status: 'active' }
    mocks.refreshServerCode.mockReturnValueOnce(request.promise)
    renderCard()

    const regenerate = screen.getByRole('button', { name: /appInfo.regenerate$/ })
    await user.click(regenerate)
    const dialog = within(screen.getByRole('alertdialog'))
    const confirm = dialog.getByRole('button', { name: 'common.operation.confirm' })
    confirm.focus()
    await act(async () => {
      confirm.click()
      confirm.click()
    })
    await waitFor(() => expect(confirm).toHaveAttribute('aria-disabled', 'true'))
    expect(mocks.refreshServerCode).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: appInfo.id },
    })
    expect(confirm).toHaveFocus()
    expect(dialog.getByRole('button', { name: 'common.operation.close' })).toBeEnabled()
    await user.keyboard('{Enter}{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mocks.refreshServerCode).toHaveBeenCalledTimes(1)
    expect(regenerate).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'common.operation.copy' })).toBeDisabled()

    mocks.serverDetail.isPending = true
    await act(async () =>
      request.resolve(
        zAppMcpServerResponse.parse({
          ...mocks.serverDetail.data,
          server_code: 'new-url',
          name: '',
          description: '',
          parameters: {},
        }),
      ),
    )
    expect(await screen.findByText(/mcp\/server\/new-url\/mcp/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.copy' })).toBeEnabled()
  })

  it('shows a failed rotation and allows retrying the same confirmation', async () => {
    const user = userEvent.setup()
    const failed = createDeferredPromise<never>()
    const retry = createDeferredPromise<never>()
    mocks.serverDetail.data = { id: 'server-1', server_code: 'old-url', status: 'active' }
    mocks.refreshServerCode.mockReturnValueOnce(failed.promise).mockReturnValueOnce(retry.promise)
    renderCard()

    await user.click(screen.getByRole('button', { name: /appInfo.regenerate$/ }))
    const confirm = within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'common.operation.confirm',
    })
    await user.click(confirm)
    await act(async () => failed.reject(new Error('Rotation failed')))
    await waitFor(() => expect(confirm).not.toHaveAttribute('aria-disabled', 'true'))
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Rotation failed')
    expect(confirm).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(mocks.refreshServerCode).toHaveBeenCalledTimes(2)
    await act(async () => retry.reject(new Error('Retry failed')))
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

    const accessSwitch = screen.getByRole('switch')
    await user.click(accessSwitch)

    expect(accessSwitch).toHaveAttribute('aria-checked', 'false')

    toggle.reject(new Error('request failed'))

    await waitFor(() => {
      expect(accessSwitch).toHaveAttribute('aria-checked', 'true')
    })
    expect(toast.error).toHaveBeenCalledWith('request failed')
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
    const { queryClient } = renderCard()

    const accessSwitch = screen.getByRole('switch')
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
    expect(mocks.updateServer.mock.calls.map(([input]) => input.body.status)).toEqual([
      'inactive',
      'active',
    ])
    await waitFor(() => {
      expect(
        queryClient.getQueryData(
          consoleQuery.apps.byAppId.server.get.queryKey({
            input: { params: { app_id: 'app-1' } },
          }),
        ),
      ).toEqual(expect.objectContaining({ status: 'inactive' }))
    })

    secondToggle.resolve()

    await waitFor(() => {
      expect(
        queryClient.getQueryData(
          consoleQuery.apps.byAppId.server.get.queryKey({
            input: { params: { app_id: 'app-1' } },
          }),
        ),
      ).toEqual(expect.objectContaining({ status: 'active' }))
    })
    expect(accessSwitch).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('agentV2.agentDetail.access.status.inService')).toBeInTheDocument()
  })
})
