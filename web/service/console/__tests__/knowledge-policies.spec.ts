import type { MutationFunctionContext, QueryKey } from '@tanstack/react-query'
import type { consoleQuery as ConsoleQuery } from '@/service/console'
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'

type MutationPolicy<TVariables> = {
  onSuccess?: (
    data: never,
    variables: TVariables,
    onMutateResult: never,
    context: MutationFunctionContext,
  ) => unknown
}

const clients: QueryClient[] = []
let consoleQuery: typeof ConsoleQuery
let queryClient: QueryClient

beforeEach(async () => {
  vi.resetModules()
  vi.doMock('@/utils/client', () => ({ isClient: true, isServer: false }))
  consoleQuery = (await import('@/service/console')).consoleQuery
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(queryClient)
})

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
  vi.doUnmock('@/utils/client')
})

// Responses are opaque to most policies, so tests pass only the fields a policy reads.
const succeed = <TVariables>(
  options: MutationPolicy<TVariables>,
  data: unknown,
  variables: TVariables,
) =>
  options.onSuccess!(data as never, variables, undefined as never, {
    client: queryClient,
    meta: undefined,
  })

const seed = (...keys: QueryKey[]) => keys.forEach((key) => queryClient.setQueryData(key, {}))
const isInvalidated = (key: QueryKey) => queryClient.getQueryState(key)?.isInvalidated ?? false

describe('dataset mutation policies', () => {
  it('refreshes the dataset list and running upgrades after an upgrade starts', async () => {
    const datasets = consoleQuery.datasets.get.queryKey({ input: { query: {} } })
    const jobs = consoleQuery.datasets.knowledgeFsUpgradeJobs.get.queryKey({ input: {} })
    seed(datasets, jobs)

    await succeed(
      consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.post.mutationOptions(),
      {},
      { params: { dataset_id: 'dataset-1' }, body: {}, headers: { 'Idempotency-Key': 'key-1' } },
    )

    expect(isInvalidated(datasets)).toBe(true)
    expect(isInvalidated(jobs)).toBe(true)
  })

  it('refreshes the retried upgrade job and the lists that show it', async () => {
    const job = (job_id: string) =>
      consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get.queryKey({
        input: { params: { dataset_id: 'dataset-1', job_id } },
      })
    const datasets = consoleQuery.datasets.get.queryKey({ input: { query: {} } })
    const jobs = consoleQuery.datasets.knowledgeFsUpgradeJobs.get.queryKey({ input: {} })
    seed(job('job-1'), job('job-2'), datasets, jobs)

    await succeed(
      consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.byJobId.post.mutationOptions(),
      {},
      { params: { dataset_id: 'dataset-1', job_id: 'job-1' } },
    )

    expect(isInvalidated(job('job-1'))).toBe(true)
    expect(isInvalidated(job('job-2'))).toBe(false)
    expect(isInvalidated(datasets)).toBe(true)
    expect(isInvalidated(jobs)).toBe(true)
  })

  it('refreshes the dataset list after a dataset is created with its first document', async () => {
    const datasets = consoleQuery.datasets.get.queryKey({ input: { query: {} } })
    seed(datasets)

    await succeed(consoleQuery.datasets.init.post.mutationOptions(), {}, { body: {} as never })

    expect(isInvalidated(datasets)).toBe(true)
  })

  it('refreshes the dataset card and its documents after a document is saved', async () => {
    const datasets = consoleQuery.datasets.get.queryKey({ input: { query: {} } })
    const documents = (dataset_id: string) =>
      consoleQuery.datasets.byDatasetId.documents.get.queryKey({
        input: { params: { dataset_id }, query: { page: 1 } },
      })
    const detail = (dataset_id: string) =>
      consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.queryKey({
        input: { params: { dataset_id, document_id: 'document-1' } },
      })
    seed(
      datasets,
      documents('dataset-1'),
      documents('dataset-2'),
      detail('dataset-1'),
      detail('dataset-2'),
    )

    await succeed(
      consoleQuery.datasets.byDatasetId.documents.post.mutationOptions(),
      {},
      { params: { dataset_id: 'dataset-1' }, body: {} as never },
    )

    expect(isInvalidated(datasets)).toBe(true)
    expect(isInvalidated(documents('dataset-1'))).toBe(true)
    expect(isInvalidated(detail('dataset-1'))).toBe(true)
    expect(isInvalidated(documents('dataset-2'))).toBe(false)
    expect(isInvalidated(detail('dataset-2'))).toBe(false)
  })

  it.each([
    ['enable', true],
    ['disable', false],
  ] as const)('refreshes the auto-disabled notice after %s: %s', async (action, refreshed) => {
    const logs = consoleQuery.datasets.byDatasetId.autoDisableLogs.get.queryKey({
      input: { params: { dataset_id: 'dataset-1' } },
    })
    seed(logs)

    await succeed(
      consoleQuery.datasets.byDatasetId.documents.status.byAction.batch.patch.mutationOptions(),
      {},
      { params: { dataset_id: 'dataset-1', action }, query: { document_id: ['document-1'] } },
    )

    expect(isInvalidated(logs)).toBe(refreshed)
  })

  it('removes a deleted external knowledge API from the list and refreshes it', async () => {
    const list = consoleQuery.datasets.externalKnowledgeApi.get.queryKey({ input: {} })
    queryClient.setQueryData(list, {
      data: [{ id: 'api-1' }, { id: 'api-2' }],
    } as never)

    await succeed(
      consoleQuery.datasets.externalKnowledgeApi.byExternalKnowledgeApiId.delete.mutationOptions(),
      {},
      { params: { external_knowledge_api_id: 'api-1' } },
    )

    expect(queryClient.getQueryData(list)?.data.map((api) => api.id)).toEqual(['api-2'])
    expect(isInvalidated(list)).toBe(true)
  })
})

