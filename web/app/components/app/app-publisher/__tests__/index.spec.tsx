/* oxlint-disable typescript/no-explicit-any */
import {
  DeploymentStatus,
  EnvironmentStatus,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { WorkflowContext } from '@/app/components/workflow/context'
import { AccessMode } from '@/models/access-control'
import { consoleQuery } from '@/service/client'
import { appWorkflowVersionsInfiniteQueryOptions } from '@/service/workflow-queries'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { AppModeEnum } from '@/types/app'
import { AppACLPermission } from '@/utils/permission'
import { basePath } from '@/utils/var'
import { AppPublisher } from '../index'

const render = (ui: React.ReactElement) =>
  renderWithConsoleQuery(ui, {
    systemFeatures: { webapp_auth: { enabled: true } },
  })

const mockOnPublish = vi.fn()
const mockOnToggle = vi.fn()
const mockTrackEvent = vi.fn()
const mockRefetch = vi.fn()
const mockUseGetUserCanAccessApp = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
const mockWindowOpen = vi.fn()
const mockInvalidateAppWorkflow = vi.fn()
const mockUpdateWorkflow = vi.fn()
const mockFetchPublishedWorkflow = vi.fn()
let mockPublishedWorkflow: Record<string, any> | null = null
let mockPublishedWorkflowQueryState = {
  isError: false,
  isLoading: false,
  isSuccess: true,
}

const sectionProps = vi.hoisted(() => ({
  summary: null as null | Record<string, any>,
  actions: null as null | Record<string, any>,
}))
const hotkeyMocks = vi.hoisted(() => ({
  hotkeys: [] as string[],
  handlers: [] as Array<(event: { preventDefault: () => void }) => void>,
}))
const collaborationMocks = vi.hoisted(() => ({
  handler: undefined as
    | ((update: {
        type: 'app_publish_update'
        userId: string
        data: Record<string, unknown>
        timestamp: number
      }) => void)
    | undefined,
}))

let mockAppDetail: Record<string, any> | null = null
let mockWorkspacePermissionKeys: string[] = ['tool.manage']

vi.mock('@tanstack/react-hotkeys', () => ({
  useHotkey: (hotkey: string, handler: (event: { preventDefault: () => void }) => void) => {
    hotkeyMocks.hotkeys.push(hotkey)
    hotkeyMocks.handlers.push(handler)
  },
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail: Record<string, any> | null }) => unknown) =>
    selector({ appDetail: mockAppDetail }),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: () => 'moments ago',
  }),
}))

vi.mock('@/service/access-control/use-app-access-control', () => ({
  useGetUserCanAccessApp: (params: unknown) => {
    mockUseGetUserCanAccessApp(params)
    return {
      data: { result: true },
      isLoading: false,
      refetch: mockRefetch,
    }
  },
  useAppWhiteListSubjects: () => ({
    data: { groups: [], members: [] },
    isLoading: false,
  }),
}))

const mockPublishToCreatorsPlatform = vi.fn()

vi.mock('@/service/apps', () => ({
  publishToCreatorsPlatform: (...args: unknown[]) => mockPublishToCreatorsPlatform(...args),
}))

vi.mock('@/service/use-workflow', () => ({
  useAppWorkflow: () => ({
    data: mockPublishedWorkflow,
    ...mockPublishedWorkflowQueryState,
  }),
  useInvalidateAppWorkflow: () => mockInvalidateAppWorkflow,
  useUpdateWorkflow: () => ({ mutate: mockUpdateWorkflow }),
}))

vi.mock('@/service/workflow-queries', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/service/workflow-queries')>()

  return {
    ...original,
    appWorkflowQueryOptions: (appId: string) => ({
      queryKey: ['workflow', 'publish', appId],
      queryFn: () => mockFetchPublishedWorkflow(appId),
    }),
  }
})

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    onAppPublishUpdate: (handler: NonNullable<(typeof collaborationMocks)['handler']>) => {
      collaborationMocks.handler = handler
      return vi.fn()
    },
  },
}))

