import type { ComponentProps, ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { fetchTracingConfig, fetchTracingStatus, updateTracingStatus } from '@/service/apps'
import { AppACLPermission } from '@/utils/permission'
import Panel from '../panel'

const testState = vi.hoisted(() => ({
  appPermissionKeys: [] as string[],
  workspacePermissionKeys: [] as string[],
  configButtonProps: [] as Array<{
    readOnly: boolean
    hasConfigured: boolean
  }>,
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/app/app-1/overview',
}))

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
  fetchTracingStatus: vi.fn(),
  fetchTracingConfig: vi.fn(),
  updateTracingStatus: vi.fn(),
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

const mockedFetchTracingStatus = vi.mocked(fetchTracingStatus)
const mockedFetchTracingConfig = vi.mocked(fetchTracingConfig)
const mockedUpdateTracingStatus = vi.mocked(updateTracingStatus)

const renderPanel = async () => {
  render(<Panel />)

  await screen.findAllByTestId('config-button')
}

describe('Tracing overview panel permissions', () => {
  beforeEach(() => {
    testState.appPermissionKeys = []
    testState.workspacePermissionKeys = []
    testState.configButtonProps = []
    mockedFetchTracingStatus.mockResolvedValue({
      enabled: false,
      tracing_provider: null,
    })
    mockedFetchTracingConfig.mockResolvedValue({
      tracing_provider: 'langfuse',
      tracing_config: {},
      has_not_configured: true,
    } as Awaited<ReturnType<typeof fetchTracingConfig>>)
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
})
