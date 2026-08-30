import type { AccessPointAppInfo, PublishedWorkflow } from '../shared/utils'
import { toast } from '@langgenius/dify-ui/toast'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { AppModeEnum } from '@/types/app'
import { MCPAccessPointCard } from '../built-in-access-points/mcp-card'

const mocks = vi.hoisted(() => ({
  invalidateServerDetail: vi.fn(),
  serverDetail: {
    data: undefined as undefined | { id: string; server_code: string; status: string },
    isPending: false,
  },
  modalProps: vi.fn(),
  refreshServerCode: vi.fn(),
  updateServer: vi.fn(),
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
        server: {
          put: {
            mutationOptions: (options = {}) => ({
              mutationFn: mocks.updateServer,
              ...options,
            }),
          },
        },
      },
    },
  },
}))

vi.mock('@/service/use-tools', () => ({
  useInvalidateMCPServerDetail: () => mocks.invalidateServerDetail,
  useMCPServerDetail: () => mocks.serverDetail,
  useRefreshMCPServerCode: () => ({
    isPending: false,
    mutateAsync: mocks.refreshServerCode,
  }),
}))

vi.mock('@/app/components/tools/mcp/mcp-server-modal', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.modalProps(props)
    return <div role="dialog" aria-label="MCP server settings" />
  },
}))

const appInfo = {
  api_base_url: 'https://api.example.test/v1',
  id: 'app-1',
  mode: AppModeEnum.CHAT,
  model_config: {
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
  },
} as AccessPointAppInfo

const workflowAppInfo = {
  ...appInfo,
  mode: AppModeEnum.WORKFLOW,
  model_config: null,
} as unknown as AccessPointAppInfo

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

function renderCard(cardAppInfo: AccessPointAppInfo = appInfo, workflow?: PublishedWorkflow) {
  const queryClient = createTestQueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <MCPAccessPointCard
        appInfo={cardAppInfo}
        canEdit
        triggerModeDisabled={false}
        workflow={workflow}
        workflowLoading={false}
      />
    </QueryClientProvider>,
  )
}

describe('MCPAccessPointCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.serverDetail.data = undefined
    mocks.serverDetail.isPending = false
    mocks.updateServer.mockResolvedValue(undefined)
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

    await user.click(screen.getByRole('button', { name: /addDescription/ }))

    expect(screen.getByRole('dialog', { name: 'MCP server settings' })).toBeInTheDocument()
    expect(mocks.modalProps).toHaveBeenCalledWith(
      expect.objectContaining({
        latestParams: [
          {
            label: 'Question',
            required: true,
            type: 'text-input',
            variable: 'question',
          },
        ],
      }),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('uses workflow inputs when the app model config is null', async () => {
    const user = userEvent.setup()

    renderCard(workflowAppInfo, publishedWorkflow)

    await user.click(screen.getByRole('button', { name: /addDescription/ }))

    expect(mocks.modalProps).toHaveBeenCalledWith(
      expect.objectContaining({
        latestParams: [{ label: 'Query', variable: 'query' }],
      }),
    )
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

    secondToggle.resolve()

    await waitFor(() => {
      expect(mocks.invalidateServerDetail).toHaveBeenCalledTimes(2)
    })
    expect(accessSwitch).toHaveAttribute('aria-checked', 'true')
  })
})
