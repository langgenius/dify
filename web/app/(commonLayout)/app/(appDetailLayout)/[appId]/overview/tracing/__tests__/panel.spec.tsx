import type { TraceAppConfigListResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ComponentProps, ReactNode } from 'react'
import { screen, waitFor } from '@testing-library/react'
import { updateTracingStatus } from '@/service/apps'
import { renderWithAccountProfile as render } from '@/test/console/account-profile'
import { AppACLPermission } from '@/utils/permission'
import Panel from '../panel'

const testState = vi.hoisted(() => ({
  appPermissionKeys: [] as string[],
  workspacePermissionKeys: [] as string[],
  configButtonProps: [] as Array<{
    readOnly: boolean
    hasConfigured: boolean
  }>,
  fetchTraceConfigs: vi.fn(),
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
  }))
})

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/app/app-1/overview',
}))

vi.mock('@/context/account-state', async () => {
  const { atom } = await import('jotai')
  return { userProfileIdAtom: atom('user-1') }
})

vi.mock('@/app/components/app/store', () => ({
  useStore: vi.fn((selector: (state: { appDetail: { permission_keys: string[] } }) => unknown) =>
    selector({
      appDetail: {
        permission_keys: testState.appPermissionKeys,
      },
    }),
  ),
}))

vi.mock('@/service/apps', () => ({
  updateTracingStatus: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      byAppId: {
        traceConfigs: {
          get: {
            queryOptions: ({ input }: { input: unknown }) => ({
              queryKey: ['trace-configs', input],
              queryFn: () => testState.fetchTraceConfigs(input),
            }),
          },
        },
      },
    },
  },
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/status-dot', () => ({
  StatusDot: ({ status }: { status: string }) => <span data-testid="status-dot">{status}</span>,
}))

vi.mock('@/app/components/base/icons/src/public/tracing', () => ({
  AliyunIcon: () => <span data-testid="aliyun-icon" />,
  ArizeIcon: () => <span data-testid="arize-icon" />,
  DatabricksIcon: () => <span data-testid="databricks-icon" />,
  LangfuseIcon: () => <span data-testid="langfuse-icon" />,
  LangsmithIcon: () => <span data-testid="langsmith-icon" />,
  MlflowIcon: () => <span data-testid="mlflow-icon" />,
  OpikIcon: () => <span data-testid="opik-icon" />,
  PhoenixIcon: () => <span data-testid="phoenix-icon" />,
  TencentIcon: () => <span data-testid="tencent-icon" />,
  TracingIcon: () => <span data-testid="tracing-icon" />,
  WeaveIcon: () => <span data-testid="weave-icon" />,
}))

vi.mock('../config-button', () => ({
  default: ({
    children,
    ...props
  }: ComponentProps<'div'> & {
    readOnly: boolean
    hasConfigured: boolean
    children?: ReactNode
  }) => {
    testState.configButtonProps.push({
      readOnly: props.readOnly,
      hasConfigured: props.hasConfigured,
    })

    return (
      <div
        data-testid="config-button"
        data-read-only={String(props.readOnly)}
        data-has-configured={String(props.hasConfigured)}
      >
        {children}
      </div>
    )
  },
}))

const mockedUpdateTracingStatus = vi.mocked(updateTracingStatus)

const renderPanel = async () => {
  render(<Panel />)

  await screen.findAllByTestId('config-button')
}

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: [],
  }))
})

describe('Tracing overview panel permissions', () => {
  beforeEach(() => {
    testState.appPermissionKeys = []
    testState.workspacePermissionKeys = []
    testState.configButtonProps = []
    testState.fetchTraceConfigs.mockResolvedValue({
      enabled: false,
      tracing_provider: null,
      configured_providers: [],
      configs: null,
    } satisfies TraceAppConfigListResponse)
    mockedUpdateTracingStatus.mockResolvedValue({
      result: 'success',
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('marks tracing config as read-only without app monitor or workspace tracking permissions', async () => {
    await renderPanel()

    await waitFor(() => {
      expect(testState.configButtonProps[0]).toMatchObject({
        readOnly: true,
        hasConfigured: false,
      })
    })
  })

  it('marks tracing config as read-only with app monitor permission only', async () => {
    testState.appPermissionKeys = [AppACLPermission.Monitor]

    await renderPanel()

    await waitFor(() => {
      expect(testState.configButtonProps[0]).toMatchObject({
        readOnly: true,
        hasConfigured: false,
      })
    })
  })

  it('allows tracing config when app ACL includes tracing config permission', async () => {
    testState.appPermissionKeys = [AppACLPermission.TracingConfig]

    await renderPanel()

    await waitFor(() => {
      expect(testState.configButtonProps[0]).toMatchObject({
        readOnly: false,
        hasConfigured: false,
      })
    })
  })

  it('loads only the tracing summary on the overview', async () => {
    await renderPanel()

    expect(testState.fetchTraceConfigs).toHaveBeenCalledTimes(1)
    expect(testState.fetchTraceConfigs).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
      query: { include_config: false },
    })
  })

  it('keeps the configuration action hidden until the summary resolves', async () => {
    let resolveSummary: (value: TraceAppConfigListResponse) => void = () => {}
    testState.fetchTraceConfigs.mockReturnValue(
      new Promise<TraceAppConfigListResponse>((resolve) => {
        resolveSummary = resolve
      }),
    )

    render(<Panel />)

    expect(screen.queryByTestId('config-button')).not.toBeInTheDocument()

    resolveSummary({
      enabled: false,
      tracing_provider: null,
      configured_providers: [],
      configs: null,
    })

    expect(await screen.findByTestId('config-button')).toBeInTheDocument()
  })
})