describe('pipeline mutation policies', () => {
  it.each(['emptyDataset', 'dataset'] as const)(
    'refreshes the dataset list after rag.pipeline.%s.post',
    async (procedure) => {
      const datasets = consoleQuery.datasets.get.queryKey({ input: { query: {} } })
      seed(datasets)

      await succeed(
        consoleQuery.rag.pipeline[procedure].post.mutationOptions(),
        { id: 'dataset-1' },
        { body: {} as never },
      )

      expect(isInvalidated(datasets)).toBe(true)
    },
  )

  it.each([
    ['success', true],
    ['failed', false],
  ] as const)(
    'refreshes the converted dataset when the conversion reports %s',
    async (status, refreshed) => {
      const detail = consoleQuery.datasets.byDatasetId.get.queryKey({
        input: { params: { dataset_id: 'dataset-1' } },
      })
      seed(detail)

      await succeed(
        consoleQuery.rag.pipelines.transform.datasets.byDatasetId.post.mutationOptions(),
        { status },
        { params: { dataset_id: 'dataset-1' } },
      )

      expect(isInvalidated(detail)).toBe(refreshed)
    },
  )

  it('refreshes customized templates after a template is edited or a pipeline is published', async () => {
    const customized = consoleQuery.rag.pipeline.templates.get.queryKey({
      input: { query: { type: 'customized' } },
    })
    const builtIn = consoleQuery.rag.pipeline.templates.get.queryKey({
      input: { query: { type: 'built-in' } },
    })
    seed(customized, builtIn)

    await succeed(
      consoleQuery.rag.pipeline.customized.templates.byTemplateId.patch.mutationOptions(),
      {},
      { params: { template_id: 'template-1' }, body: {} as never },
    )
    expect(isInvalidated(customized)).toBe(true)
    expect(isInvalidated(builtIn)).toBe(false)

    seed(customized)
    await succeed(
      consoleQuery.rag.pipelines.byPipelineId.customized.publish.post.mutationOptions(),
      {},
      { params: { pipeline_id: 'pipeline-1' }, body: {} as never },
    )
    expect(isInvalidated(customized)).toBe(true)
  })

  it('removes a deleted customized template from the list and refreshes it', async () => {
    const customized = consoleQuery.rag.pipeline.templates.get.queryKey({
      input: { query: { type: 'customized' } },
    })
    queryClient.setQueryData(customized, {
      pipeline_templates: [{ id: 'template-1' }, { id: 'template-2' }],
    } as never)

    await succeed(
      consoleQuery.rag.pipeline.customized.templates.byTemplateId.delete.mutationOptions(),
      {},
      { params: { template_id: 'template-1' } },
    )

    expect(
      queryClient.getQueryData(customized)?.pipeline_templates.map((template) => template.id),
    ).toEqual(['template-2'])
    expect(isInvalidated(customized)).toBe(true)
  })
})

