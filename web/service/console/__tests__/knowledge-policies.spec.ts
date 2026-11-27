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

// Starts a read of `queryKey` that answers with `data` only when the returned function is called.
const startRead = (queryKey: QueryKey, data: unknown) => {
  let respond: ((value: unknown) => void) | undefined
  const read = queryClient
    .query({
      queryKey,
      queryFn: () =>
        new Promise((resolve) => {
          respond = resolve
        }),
    })
    .catch(() => undefined)
  return async () => {
    respond?.(data)
    await read
  }
}

describe('dataset mutation policies', () => {
  it('refreshes the running upgrades after an upgrade starts', async () => {
    const datasets = consoleQuery.datasets.get.queryKey({ input: { query: {} } })
    const jobs = consoleQuery.datasets.knowledgeFsUpgradeJobs.get.queryKey({ input: {} })
    seed(datasets, jobs)

    await succeed(
      consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.post.mutationOptions(),
      {},
      { params: { dataset_id: 'dataset-1' }, body: {}, headers: { 'Idempotency-Key': 'key-1' } },
    )

    // Dataset cards refresh with the invalidation fallback.
    expect(isInvalidated(datasets)).toBe(false)
    expect(isInvalidated(jobs)).toBe(true)
  })

  it('refreshes the retried upgrade job and the running upgrades', async () => {
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
    expect(isInvalidated(datasets)).toBe(false)
    expect(isInvalidated(jobs)).toBe(true)
  })

  it('refreshes the dataset list after a dataset is created with its first document', async () => {
    const datasets = consoleQuery.datasets.get.queryKey({ input: { query: {} } })
    seed(datasets)

    await succeed(consoleQuery.datasets.init.post.mutationOptions(), {}, { body: {} as never })

    expect(isInvalidated(datasets)).toBe(true)
  })

  it('refreshes the documents of the dataset a document is saved to', async () => {
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

    expect(isInvalidated(datasets)).toBe(false)
    expect(isInvalidated(documents('dataset-1'))).toBe(true)
    expect(isInvalidated(detail('dataset-1'))).toBe(true)
    expect(isInvalidated(documents('dataset-2'))).toBe(false)
    expect(isInvalidated(detail('dataset-2'))).toBe(false)
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

  it('keeps a deleted external knowledge API out of the list a pre-delete read returns', async () => {
    const list = consoleQuery.datasets.externalKnowledgeApi.get.queryKey({ input: {} })
    const before = { data: [{ id: 'api-1' }, { id: 'api-2' }] }
    queryClient.setQueryData(list, before as never)
    const finishRead = startRead(list, before)

    await succeed(
      consoleQuery.datasets.externalKnowledgeApi.byExternalKnowledgeApiId.delete.mutationOptions(),
      {},
      { params: { external_knowledge_api_id: 'api-1' } },
    )
    await finishRead()

    expect(queryClient.getQueryData(list)?.data.map((api) => api.id)).toEqual(['api-2'])
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

  it.each([
    ['a DSL import', () => consoleQuery.rag.pipelines.imports.post.mutationOptions()],
    [
      'a confirmed DSL import',
      () => consoleQuery.rag.pipelines.imports.byImportId.confirm.post.mutationOptions(),
    ],
    [
      'a published pipeline',
      () => consoleQuery.rag.pipelines.byPipelineId.workflows.publish.post.mutationOptions(),
    ],
  ])('declares the dataset lists for the invalidation fallback after %s', (_, options) => {
    expect(options().meta?.alsoInvalidate).toEqual(['datasets'])
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

  it('keeps a deleted customized template out of the list a pre-delete read returns', async () => {
    const customized = consoleQuery.rag.pipeline.templates.get.queryKey({
      input: { query: { type: 'customized' } },
    })
    const before = { pipeline_templates: [{ id: 'template-1' }, { id: 'template-2' }] }
    queryClient.setQueryData(customized, before as never)
    const finishRead = startRead(customized, before)

    await succeed(
      consoleQuery.rag.pipeline.customized.templates.byTemplateId.delete.mutationOptions(),
      {},
      { params: { template_id: 'template-1' } },
    )
    await finishRead()

    expect(
      queryClient.getQueryData(customized)?.pipeline_templates.map((template) => template.id),
    ).toEqual(['template-2'])
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
    const post = replayRuns.post.mutationOptions()
    const variables = { params, body: {} as never, headers: {} as never }

    await succeed(post, { id: 'run-1', revision: 2 }, variables)
    expect(queryClient.getQueryData(detail)).toEqual({ id: 'run-1', revision: 2 })

    await succeed(post, { id: 'run-1', revision: 1 }, variables)
    expect(queryClient.getQueryData(detail)).toEqual({ id: 'run-1', revision: 2 })
  })

  it('keeps a saved file scan policy over a read that started before the save', async () => {
    const policy = space().fileScanPolicy.get.queryKey(input())
    const finishRead = startRead(policy, { scanner_ids: [] })
    const saved = { scanner_ids: ['scanner-1'] }

    await succeed(space().fileScanPolicy.put.mutationOptions(), saved, {
      params,
      body: {} as never,
    })
    await finishRead()

    expect(queryClient.getQueryData(policy)).toEqual(saved)
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

  it('refreshes the documents and tasks of the re-indexed space', async () => {
    const keys = (control_space_id: string) => [
      space().logicalDocuments.get.queryKey({ input: { params: { control_space_id }, query: {} } }),
      space().backgroundTasks.get.queryKey({ input: { params: { control_space_id }, query: {} } }),
    ]
    const golden = space().goldenQuestions.get.queryKey({
      input: { params: { control_space_id: 'space-1' }, query: {} },
    })
    seed(...keys('space-1'), ...keys('space-2'), golden)

    await succeed(
      space().documents.reindex.post.mutationOptions(),
      { items: [] },
      { params, body: { documentIds: ['document-1'] } },
    )
    expect(keys('space-1').map(isInvalidated)).toEqual([true, true])
    expect(keys('space-2').map(isInvalidated)).toEqual([false, false])
    // Golden questions refresh with the invalidation fallback.
    expect(isInvalidated(golden)).toBe(false)
  })

  it('declares the scanner list for the invalidation fallback after a file scan policy is saved', () => {
    expect(space().fileScanPolicy.put.mutationOptions().meta?.alsoInvalidate).toEqual(['fileScan'])
    expect(
      consoleQuery.datasets.byDatasetId.fileScanPolicy.put.mutationOptions().meta?.alsoInvalidate,
    ).toEqual(['fileScan'])
  })

  it.each([
    ['created', () => space().metadata.post.mutationOptions(), { body: {} }],
    [
      'renamed',
      () => space().metadata.byFieldId.patch.mutationOptions(),
      { params: { ...params, field_id: 'field-1' }, body: {} },
    ],
    [
      'deleted',
      () => space().metadata.byFieldId.delete.mutationOptions(),
      { params: { ...params, field_id: 'field-1' } },
    ],
  ])(
    'waits for the field list and the documents after a field is %s',
    async (_, options, extra) => {
      const keys = (control_space_id: string) => [
        space().metadata.get.queryKey({ input: { params: { control_space_id }, query: {} } }),
        space().logicalDocuments.get.queryKey({
          input: { params: { control_space_id }, query: {} },
        }),
      ]
      seed(...keys('space-1'), ...keys('space-2'))

      await succeed(options() as MutationPolicy<unknown>, {}, { params, ...extra })

      expect(keys('space-1').map(isInvalidated)).toEqual([true, true])
      expect(keys('space-2').map(isInvalidated)).toEqual([false, false])
    },
  )

  it('waits for the bad-case list after a bad case is updated', async () => {
    const list = (control_space_id: string) =>
      space().quality.badCases.get.key({
        input: { params: { control_space_id }, query: {} },
        type: 'infinite',
      })
    seed(list('space-1'), list('space-2'))

    await succeed(
      space().quality.badCases.byBadCaseId.patch.mutationOptions(),
      {},
      {
        params: { ...params, bad_case_id: 'case-1' },
        body: {} as never,
      },
    )

    expect(isInvalidated(list('space-1'))).toBe(true)
    expect(isInvalidated(list('space-2'))).toBe(false)
  })

  it.each([
    ['succeeds', null],
    ['fails', new Error('failed')],
  ])('waits for the space lists and tag counts when a tag replacement %s', async (_, error) => {
    const spaces = consoleQuery.knowledgeFs.spaces.get.queryKey({ input: { query: {} } })
    const knowledgeTags = consoleQuery.tags.get.queryKey({
      input: { query: { type: 'knowledge' } },
    })
    const appTags = consoleQuery.tags.get.queryKey({ input: { query: { type: 'app' } } })
    seed(spaces, knowledgeTags, appTags)

    await space().tags.put.mutationOptions().onSettled!(
      undefined as never,
      error,
      { params, body: { tag_ids: [] } },
      undefined as never,
      { client: queryClient, meta: undefined },
    )

    expect(isInvalidated(spaces)).toBe(true)
    expect(isInvalidated(knowledgeTags)).toBe(true)
    expect(isInvalidated(appTags)).toBe(false)
  })
})
