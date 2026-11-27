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
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import {
  DeploymentOperationStatus,
  DeploymentOperationType,
  EnvironmentStatus,
  OperatorType,
  RuntimeState,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { useDeleteWorkflow, useUpdateWorkflow } from '../use-workflow'
import {
  appWorkflowQueryOptions,
  appWorkflowVersionsInfiniteQueryOptions,
  lastRunQueryKey,
  lastRunQueryOptions,
  restoreWorkflowMutationOptions,
  workflowVersionHistoryInfiniteOptions,
  workflowVersionHistoryKey,
} from '../workflow-queries'

const mockWorkflowResponse = vi.hoisted(() => vi.fn())
const mockRequest = vi.hoisted(() => vi.fn<typeof import('../base').request>())

vi.mock('../base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../base')>()),
  request: (...args: Parameters<typeof import('../base').request>) => mockRequest(...args),
}))

const createWrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

const clients: QueryClient[] = []
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
})

const createQueryClient = () => {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })

  clients.push(client)
  return client
}

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
  deployment_id: `deployment-${environmentId}`,
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
    runtimeState: RuntimeState.RUNTIME_STATE_RUNNING,
  },
  environment: {
    description: `${environmentId} environment`,
    display_name: environmentId,
    id: environmentId,
    status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
  },
})

describe('generated workflow publication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('publishes a pipeline without a body, refreshes its published workflow, and declares datasets', async () => {
    mockRequest.mockReset().mockResolvedValue(Response.json({ result: 'success', created_at: 123 }))
    const queryClient = createQueryClient()
    const publishedKey = consoleQuery.rag.pipelines.byPipelineId.workflows.publish.get.queryKey({
      input: { params: { pipeline_id: 'pipeline-1' } },
    })
    const unrelatedKey = consoleQuery.rag.pipelines.byPipelineId.workflows.publish.get.queryKey({
      input: { params: { pipeline_id: 'other' } },
    })
    for (const key of [publishedKey, unrelatedKey])
      queryClient.setQueryData(key, { cached: true } as never)
    const { result } = renderHook(
      () =>
        useMutation(
          consoleQuery.rag.pipelines.byPipelineId.workflows.publish.post.mutationOptions(),
        ),
      { wrapper: createWrapper(queryClient) },
    )
    await act(async () => {
      await result.current.mutateAsync({ params: { pipeline_id: 'pipeline-1' } })
    })
    const [url, , options] = mockRequest.mock.calls[0]!
    expect(new URL(url).pathname).toBe('/console/api/rag/pipelines/pipeline-1/workflows/publish')
    expect(options?.request?.method).toBe('POST')
    expect(await options?.request?.text()).toBe('')
    expect(queryClient.getQueryState(publishedKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false)
    // Datasets refresh through the invalidation fallback.
    expect(
      consoleQuery.rag.pipelines.byPipelineId.workflows.publish.post.mutationOptions().meta
        ?.alsoInvalidate,
    ).toContain('datasets')
  })

  it('returns the server warning with the publish result', async () => {
    const published = {
      result: 'success',
      created_at: 1_710_000_100,
      warning: '"Answer" ← "Producer"',
    }
    mockRequest.mockReset().mockResolvedValue(Response.json(published))
    const queryClient = createQueryClient()
    const { result } = renderHook(
      () => useMutation(consoleQuery.apps.byAppId.workflows.publish.post.mutationOptions()),
      {
        wrapper: createWrapper(queryClient),
      },
    )

    let response: unknown
    await act(async () => {
      response = await result.current.mutateAsync({
        params: { app_id: 'app-1' },
        body: { marked_name: 'Release 1', marked_comment: 'Notes' },
      })
    })

    expect(response).toEqual(published)
    const [url, , options] = mockRequest.mock.calls[0]!
    expect(new URL(url).pathname).toBe('/console/api/apps/app-1/workflows/publish')
    expect(await options?.request?.json()).toEqual({
      marked_name: 'Release 1',
      marked_comment: 'Notes',
    })
  })
})

