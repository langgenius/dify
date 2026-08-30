import type {
  WorkflowPaginationResponse,
  WorkflowResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type {
  EnvironmentDeployment,
  GetEnvironmentDeploymentResponse,
  ListEnvironmentDeploymentsResponse,
  WorkflowVersion,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { InfiniteData } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  DeploymentOperationStatus,
  DeploymentOperationType,
  DeploymentStatus,
  EnvironmentStatus,
  OperatorType,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { AppModeEnum } from '@/types/app'
import { consoleQuery } from '../client'
import { useUpdateWorkflow } from '../use-workflow'
import {
  appWorkflowQueryOptions,
  appWorkflowVersionsInfiniteQueryKey,
  appWorkflowVersionsInfiniteQueryOptions,
} from '../workflow-queries'

const mockPatch = vi.hoisted(() => vi.fn())

vi.mock('../base', () => ({
  del: vi.fn(),
  get: vi.fn(),
  patch: (...args: unknown[]) => mockPatch(...args),
  post: vi.fn(),
  put: vi.fn(),
}))

const createWrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })

const createWorkflow = (overrides: Partial<WorkflowResponse> = {}): WorkflowResponse => ({
  conversation_variables: [],
  created_at: 1_710_000_100,
  environment_variables: [],
  features: {},
  graph: {},
  hash: 'hash-workflow-1',
  id: 'workflow-1',
  marked_comment: 'Old notes',
  marked_name: 'Old release',
  rag_pipeline_variables: [],
  tool_published: false,
  updated_at: 1_710_000_100,
  version: '2026-08-21.1',
  version_number: 1,
  ...overrides,
})

const createEnvironmentDeployment = ({
  currentVersion,
  environmentId,
  targetVersion,
}: {
  currentVersion?: WorkflowVersion
  environmentId: string
  targetVersion?: WorkflowVersion
}): EnvironmentDeployment => ({
  access: {
    enable_api: false,
    enable_site: false,
  },
  deployment: {
    current_version: currentVersion,
    latest_operation: targetVersion
      ? {
          activity_at: 1_710_000_200,
          id: `operation-${environmentId}`,
          operator: {
            display_name: 'Alice',
            id: 'user-1',
            type: OperatorType.OPERATOR_TYPE_ACCOUNT,
          },
          status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED,
          target_version: targetVersion,
          type: DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_DEPLOY,
        }
      : undefined,
    status: DeploymentStatus.DEPLOYMENT_STATUS_RUNNING,
  },
  environment: {
    description: `${environmentId} environment`,
    display_name: environmentId,
    id: environmentId,
    status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
  },
})