describe('knowledge space mutation policies', () => {
  const space = () => consoleQuery.knowledgeFs.spaces.byControlSpaceId
  const input = (control_space_id = 'space-1') => ({ input: { params: { control_space_id } } })
  const params = { control_space_id: 'space-1' }

  it('stores a saved space and refreshes the space list', async () => {
    const list = consoleQuery.knowledgeFs.spaces.get.queryKey({ input: { query: {} } })
    seed(list)
    const saved = { control_space_id: 'space-1', name: 'Saved' }

    await succeed(space().patch.mutationOptions(), saved, { params, body: {} as never })

    expect(queryClient.getQueryData(space().get.queryKey(input()))).toEqual(saved)
    expect(isInvalidated(list)).toBe(true)
  })

  it('stores saved members, external access and settings', async () => {
    const permissions = { data: [] }
    const externalAccess = { enabled: true }
    const settings = { active_profile_revisions: {} }

    await succeed(space().members.put.mutationOptions(), permissions, { params, body: {} as never })
    await succeed(space().externalAccess.put.mutationOptions(), externalAccess, {
      params,
      body: {} as never,
    })
    await succeed(
      space().settings.patch.mutationOptions(),
      { settings },
      { params, body: {} as never },
    )

    expect(queryClient.getQueryData(space().permissions.get.queryKey(input()))).toEqual(permissions)
    expect(queryClient.getQueryData(space().externalAccess.get.queryKey(input()))).toEqual(
      externalAccess,
    )
    expect(queryClient.getQueryData(space().settings.get.queryKey(input()))).toEqual(settings)
  })

  it('stores a started evaluation run unless a newer revision is cached', async () => {
    const replayRuns = space().quality.replayRuns
    const detail = replayRuns.byRunId.get.queryKey({
      input: { params: { ...params, run_id: 'run-1' } },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const post = replayRuns.post.mutationOptions()
    const variables = { params, body: {} as never, headers: {} as never }

    await succeed(post, { id: 'run-1', revision: 2 }, variables)
    expect(queryClient.getQueryData(detail)).toEqual({ id: 'run-1', revision: 2 })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: replayRuns.get.key({ ...input(), type: 'infinite' }),
      refetchType: 'none',
    })

    await succeed(post, { id: 'run-1', revision: 1 }, variables)
    expect(queryClient.getQueryData(detail)).toEqual({ id: 'run-1', revision: 2 })
  })

  it.each([
    ['creating', () => space().goldenQuestions.post.mutationOptions()],
    ['importing', () => space().goldenQuestions.bulkImport.post.mutationOptions()],
  ] as const)('refreshes the space golden questions after %s questions', async (_, options) => {
    const questions = (control_space_id: string) =>
      space().goldenQuestions.get.queryKey({
        input: { params: { control_space_id }, query: {} },
      })
    seed(questions('space-1'), questions('space-2'))

    await succeed(
      options() as MutationPolicy<unknown>,
      {},
      {
        params: { ...params, question_id: 'question-1' },
        body: {},
      },
    )

    expect(isInvalidated(questions('space-1'))).toBe(true)
    expect(isInvalidated(questions('space-2'))).toBe(false)
  })

  it('refreshes the golden question list once after a bulk delete settles', async () => {
    const listKey = space().goldenQuestions.get.queryKey({ input: { params, query: {} } })
    const queryFn = vi.fn(async () => ({ data: [] }))
    const observer = new QueryObserver(queryClient, { queryKey: listKey, queryFn })
    const unsubscribe = observer.subscribe(() => undefined)
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))

    const deleted = Array.from({ length: 5 }, (_, index) =>
      new MutationObserver(
        queryClient,
        space().goldenQuestions.byQuestionId.delete.mutationOptions({
          mutationFn: async () => {
            await new Promise((resolve) => setTimeout(resolve, index))
            if (index === 4) throw new Error('failed')
            return {} as never
          },
        }),
      ).mutate({ params: { ...params, question_id: `question-${index}` } }),
    )
    await Promise.allSettled(deleted)
    unsubscribe()

    // One refresh for the batch, even though the last delete failed.
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  it('refreshes documents, tasks and golden questions of the re-indexed space', async () => {
    const keys = (control_space_id: string) => [
      space().logicalDocuments.get.queryKey({ input: { params: { control_space_id }, query: {} } }),
      space().backgroundTasks.get.queryKey({ input: { params: { control_space_id }, query: {} } }),
      space().goldenQuestions.get.queryKey({ input: { params: { control_space_id }, query: {} } }),
    ]
    seed(...keys('space-1'), ...keys('space-2'))

    await succeed(
      space().documents.reindex.post.mutationOptions(),
      { items: [] },
      { params, body: { documentIds: ['document-1'] } },
    )
    await vi.waitFor(() => expect(keys('space-1').map(isInvalidated)).toEqual([true, true, true]))
    expect(keys('space-2').map(isInvalidated)).toEqual([false, false, false])
  })
})
