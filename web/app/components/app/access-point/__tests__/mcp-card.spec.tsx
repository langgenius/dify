import type { AccessPointAppInfo, PublishedWorkflow } from '../utils'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { render } from '@/test/console/render'
import { AppModeEnum } from '@/types/app'
import { MCPAccessPointCard } from '../mcp-card'

const mocks = vi.hoisted(() => ({
  invalidateServerDetail: vi.fn(),
  modalProps: vi.fn(),
  refreshServerCode: vi.fn(),
  updateServer: vi.fn(),
}))

vi.mock('@/service/use-tools', () => ({
  useInvalidateMCPServerDetail: () => mocks.invalidateServerDetail,
  useMCPServerDetail: () => ({
    data: undefined,
    isPending: false,
  }),
  useRefreshMCPServerCode: () => ({
    isPending: false,
    mutateAsync: mocks.refreshServerCode,
  }),
  useUpdateMCPServer: () => ({
    isPending: false,
    mutateAsync: mocks.updateServer,
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

describe('MCPAccessPointCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the provided basic app model config without refetching app detail', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    render(
      <MCPAccessPointCard
        appInfo={appInfo}
        canEdit
        triggerModeDisabled={false}
        workflow={undefined}
        workflowLoading={false}
      />,
    )

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

    render(
      <MCPAccessPointCard
        appInfo={workflowAppInfo}
        canEdit
        triggerModeDisabled={false}
        workflow={publishedWorkflow}
        workflowLoading={false}
      />,
    )

    await user.click(screen.getByRole('button', { name: /addDescription/ }))

    expect(mocks.modalProps).toHaveBeenCalledWith(
      expect.objectContaining({
        latestParams: [{ label: 'Query', variable: 'query' }],
      }),
    )
  })
})