describe('useUpdateWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPatch.mockResolvedValue({})
  })

  it('should invalidate workflow version history after updating version information', async () => {
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateWorkflow(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        url: '/apps/app-1/workflows/workflow-1',
        title: 'Release 1',
        releaseNotes: 'Notes',
      })
    })

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['workflow', 'versionHistory'],
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: appWorkflowVersionsInfiniteQueryKey(),
    })
  })

  it.each([AppModeEnum.WORKFLOW, AppModeEnum.ADVANCED_CHAT])(
    'should synchronize every cached app deployment reference to the updated workflow version (%s)',
    async (appMode) => {
      const queryClient = createQueryClient()
      const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
      const oldVersion: WorkflowVersion = {
        id: 'workflow-1',
        marked_comment: 'Old notes',
        marked_name: 'Old release',
        version: '2026-08-21.1',
        version_number: 1,
      }
      const unrelatedVersion: WorkflowVersion = {
        id: 'workflow-2',
        marked_comment: 'Keep these notes',
        marked_name: 'Keep this release',
        version: '2026-08-20.1',
        version_number: 2,
      }
      const updatedWorkflow = createWorkflow({
        marked_comment: '',
        marked_name: '',
        updated_at: 1_710_000_300,
      })
      const workflowVersionsQuery = appWorkflowVersionsInfiniteQueryOptions('app-1')
      const publishedWorkflowQuery = appWorkflowQueryOptions('app-1')
      const deploymentsQuery =
        consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions(
          {
            input: {
              params: {
                app_id: 'app-1',
              },
            },
          },
        )
      const deploymentDetailQuery =
        consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryOptions({
          input: {
            params: {
              app_id: 'app-1',
              environment_id: 'staging',
            },
          },
        })
      const stagingDeployment = createEnvironmentDeployment({
        currentVersion: oldVersion,
        environmentId: 'staging',
        targetVersion: oldVersion,
      })
      const productionDeployment = createEnvironmentDeployment({
        currentVersion: unrelatedVersion,
        environmentId: 'production',
        targetVersion: oldVersion,
      })

      queryClient.setQueryData(publishedWorkflowQuery.queryKey, createWorkflow())
      queryClient.setQueryData<InfiniteData<WorkflowPaginationResponse>>(
        workflowVersionsQuery.queryKey,
        {
          pageParams: [1],
          pages: [
            {
              has_more: false,
              items: [createWorkflow(), createWorkflow({ id: 'workflow-2' })],
              limit: 10,
              page: 1,
            },
          ],
        },
      )
      queryClient.setQueryData<ListEnvironmentDeploymentsResponse>(deploymentsQuery.queryKey, {
        environment_deployments: [stagingDeployment, productionDeployment],
      })
      queryClient.setQueryData<GetEnvironmentDeploymentResponse>(deploymentDetailQuery.queryKey, {
        environment_deployment: stagingDeployment,
      })
      mockPatch.mockResolvedValueOnce(updatedWorkflow)
      const { result } = renderHook(() => useUpdateWorkflow(), {
        wrapper: createWrapper(queryClient),
      })

      await act(async () => {
        await result.current.mutateAsync({
          appId: 'app-1',
          appMode,
          url: '/apps/app-1/workflows/workflow-1',
          title: '',
          releaseNotes: '',
        })
      })

      expect(queryClient.getQueryData<WorkflowResponse>(publishedWorkflowQuery.queryKey)).toEqual(
        updatedWorkflow,
      )
      expect(
        queryClient.getQueryData<InfiniteData<WorkflowPaginationResponse>>(
          workflowVersionsQuery.queryKey,
        )?.pages[0]?.items,
      ).toEqual([updatedWorkflow, createWorkflow({ id: 'workflow-2' })])

      const deployments = queryClient.getQueryData<ListEnvironmentDeploymentsResponse>(
        deploymentsQuery.queryKey,
      )?.environment_deployments
      expect(deployments?.[0]?.deployment?.current_version).toEqual({
        ...oldVersion,
        marked_comment: '',
        marked_name: '',
      })
      expect(deployments?.[0]?.deployment?.latest_operation?.target_version).toEqual({
        ...oldVersion,
        marked_comment: '',
        marked_name: '',
      })
      expect(deployments?.[1]?.deployment?.current_version).toBe(unrelatedVersion)
      expect(deployments?.[1]?.deployment?.latest_operation?.target_version).toEqual({
        ...oldVersion,
        marked_comment: '',
        marked_name: '',
      })

      expect(
        queryClient.getQueryData<GetEnvironmentDeploymentResponse>(deploymentDetailQuery.queryKey)
          ?.environment_deployment.deployment?.current_version,
      ).toEqual({
        ...oldVersion,
        marked_comment: '',
        marked_name: '',
      })
      expect(
        queryClient.getQueryData<GetEnvironmentDeploymentResponse>(deploymentDetailQuery.queryKey)
          ?.environment_deployment.deployment?.latest_operation?.target_version,
      ).toEqual({
        ...oldVersion,
        marked_comment: '',
        marked_name: '',
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: deploymentsQuery.queryKey,
      })
    },
  )

  it('should keep the latest published workflow when editing an older app version', async () => {
    const queryClient = createQueryClient()
    const latestWorkflow = createWorkflow({
      id: 'workflow-2',
      marked_comment: 'Latest notes',
      marked_name: 'Latest release',
    })
    const publishedWorkflowQuery = appWorkflowQueryOptions('app-1')
    queryClient.setQueryData(publishedWorkflowQuery.queryKey, latestWorkflow)
    mockPatch.mockResolvedValueOnce(
      createWorkflow({ marked_comment: 'Updated notes', marked_name: 'Updated release' }),
    )
    const { result } = renderHook(() => useUpdateWorkflow(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        appId: 'app-1',
        url: '/apps/app-1/workflows/workflow-1',
        title: 'Updated release',
        releaseNotes: 'Updated notes',
      })
    })

    expect(queryClient.getQueryData(publishedWorkflowQuery.queryKey)).toBe(latestWorkflow)
  })

  it('should skip deployment caches when editing a non-workflow app version', async () => {
    const queryClient = createQueryClient()
    const oldVersion: WorkflowVersion = {
      id: 'workflow-1',
      marked_comment: 'Old notes',
      marked_name: 'Old release',
    }
    const deployment = createEnvironmentDeployment({
      currentVersion: oldVersion,
      environmentId: 'staging',
      targetVersion: oldVersion,
    })
    const cachedDeployments: ListEnvironmentDeploymentsResponse = {
      environment_deployments: [deployment],
    }
    const deploymentsQuery =
      consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions({
        input: {
          params: {
            app_id: 'app-1',
          },
        },
      })
    const publishedWorkflowQuery = appWorkflowQueryOptions('app-1')
    const updatedWorkflow = createWorkflow({
      marked_comment: 'New notes',
      marked_name: 'New release',
    })
    queryClient.setQueryData(deploymentsQuery.queryKey, cachedDeployments)
    queryClient.setQueryData(publishedWorkflowQuery.queryKey, createWorkflow())
    mockPatch.mockResolvedValueOnce(updatedWorkflow)
    const { result } = renderHook(() => useUpdateWorkflow(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        appId: 'app-1',
        appMode: AppModeEnum.CHAT,
        url: '/apps/app-1/workflows/workflow-1',
        title: 'New release',
        releaseNotes: 'New notes',
      })
    })

    expect(queryClient.getQueryData(deploymentsQuery.queryKey)).toBe(cachedDeployments)
    expect(queryClient.getQueryData(publishedWorkflowQuery.queryKey)).toEqual(updatedWorkflow)
  })

  it('should leave app deployment caches unchanged for non-app workflow updates', async () => {
    const queryClient = createQueryClient()
    const oldVersion: WorkflowVersion = {
      id: 'workflow-1',
      marked_comment: 'Old notes',
      marked_name: 'Old release',
    }
    const deployment = createEnvironmentDeployment({
      currentVersion: oldVersion,
      environmentId: 'staging',
    })
    const deploymentsQuery =
      consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions({
        input: {
          params: {
            app_id: 'app-1',
          },
        },
      })
    queryClient.setQueryData<ListEnvironmentDeploymentsResponse>(deploymentsQuery.queryKey, {
      environment_deployments: [deployment],
    })
    mockPatch.mockResolvedValueOnce(
      createWorkflow({ marked_comment: 'New notes', marked_name: 'New release' }),
    )
    const { result } = renderHook(() => useUpdateWorkflow(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        url: '/snippets/snippet-1/workflows/workflow-1',
        title: 'New release',
        releaseNotes: 'New notes',
      })
    })

    expect(
      queryClient.getQueryData<ListEnvironmentDeploymentsResponse>(deploymentsQuery.queryKey),
    ).toEqual({ environment_deployments: [deployment] })
  })
})