describe('useUpdateWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowResponse.mockResolvedValue(createWorkflow())
    mockRequest.mockImplementation(async () => Response.json(await mockWorkflowResponse()))
  })

  it.each([
    {
      resource: {
        kind: 'app',
        collaborationEnabled: false,
        appId: 'owner',
        mode: 'workflow',
      } satisfies EditorResource,
      path: '/apps/owner',
      key: (id: string) =>
        consoleQuery.apps.byAppId.workflows.get.key({ input: { params: { app_id: id } } }),
    },
    {
      resource: { kind: 'knowledge-pipeline', pipelineId: 'owner' } satisfies EditorResource,
      path: '/rag/pipelines/owner',
      key: (id: string) =>
        consoleQuery.rag.pipelines.byPipelineId.workflows.get.key({
          input: { params: { pipeline_id: id } },
        }),
    },
    {
      resource: { kind: 'snippet', snippetId: 'owner' } satisfies EditorResource,
      path: '/snippets/owner',
      key: (id: string) =>
        consoleQuery.snippets.bySnippetId.workflows.get.key({
          input: { params: { snippet_id: id } },
        }),
    },
  ])(
    'updates $resource.kind metadata and scopes list refresh to its owner',
    async ({ resource, path, key }) => {
      const queryClient = createQueryClient()
      queryClient.setQueryData(key('owner'), { cached: true })
      queryClient.setQueryData(key('other'), { cached: true })
      const { result } = renderHook(() => useUpdateWorkflow(), {
        wrapper: createWrapper(queryClient),
      })
      await act(async () => {
        await result.current.mutateAsync({
          resource,
          versionId: 'workflow-1',
          title: '',
          releaseNotes: '',
        })
      })
      const [url, , options] = mockRequest.mock.calls[0]!
      expect(new URL(url).pathname).toBe(`/console/api${path}/workflows/workflow-1`)
      expect(await options?.request?.json()).toEqual({ marked_name: '', marked_comment: '' })
      expect(queryClient.getQueryState(key('owner'))?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(key('other'))?.isInvalidated).toBe(false)
    },
  )

  it('should invalidate workflow version history after updating version information', async () => {
    const queryClient = createQueryClient()
    const editorHistoryKey = workflowVersionHistoryInfiniteOptions(
      { kind: 'app', appId: 'app-1', mode: 'workflow', collaborationEnabled: false },
      { limit: 10, namedOnly: true },
    ).queryKey
    const generatedHistoryKey = appWorkflowVersionsInfiniteQueryOptions('app-1').queryKey
    queryClient.setQueryData(editorHistoryKey, { pages: [], pageParams: [] })
    queryClient.setQueryData(generatedHistoryKey, { pages: [], pageParams: [] })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateWorkflow(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        resource: { kind: 'app', appId: 'app-1' },
        versionId: 'workflow-1',
        title: 'Release 1',
        releaseNotes: 'Notes',
      })
    })

    expect(mockRequest).toHaveBeenCalledWith(
      expect.stringContaining('/apps/app-1/workflows/workflow-1'),
      expect.anything(),
      expect.objectContaining({ request: expect.objectContaining({ method: 'PATCH' }) }),
    )
    const sentRequest = mockRequest.mock.calls[0]?.[2]?.request
    expect(await sentRequest?.json()).toEqual({ marked_name: 'Release 1', marked_comment: 'Notes' })
    expect(queryClient.getQueryState(editorHistoryKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(generatedHistoryKey)?.isInvalidated).toBe(true)
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.byAppId.workflows.get.key({
        input: { params: { app_id: 'app-1' } },
      }),
    })
  })

  it('should keep gateway-added environments on the cached version after updating it', async () => {
    const queryClient = createQueryClient()
    const editorHistoryKey = workflowVersionHistoryInfiniteOptions(
      { kind: 'app', appId: 'app-1', mode: 'workflow', collaborationEnabled: false },
      { limit: 10 },
    ).queryKey
    const environments = [{ id: 'env-1', name: 'Production' }]
    // The gateway adds `environments` on top of the contract shape.
    const deployedVersion = {
      ...createWorkflow({ id: 'workflow-1', marked_name: 'Old' }),
      environments,
    }
    queryClient.setQueryData(editorHistoryKey, {
      pages: [
        {
          items: [deployedVersion],
          has_more: false,
          limit: 10,
          page: 1,
        },
      ],
      pageParams: [1],
    })
    mockWorkflowResponse.mockResolvedValue(
      createWorkflow({ id: 'workflow-1', marked_name: 'Release 1' }),
    )
    const { result } = renderHook(() => useUpdateWorkflow(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        resource: { kind: 'app', appId: 'app-1' },
        versionId: 'workflow-1',
        title: 'Release 1',
        releaseNotes: '',
      })
    })

    expect(queryClient.getQueryData(editorHistoryKey)?.pages[0]?.items[0]).toEqual(
      expect.objectContaining({ id: 'workflow-1', marked_name: 'Release 1', environments }),
    )
  })

  it('should synchronize every cached app deployment reference to the updated workflow version', async () => {
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
      consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions({
        input: {
          params: {
            app_id: 'app-1',
          },
        },
      })
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
    mockWorkflowResponse.mockResolvedValueOnce(updatedWorkflow)
    const { result } = renderHook(() => useUpdateWorkflow(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        resource: { kind: 'app', appId: 'app-1' },
        versionId: 'workflow-1',
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
  })

  it('should keep the latest published workflow when editing an older app version', async () => {
    const queryClient = createQueryClient()
    const latestWorkflow = createWorkflow({
      id: 'workflow-2',
      marked_comment: 'Latest notes',
      marked_name: 'Latest release',
    })
    const publishedWorkflowQuery = appWorkflowQueryOptions('app-1')
    queryClient.setQueryData(publishedWorkflowQuery.queryKey, latestWorkflow)
    mockWorkflowResponse.mockResolvedValueOnce(
      createWorkflow({ marked_comment: 'Updated notes', marked_name: 'Updated release' }),
    )
    const { result } = renderHook(() => useUpdateWorkflow(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        resource: { kind: 'app', appId: 'app-1' },
        versionId: 'workflow-1',
        title: 'Updated release',
        releaseNotes: 'Updated notes',
      })
    })

    expect(queryClient.getQueryData(publishedWorkflowQuery.queryKey)).toBe(latestWorkflow)
  })

  it('should preserve deployment data referencing another workflow', async () => {
    const queryClient = createQueryClient()
    const oldVersion: WorkflowVersion = {
      id: 'workflow-other',
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
    mockWorkflowResponse.mockResolvedValueOnce(updatedWorkflow)
    const { result } = renderHook(() => useUpdateWorkflow(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        resource: { kind: 'app', appId: 'app-1' },
        versionId: 'workflow-1',
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
    mockWorkflowResponse.mockResolvedValueOnce(
      createWorkflow({ marked_comment: 'New notes', marked_name: 'New release' }),
    )
    const { result } = renderHook(() => useUpdateWorkflow(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        resource: { kind: 'snippet', snippetId: 'snippet-1' },
        versionId: 'workflow-1',
        title: 'New release',
        releaseNotes: 'New notes',
      })
    })

    expect(
      queryClient.getQueryData<ListEnvironmentDeploymentsResponse>(deploymentsQuery.queryKey),
    ).toEqual({ environment_deployments: [deployment] })
  })
})