vi.mock('@/service/use-tools', () => ({
  useWorkflowToolDetailByAppID: () => ({
    data: undefined,
    isLoading: false,
  }),
  useInvalidateAllWorkflowTools: () => vi.fn(),
  useInvalidateWorkflowToolDetailByAppID: () => vi.fn(),
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    isCurrentWorkspaceEditor: false,
    isCurrentWorkspaceManager: true,
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    isCurrentWorkspaceManager: true,
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

vi.mock('@/app/components/tools/workflow-tool', () => ({
  WorkflowToolDrawer: ({ onHide }: { onHide: () => void }) => (
    <div role="dialog" aria-label="Workflow tool drawer">
      workflow tool drawer
      <button type="button" onClick={onHide}>
        close-workflow-tool-drawer
      </button>
    </div>
  ),
}))

vi.mock('../built-in-publisher/summary-section', () => ({
  PublisherSummarySection: (props: Record<string, any>) => {
    sectionProps.summary = props
    return (
      <div>
        {props.environmentTabs}
        <button
          type="button"
          disabled={props.publishDisabled || props.published}
          onClick={() => void props.handlePublish()}
        >
          publisher-summary-publish
        </button>
        <button type="button" disabled={props.published} onClick={() => void props.handleRestore()}>
          publisher-summary-restore
        </button>
        <button type="button" onClick={props.onEditVersion}>
          publisher-summary-edit-version
        </button>
      </div>
    )
  },
}))

vi.mock('../built-in-publisher/actions-section', () => ({
  PublisherActionsSection: (props: Record<string, any>) => {
    sectionProps.actions = props
    return (
      <div>
        {props.showRunConfig && props.handleOpenRunConfig && (
          <button type="button" onClick={() => props.handleOpenRunConfig(props.appURL)}>
            publisher-run-config
          </button>
        )}
        {props.showMarketplaceAction && (
          <button
            type="button"
            disabled={props.marketplaceActionDisabled}
            onClick={props.onPublishToMarketplace}
          >
            {props.publishingToMarketplace
              ? 'workflow.common.publishingToMarketplace'
              : 'workflow.common.publishToMarketplace'}
          </button>
        )}
        <button type="button" onClick={props.onConfigureWorkflowTool}>
          publisher-workflow-tool
        </button>
      </div>
    )
  },
}))

describe('AppPublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hotkeyMocks.hotkeys.length = 0
    hotkeyMocks.handlers.length = 0
    collaborationMocks.handler = undefined
    sectionProps.summary = null
    sectionProps.actions = null
    mockPublishedWorkflow = null
    mockPublishedWorkflowQueryState = {
      isError: false,
      isLoading: false,
      isSuccess: true,
    }
    mockFetchPublishedWorkflow.mockResolvedValue(null)
    mockWorkspacePermissionKeys = ['tool.manage']
    mockAppDetail = {
      id: 'app-1',
      name: 'Demo App',
      mode: AppModeEnum.CHAT,
      maintainer: 'user-2',
      permission_keys: [],
      access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
      site: {
        app_base_url: 'https://example.com',
        access_token: 'token-1',
      },
    }
    Object.defineProperty(window, 'open', {
      configurable: true,
      writable: true,
      value: mockWindowOpen,
    })
  })

  it('should enable access permission query when the publish popover opens', async () => {
    render(<AppPublisher publishedAt={Date.now()} onToggle={mockOnToggle} />)

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))

    expect(screen.getByText('publisher-summary-publish'))!.toBeInTheDocument()
    expect(mockOnToggle).toHaveBeenCalledWith(true)

    await waitFor(() => {
      expect(mockUseGetUserCanAccessApp).toHaveBeenCalledWith({
        appId: 'app-1',
        enabled: true,
      })
    })
    expect(mockRefetch).not.toHaveBeenCalled()
  })

  it('should not render Web app access control in the publish popover', () => {
    render(<AppPublisher publishedAt={Date.now()} />)

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))

    expect(screen.queryByText('publisher-access-control')).not.toBeInTheDocument()
  })

  it('should publish once per open session and reset the lock after reopening', async () => {
    mockOnPublish.mockResolvedValue(undefined)

    render(<AppPublisher publishedAt={Date.now()} onPublish={mockOnPublish} />)

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    fireEvent.click(screen.getByText('publisher-summary-publish'))

    await waitFor(() => {
      expect(mockOnPublish).toHaveBeenCalledTimes(1)
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'app_published_time',
        expect.objectContaining({
          action_mode: 'app',
          app_id: 'app-1',
          app_name: 'Demo App',
        }),
      )
      expect(sectionProps.summary?.published).toBe(true)
      expect(screen.getByText('publisher-summary-publish')).toBeDisabled()
    })

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    expect(screen.queryByText('publisher-summary-publish')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    expect(sectionProps.summary?.published).toBe(false)
    expect(screen.getByText('publisher-summary-publish')).toBeEnabled()
  })

  it('should refresh deployment data after publishing when multi-environment deployment is available', async () => {
    const user = userEvent.setup()
    const queryClient = createConsoleQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
      permission_keys: [AppACLPermission.Deploy],
    }
    mockOnPublish.mockResolvedValue(undefined)
    const environmentsQuery =
      consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
        enabled: true,
        input: {
          params: {
            app_id: 'app-1',
          },
        },
      })
    queryClient.setQueryDefaults(environmentsQuery.queryKey, { staleTime: Infinity })
    queryClient.setQueryData(environmentsQuery.queryKey, { data: [] })

    renderWithConsoleQuery(<AppPublisher publishedAt={Date.now()} onPublish={mockOnPublish} />, {
      queryClient,
    })

    await user.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    await user.click(screen.getByText('publisher-summary-publish'))

    const workflowVersionsQuery = appWorkflowVersionsInfiniteQueryOptions('app-1')
    const environmentDeploymentsQuery =
      consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions({
        input: {
          params: {
            app_id: 'app-1',
          },
        },
      })
    await waitFor(() => {
      expect(mockInvalidateAppWorkflow).toHaveBeenCalledWith('app-1')
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: workflowVersionsQuery.queryKey,
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: environmentDeploymentsQuery.queryKey,
      })
    })
  })

  it('should not refresh deployment data after publishing without multi-environment deployment', async () => {
    const user = userEvent.setup()
    const queryClient = createConsoleQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
      permission_keys: [],
    }
    mockOnPublish.mockResolvedValue(undefined)

    renderWithConsoleQuery(<AppPublisher publishedAt={Date.now()} onPublish={mockOnPublish} />, {
      queryClient,
    })

    await user.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    await user.click(screen.getByText('publisher-summary-publish'))

    await waitFor(() => {
      expect(mockOnPublish).toHaveBeenCalledTimes(1)
    })
    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it('should edit the current workflow version from the publish summary', async () => {
    const user = userEvent.setup()
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
    }
    mockPublishedWorkflow = {
      created_at: Math.floor(Date.now() / 1000),
      id: 'workflow-version-5',
      marked_name: 'Release 5',
      marked_comment: 'Initial notes',
    }

    render(<AppPublisher publishedAt={Date.now()} />)

    await user.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    expect(sectionProps.summary).toEqual(
      expect.objectContaining({
        isWorkflowApp: true,
        versionInfo: mockPublishedWorkflow,
      }),
    )
    await user.click(screen.getByText('publisher-summary-edit-version'))

    expect(screen.queryByText('publisher-summary-edit-version')).not.toBeInTheDocument()
    const [titleInput, notesInput] = screen.getAllByRole('textbox')
    await user.clear(titleInput!)
    await user.type(titleInput!, 'Release 6')
    await user.clear(notesInput!)
    await user.type(notesInput!, 'Updated notes')
    await user.click(
      screen.getByRole('button', {
        name: /(?:^|\.)operation\.save(?=$|:)/,
      }),
    )

    expect(mockUpdateWorkflow).toHaveBeenCalledWith(
      {
        url: '/apps/app-1/workflows/workflow-version-5',
        title: 'Release 6',
        releaseNotes: 'Updated notes',
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
        onSettled: expect.any(Function),
      }),
    )

    const mutationCallbacks = mockUpdateWorkflow.mock.calls[0]![1]
    mutationCallbacks.onSuccess()
    expect(mockInvalidateAppWorkflow).toHaveBeenCalledWith('app-1')
    expect(mockToastSuccess).toHaveBeenCalled()
  })

  it('should expose app deployment with deploy ACL regardless of the legacy workspace role', () => {
    const queryClient = createConsoleQueryClient()
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
      permission_keys: [AppACLPermission.Deploy],
    }
    const environmentsQuery =
      consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
        enabled: true,
        input: {
          params: {
            app_id: 'app-1',
          },
        },
      })
    queryClient.setQueryDefaults(environmentsQuery.queryKey, { staleTime: Infinity })
    queryClient.setQueryData(environmentsQuery.queryKey, { data: [] })

    renderWithConsoleQuery(<AppPublisher publishedAt={Date.now()} />, {
      queryClient,
      systemFeatures: { webapp_auth: { enabled: true }, enable_app_deploy: false },
    })

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))

    expect(sectionProps.actions?.showDeployAction).toBe(true)
    expect(sectionProps.actions?.appURL).toContain('/workflow/token-1')
    expect(screen.getByRole('group', { name: /studio\.environments/ })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /nodes\.common\.memories\.builtIn/ }),
    ).toHaveAttribute('aria-current', 'true')
  })

  it('should keep the workflow publisher single-environment without app deploy ACL', () => {
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
      permission_keys: [],
    }

    renderWithConsoleQuery(<AppPublisher publishedAt={Date.now()} />, {
      systemFeatures: { webapp_auth: { enabled: true }, enable_app_deploy: false },
    })

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))

    expect(sectionProps.actions?.showDeployAction).toBe(false)
    expect(screen.queryByRole('group', { name: /studio\.environments/ })).not.toBeInTheDocument()
    expect(sectionProps.summary?.environmentTabs).toBeUndefined()
  })

  it('should keep the single-environment publisher for unsupported app types', () => {
    renderWithConsoleQuery(<AppPublisher publishedAt={Date.now()} />, {
      systemFeatures: { webapp_auth: { enabled: true }, enable_app_deploy: true },
    })

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))

    expect(screen.queryByRole('group', { name: /studio\.environments/ })).not.toBeInTheDocument()
    expect(sectionProps.summary?.environmentTabs).toBeUndefined()
  })

  it('should show the matching publisher state for an undeployed environment', async () => {
    const user = userEvent.setup()
    const queryClient = createConsoleQueryClient()
    const publishedAt = Date.now()
    const environmentDeploymentDetailRequests: Request[] = []
    const environmentDeploymentListRequests: Request[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const pathname = new URL(request.url).pathname
      if (
        pathname.endsWith('/enterprise/app-deploy/apps/app-1/workflows/environment-deployments')
      ) {
        environmentDeploymentListRequests.push(request.clone())
        return new Response(
          JSON.stringify({
            environment_deployments: [],
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      }

      if (
        pathname.endsWith(
          '/enterprise/app-deploy/apps/app-1/workflows/environment-deployments/pre-release',
        )
      ) {
        environmentDeploymentDetailRequests.push(request.clone())
        throw new Error('The undeployed environment detail endpoint must not be queried.')
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })
    mockPublishedWorkflowQueryState = {
      isError: false,
      isLoading: true,
      isSuccess: false,
    }
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
      permission_keys: [AppACLPermission.Deploy],
    }
    const environmentsQuery =
      consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
        enabled: true,
        input: {
          params: {
            app_id: 'app-1',
          },
        },
      })
    queryClient.setQueryDefaults(environmentsQuery.queryKey, { staleTime: Infinity })
    queryClient.setQueryData(environmentsQuery.queryKey, {
      data: [
        {
          description: '',
          display_name: 'Staging',
          id: 'staging',
          in_use: true,
          status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
        },
        {
          description: '',
          display_name: 'Canary',
          id: 'canary',
          in_use: true,
          status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
        },
        {
          description: '',
          display_name: 'Pre-release',
          id: 'pre-release',
          in_use: false,
          status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
        },
      ],
    })
    const { rerender } = renderWithConsoleQuery(<AppPublisher publishedAt={publishedAt} />, {
      queryClient,
      systemFeatures: { webapp_auth: { enabled: true }, enable_app_deploy: true },
    })

    await user.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    await user.click(
      screen.getByRole('button', {
        name: /(?:studio\.moreEnvironments|operation\.more)/,
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'Pre-release' }))

    await waitFor(() => {
      expect(environmentDeploymentListRequests.length).toBeGreaterThan(0)
    })
    expect(environmentDeploymentDetailRequests).toHaveLength(0)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText(/studio\.accessPoint\.noPublishedTitle/)).not.toBeInTheDocument()
    expect(screen.queryByText(/studio\.publisher\.notDeployedYet/)).not.toBeInTheDocument()

    mockPublishedWorkflowQueryState = {
      isError: false,
      isLoading: false,
      isSuccess: true,
    }
    rerender(<AppPublisher publishedAt={publishedAt} />)

    expect(await screen.findByText(/studio\.accessPoint\.noPublishedTitle/)).toBeInTheDocument()
    expect(screen.getByText(/studio\.publisher\.noPublishedDescription/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /studio\.accessPoint\.goToPublish/ })).toBeEnabled()
    expect(screen.queryByText(/studio\.publisher\.notDeployedYet/)).not.toBeInTheDocument()

    mockPublishedWorkflow = {
      created_at: 1_710_000_100,
      id: 'workflow-version-5',
      marked_comment: '',
      marked_name: 'Release 5',
      version: 'v5',
    }
    rerender(<AppPublisher publishedAt={publishedAt} />)

    expect(await screen.findByText(/studio\.publisher\.notDeployedYet/)).toBeInTheDocument()
    expect(screen.queryByText(/studio\.publisher\.noPublishedDescription/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /studio\.deployLatest/ })).toBeEnabled()
    expect(screen.getByText(/overview\.chip\.latest/).parentElement).toHaveTextContent(
      'overview.chip.latest: Release 5',
    )
    expect(screen.getByRole('button', { name: /studio\.allVersions/ })).toBeInTheDocument()
    expect(screen.queryByText('publisher-summary-publish')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /nodes\.common\.memories\.builtIn/ }))

    expect(screen.getByText('publisher-summary-publish')).toBeInTheDocument()
  })

  it('returns to the built-in environment when reopened', async () => {
    const user = userEvent.setup()
    const queryClient = createConsoleQueryClient()
    const detailRequests: Request[] = []
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
      permission_keys: [AppACLPermission.Deploy],
    }
    const environmentsQuery =
      consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
        enabled: true,
        input: {
          params: {
            app_id: 'app-1',
          },
        },
      })
    queryClient.setQueryDefaults(environmentsQuery.queryKey, { staleTime: Infinity })
    queryClient.setQueryData(environmentsQuery.queryKey, {
      data: [
        {
          description: '',
          display_name: 'Staging',
          id: 'staging',
          in_use: true,
          status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
        },
      ],
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (
        new URL(request.url).pathname.endsWith(
          '/enterprise/app-deploy/apps/app-1/workflows/environment-deployments/staging',
        )
      ) {
        detailRequests.push(request.clone())
        return new Response(
          JSON.stringify({
            environment_deployment: {
              access: {
                enable_api: true,
                enable_site: true,
              },
              deployment: {
                current_version: {
                  id: 'workflow-version-5',
                  marked_comment: '',
                  marked_name: 'Release 5',
                  version: 'v5',
                },
                status: DeploymentStatus.DEPLOYMENT_STATUS_DEPLOYING,
              },
              environment: {
                description: '',
                display_name: 'Staging',
                id: 'staging',
                status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
              },
            },
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    renderWithConsoleQuery(<AppPublisher publishedAt={Date.now()} />, {
      queryClient,
      systemFeatures: { webapp_auth: { enabled: true }, enable_app_deploy: true },
    })

    const publishButton = screen.getByRole('button', {
      name: /(?:^|\.)common\.publish(?=$|:)/,
    })
    expect(publishButton).toHaveAttribute('aria-expanded', 'false')

    await user.click(publishButton)
    expect(publishButton).toHaveAttribute('aria-expanded', 'true')
    const stagingButton = screen.getByRole('button', { name: 'Staging' })
    expect(stagingButton).toBeInTheDocument()

    await user.click(stagingButton)
    await waitFor(() => {
      expect(detailRequests.length).toBeGreaterThan(0)
    })
    expect(screen.getByRole('button', { name: 'Staging' })).toHaveAttribute('aria-current', 'true')

    await user.click(publishButton)

    expect(publishButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Staging' })).not.toBeInTheDocument()

    await user.click(publishButton)
    expect(publishButton).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('button', { name: /nodes\.common\.memories\.builtIn/ }),
    ).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Staging' })).not.toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('should collect hidden inputs before opening the web app from its config action', async () => {
    render(
      <AppPublisher
        publishedAt={Date.now()}
        inputs={[
          {
            variable: 'secret',
            label: 'Secret',
            type: 'text-input',
            required: true,
            hide: true,
            default: '',
          } as any,
        ]}
      />,
    )

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))

    expect(sectionProps.actions?.showRunConfig).toBe(true)
    fireEvent.click(screen.getByText('publisher-run-config'))

    expect(
      screen.getByText(/(?:^|\.)overview\.appInfo\.workflowLaunchHiddenInputs\.title(?=$|:)/),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Secret'), {
      target: { value: 'top-secret' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: /(?:^|\.)overview\.appInfo\.launch(?=$|:)/ }),
    )

    await waitFor(() => {
      expect(mockWindowOpen).toHaveBeenCalledWith(
        `https://example.com${basePath}/chat/token-1?secret=${encodeURIComponent('top-secret')}`,
        '_blank',
      )
    })
  })

  it('should keep workflow tool drawer mounted after closing the publish popover', () => {
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
    }

    render(<AppPublisher publishedAt={Date.now()} toolPublished />)

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    expect(sectionProps.actions).toEqual(
      expect.objectContaining({
        toolPublished: true,
        workflowToolOutdated: false,
      }),
    )
    fireEvent.click(screen.getByText('publisher-workflow-tool'))

    expect(screen.queryByText('publisher-workflow-tool')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Workflow tool drawer' })).toBeInTheDocument()
  })

  it('should not open workflow tool drawer without tool.manage', () => {
    mockWorkspacePermissionKeys = []
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
    }

    render(<AppPublisher publishedAt={Date.now()} />)

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    fireEvent.click(screen.getByText('publisher-workflow-tool'))

    expect(screen.queryByRole('dialog', { name: 'Workflow tool drawer' })).not.toBeInTheDocument()
    expect(sectionProps.actions?.workflowToolAvailable).toBe(false)
  })

  it('should ignore the trigger when the publish button is disabled', () => {
    render(<AppPublisher disabled publishedAt={Date.now()} onToggle={mockOnToggle} />)

    fireEvent.click(
      screen.getByText(/(?:^|\.)common\.publish(?=$|:)/).parentElement
        ?.parentElement as HTMLElement,
    )

    expect(screen.queryByText('publisher-summary-publish')).not.toBeInTheDocument()
    expect(mockOnToggle).not.toHaveBeenCalled()
  })

  it('should keep keyboard publishing available in multiple model mode', async () => {
    const preventDefault = vi.fn()
    mockOnPublish.mockResolvedValue(undefined)

    render(
      <AppPublisher
        debugWithMultipleModel
        multipleModelConfigs={[
          {
            id: 'model-1',
            model: 'gpt-4o',
            provider: 'openai',
            parameters: {},
          },
        ]}
        publishedAt={Date.now()}
        onPublish={mockOnPublish}
      />,
    )

    hotkeyMocks.handlers[0]!({ preventDefault })

    await waitFor(() => {
      expect(preventDefault).toHaveBeenCalled()
      expect(mockOnPublish).toHaveBeenCalledTimes(1)
    })
  })

  it('should keep the popover open when restore and publish fail', async () => {
    const preventDefault = vi.fn()
    const onRestore = vi.fn().mockRejectedValue(new Error('restore failed'))
    mockOnPublish.mockRejectedValueOnce(new Error('publish failed'))

    render(
      <AppPublisher publishedAt={Date.now()} onPublish={mockOnPublish} onRestore={onRestore} />,
    )

    hotkeyMocks.handlers[0]!({ preventDefault })

    await waitFor(() => {
      expect(preventDefault).toHaveBeenCalled()
      expect(mockOnPublish).toHaveBeenCalledTimes(1)
    })
    expect(mockTrackEvent).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    fireEvent.click(screen.getByText('publisher-summary-restore'))

    await waitFor(() => {
      expect(onRestore).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByText('publisher-summary-publish'))!.toBeInTheDocument()
  })

  it('should show marketplace button and open redirect URL on success', async () => {
    mockPublishToCreatorsPlatform.mockResolvedValue({
      redirect_url: 'https://marketplace.example.com/publish?code=abc',
    })
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    renderWithConsoleQuery(<AppPublisher publishedAt={Date.now()} onPublish={mockOnPublish} />, {
      systemFeatures: { webapp_auth: { enabled: true }, enable_creators_platform: true },
    })

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    expect(sectionProps.actions).toEqual(
      expect.objectContaining({
        marketplaceActionDisabled: false,
        showMarketplaceAction: true,
      }),
    )
    fireEvent.click(screen.getByText(/(?:^|\.)common\.publishToMarketplace(?=$|:)/))

    await waitFor(() => {
      expect(mockPublishToCreatorsPlatform).toHaveBeenCalledWith({ appID: 'app-1' })
      expect(windowOpenSpy).toHaveBeenCalledWith(
        'https://marketplace.example.com/publish?code=abc',
        '_blank',
      )
    })

    windowOpenSpy.mockRestore()
  })

  it('should show toast error when publish to marketplace fails', async () => {
    mockPublishToCreatorsPlatform.mockRejectedValue(new Error('network error'))

    renderWithConsoleQuery(<AppPublisher publishedAt={Date.now()} onPublish={mockOnPublish} />, {
      systemFeatures: { webapp_auth: { enabled: true }, enable_creators_platform: true },
    })

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    fireEvent.click(screen.getByText(/(?:^|\.)common\.publishToMarketplace(?=$|:)/))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringMatching(/(?:^|\.)common\.publishToMarketplaceFailed(?=$|:)/),
      )
    })
  })

  it('should disable marketplace button when not yet published', () => {
    renderWithConsoleQuery(<AppPublisher onPublish={mockOnPublish} />, {
      systemFeatures: { webapp_auth: { enabled: true }, enable_creators_platform: true },
    })

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    expect(sectionProps.actions).toEqual(
      expect.objectContaining({
        marketplaceActionDisabled: true,
        showMarketplaceAction: true,
      }),
    )
    const marketplaceButton = screen
      .getByText(/(?:^|\.)common\.publishToMarketplace(?=$|:)/)
      .closest('a, button, div[role="button"]') as HTMLElement
    expect(marketplaceButton).toBeInTheDocument()
    // clicking should not call the API because publishedAt is undefined
    fireEvent.click(screen.getByText(/(?:^|\.)common\.publishToMarketplace(?=$|:)/))
    expect(mockPublishToCreatorsPlatform).not.toHaveBeenCalled()
  })

  it('should hide marketplace button when enable_creators_platform is false', () => {
    render(<AppPublisher publishedAt={Date.now()} onPublish={mockOnPublish} />)

    fireEvent.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    expect(sectionProps.actions?.showMarketplaceAction).toBe(false)
    expect(
      screen.queryByText(/(?:^|\.)common\.publishToMarketplace(?=$|:)/),
    ).not.toBeInTheDocument()
  })

  it('should not infer an app mode when app detail is unavailable', async () => {
    const user = userEvent.setup()
    mockAppDetail = null

    render(<AppPublisher publishedAt={Date.now()} />)

    await user.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))

    expect(sectionProps.summary).toEqual(
      expect.objectContaining({
        isChatApp: false,
        isWorkflowApp: false,
      }),
    )
  })

  it('should keep workflow publishing available for an existing published version', async () => {
    const user = userEvent.setup()
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
    }
    mockPublishedWorkflow = {
      created_at: 1_710_000_100,
      hash: 'published-hash',
    }

    mockOnPublish.mockResolvedValue(undefined)
    render(
      <AppPublisher
        draftUpdatedAt={1_710_000_200_000}
        onPublish={mockOnPublish}
        publishedAt={1_710_000_100_000}
      />,
    )

    await user.click(screen.getByText(/(?:^|\.)common\.publish(?=$|:)/))
    expect(sectionProps.summary).toEqual(
      expect.objectContaining({
        published: false,
        publishedAt: 1_710_000_100_000,
      }),
    )
    await user.click(screen.getByText('publisher-summary-publish'))
    await waitFor(() => expect(mockOnPublish).toHaveBeenCalledOnce())
  })

  it('should refresh the shared workflow query and store after a collaborator publishes', async () => {
    const setPublishedAt = vi.fn()
    const workflowStore = {
      getState: () => ({ setPublishedAt }),
    }
    mockAppDetail = {
      ...mockAppDetail,
      mode: AppModeEnum.WORKFLOW,
    }
    mockFetchPublishedWorkflow.mockResolvedValue({
      created_at: 1_710_000_300,
      hash: 'published-hash',
    })

    render(
      <WorkflowContext value={workflowStore as any}>
        <AppPublisher publishedAt={1_710_000_100_000} />
      </WorkflowContext>,
    )

    act(() => {
      collaborationMocks.handler?.({
        type: 'app_publish_update',
        userId: 'collaborator-1',
        data: { action: 'published' },
        timestamp: 1_710_000_300_000,
      })
    })

    await waitFor(() => {
      expect(mockFetchPublishedWorkflow).toHaveBeenCalledWith('app-1')
      expect(setPublishedAt).toHaveBeenCalledWith(1_710_000_300)
    })
  })
})