describe('generated workflow version deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequest.mockImplementation(async () => new Response(null, { status: 204 }))
  })

  it.each([
    {
      resource: {
        kind: 'app',
        collaborationEnabled: false,
        appId: 'owner',
        mode: 'workflow',
      } satisfies EditorResource,
    },
    { resource: { kind: 'knowledge-pipeline', pipelineId: 'owner' } satisfies EditorResource },
    { resource: { kind: 'snippet', snippetId: 'owner' } satisfies EditorResource },
  ])(
    'resets cached $resource.kind version lists so they reload from the first page',
    async ({ resource }) => {
      const queryClient = createQueryClient()
      const historyKey = workflowVersionHistoryInfiniteOptions(resource, { limit: 10 }).queryKey
      const otherHistoryKey = workflowVersionHistoryInfiniteOptions(
        { kind: 'app', appId: 'other', mode: 'workflow', collaborationEnabled: false },
        { limit: 10 },
      ).queryKey
      const otherHistory = {
        pages: [
          { items: [createWorkflow({ id: 'other-1' })], has_more: false, limit: 10, page: 1 },
        ],
        pageParams: [1],
      }
      queryClient.setQueryData(otherHistoryKey, otherHistory)
      queryClient.setQueryData(historyKey, {
        pages: [
          {
            items: [createWorkflow({ id: 'workflow-1' }), createWorkflow({ id: 'workflow-2' })],
            has_more: false,
            limit: 10,
            page: 1,
          },
        ],
        pageParams: [1],
      })
      const { result } = renderHook(() => useDeleteWorkflow(resource), {
        wrapper: createWrapper(queryClient),
      })

      await act(async () => {
        await result.current('workflow-1')
      })

      // No stale pages remain, so a failed reload cannot show the deleted version or shift paging.
      expect(queryClient.getQueryData(historyKey)).toBeUndefined()
      expect(queryClient.getQueryData(otherHistoryKey)).toEqual(otherHistory)
    },
  )
})

describe('restoreWorkflowMutationOptions', () => {
  const resources = [
    {
      resource: { kind: 'app', collaborationEnabled: false, appId: 'app-1', mode: 'advanced-chat' },
      path: '/apps/app-1',
    },
    {
      resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
      path: '/rag/pipelines/pipeline-1',
    },
    { resource: { kind: 'snippet', snippetId: 'snippet-1' }, path: '/snippets/snippet-1' },
  ] satisfies { resource: EditorResource; path: string }[]

  beforeEach(() => {
    mockRequest.mockReset()
  })

  it.each(resources)(
    'restores the selected version for $resource.kind',
    async ({ resource, path }) => {
      mockRequest.mockResolvedValue(
        Response.json({ result: 'success', hash: 'restored-hash', updated_at: 1 }),
      )
      const { result } = renderHook(() => useMutation(restoreWorkflowMutationOptions(resource)), {
        wrapper: createWrapper(createQueryClient()),
      })
      await act(async () => {
        await expect(result.current.mutateAsync('version-1')).resolves.toEqual({
          result: 'success',
          hash: 'restored-hash',
          updated_at: 1,
        })
      })
      const [url, , options] = mockRequest.mock.calls[0]!
      expect(new URL(url).pathname).toBe(`/console/api${path}/workflows/version-1/restore`)
      expect(options?.request?.method).toBe('POST')
      expect(restoreWorkflowMutationOptions(resource).meta).toEqual({ errorToast: false })
    },
  )
})

describe('workflow editor cache keys', () => {
  const resources = [
    {
      resource: { kind: 'app', collaborationEnabled: false, appId: 'owner', mode: 'workflow' },
      other: { kind: 'app', collaborationEnabled: false, appId: 'other', mode: 'workflow' },
    },
    {
      resource: { kind: 'knowledge-pipeline', pipelineId: 'owner' },
      other: { kind: 'knowledge-pipeline', pipelineId: 'other' },
    },
    {
      resource: { kind: 'snippet', snippetId: 'owner' },
      other: { kind: 'snippet', snippetId: 'other' },
    },
  ] satisfies { resource: EditorResource; other: EditorResource }[]

  it.each(resources)(
    'resets every filtered $resource.kind version list without touching other owners',
    async ({ resource, other }) => {
      const queryClient = createQueryClient()
      const allVersions = workflowVersionHistoryInfiniteOptions(resource, { limit: 10 }).queryKey
      const namedVersions = workflowVersionHistoryInfiniteOptions(resource, {
        limit: 10,
        userId: 'user-1',
        namedOnly: true,
      }).queryKey
      const otherVersions = workflowVersionHistoryInfiniteOptions(other, { limit: 10 }).queryKey
      const page = { pages: [{ items: [], page: 1, limit: 10, has_more: false }], pageParams: [1] }
      for (const key of [allVersions, namedVersions, otherVersions])
        queryClient.setQueryData(key, page)

      await queryClient.resetQueries({ queryKey: workflowVersionHistoryKey(resource) })

      expect(queryClient.getQueryData(allVersions)).toBeUndefined()
      expect(queryClient.getQueryData(namedVersions)).toBeUndefined()
      expect(queryClient.getQueryData(otherVersions)).toEqual(page)
    },
  )

  it.each(resources)(
    'scopes $resource.kind last-run invalidation to one node or the whole owner',
    async ({ resource, other }) => {
      const queryClient = createQueryClient()
      const nodeA = lastRunQueryOptions(resource, 'node-a').queryKey
      const nodeB = lastRunQueryOptions(resource, 'node-b').queryKey
      const otherNode = lastRunQueryOptions(other, 'node-a').queryKey
      for (const key of [nodeA, nodeB, otherNode]) queryClient.setQueryData(key, { id: 'run' })

      await queryClient.invalidateQueries({ queryKey: lastRunQueryKey(resource, 'node-a') })
      expect(queryClient.getQueryState(nodeA)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(nodeB)?.isInvalidated).toBe(false)

      await queryClient.invalidateQueries({ queryKey: lastRunQueryKey(resource) })
      expect(queryClient.getQueryState(nodeB)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(otherNode)?.isInvalidated).toBe(false)
    },
  )
})
