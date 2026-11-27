import type { MutationKey, MutationMeta, QueryKey } from '@tanstack/react-query'
import {
  InfiniteQueryObserver,
  MutationCache,
  MutationObserver,
  QueryClient,
  QueryObserver,
} from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'
import { createMutationInvalidation, domainOf } from '../mutation-invalidation'

const cleanups: Array<() => void> = []

beforeEach(() => {
  // Freshness is compared by timestamp; each step gets its own millisecond.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(1_000)
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const tick = () => vi.setSystemTime(Date.now() + 1)
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function createClient() {
  const invalidation = createMutationInvalidation()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _result, mutation) => invalidation.onMutationSuccess(mutation),
    }),
  })
  cleanups.push(invalidation.attach(client), () => client.clear())
  return client
}

/** An observed query whose fetches resolve at once with the fetch count. */
async function mountQuery(client: QueryClient, queryKey: QueryKey) {
  const queryFn = vi.fn(async () => queryFn.mock.calls.length)
  const observer = new QueryObserver(client, { queryKey, queryFn })
  cleanups.push(observer.subscribe(() => undefined))
  await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
  tick()
  return queryFn
}

type MutationSpec = {
  mutationKey?: MutationKey
  meta?: MutationMeta
  mutationFn?: () => Promise<unknown>
  onMutate?: () => unknown
  onSuccess?: () => unknown
}

function mutate(client: QueryClient, spec: MutationSpec) {
  const observer = new MutationObserver(client, { mutationFn: async () => 'ok', ...spec })
  return observer.mutate(undefined)
}

const appsListKey = () => consoleQuery.apps.get.queryKey({ input: { query: { page: 1 } } })
const appDetailKey = (): QueryKey =>
  consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } })
const datasetsListKey = () => consoleQuery.datasets.get.queryKey({ input: { query: {} } })
const membersKey = () => consoleQuery.workspaces.current.members.get.queryKey()
const featuresKey = () => consoleQuery.features.get.queryKey()
const renameApp = () => consoleQuery.apps.byAppId.put.mutationKey()

describe('domainOf', () => {
  it('uses the first segment, or the resource under workspaces.current and enterprise', () => {
    expect(domainOf(['apps', 'byAppId', 'patch'])).toBe('apps')
    expect(domainOf(['enterprise', 'appDeploy', 'deploymentService', 'deployWorkflow'])).toBe(
      'enterprise.appDeploy',
    )
    expect(domainOf(['workspaces', 'current', 'members', 'byMemberId', 'delete'])).toBe(
      'workspaces.current.members',
    )
    // A workspace id is not a resource: revoking an invitation stays with the invitations.
    expect(
      domainOf(['workspaces', 'byWorkspaceId', 'members', 'pendingInvitations', 'revoke', 'post']),
    ).toBe('workspaces.byWorkspaceId.members')
    expect(domainOf(['workspaces', 'customConfig', 'post'])).toBe('workspaces.customConfig')
  })
})

describe('mutation invalidation fallback', () => {
  it("refreshes the active queries of the mutation's domain and leaves other domains alone", async () => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())
    const appDetail = await mountQuery(client, appDetailKey())
    const datasets = await mountQuery(client, datasetsListKey())

    await mutate(client, { mutationKey: renameApp() })
    await settle()

    expect(appsList).toHaveBeenCalledTimes(2)
    expect(appDetail).toHaveBeenCalledTimes(2)
    expect(datasets).toHaveBeenCalledTimes(1)
  })

  it('does not hold the mutation until the refresh lands', async () => {
    const client = createClient()
    const refetch = createDeferred<string>()
    const queryFn = vi.fn().mockResolvedValueOnce('first').mockReturnValueOnce(refetch.promise)
    const observer = new QueryObserver(client, { queryKey: appsListKey(), queryFn })
    cleanups.push(observer.subscribe(() => undefined))
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('first'))
    tick()

    await mutate(client, { mutationKey: renameApp() })

    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(observer.getCurrentResult().data).toBe('first')
    refetch.resolve('second')
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('second'))
  })

  it('reads a query the policy wrote into again, since a patched list may not match', async () => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())

    await mutate(client, {
      mutationKey: renameApp(),
      onSuccess: () => {
        tick()
        client.setQueryData<unknown>(appsListKey() as QueryKey, 'patched row')
      },
    })
    await settle()

    expect(appsList).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(client.getQueryData(appsListKey())).toBe(2))
  })

  it('restarts an observed read already running, so its pre-write response is dropped', async () => {
    const client = createClient()
    const background = createDeferred<string>()
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockReturnValueOnce(background.promise)
      .mockResolvedValue('after write')
    const observer = new QueryObserver(client, { queryKey: appsListKey(), queryFn })
    cleanups.push(observer.subscribe(() => undefined))
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('first'))
    void observer.refetch()

    await mutate(client, { mutationKey: renameApp() })
    await settle()
    background.resolve('before write')

    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('after write'))
    expect(queryFn).toHaveBeenCalledTimes(3)
  })

  it('restarts an observed first load that started before the write', async () => {
    const client = createClient()
    const firstLoad = createDeferred<string>()
    const queryFn = vi.fn().mockReturnValueOnce(firstLoad.promise).mockResolvedValue('after write')
    // Such as the plan quota still loading while an annotation is deleted.
    const observer = new QueryObserver(client, { queryKey: appsListKey(), queryFn })
    cleanups.push(observer.subscribe(() => undefined))
    tick()

    await mutate(client, { mutationKey: renameApp() })
    await settle()
    firstLoad.resolve('before write')

    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('after write'))
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  it('leaves an unobserved read running instead of cancelling it', async () => {
    const client = createClient()
    const running = createDeferred<string>()
    const queryFn = vi.fn().mockReturnValueOnce(running.promise).mockResolvedValue('fresh')
    // An imperative read someone awaits, such as a download URL: cancelling it would lose it.
    const pending = client.query({ queryKey: appDetailKey(), queryFn })
    tick()

    await mutate(client, { mutationKey: renameApp() })
    await settle()
    running.resolve('running')

    await expect(pending).resolves.toBe('running')
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it('refetches every page of an observed infinite list, even after a page append', async () => {
    const client = createClient()
    const queryFn = vi.fn(async ({ pageParam }: { pageParam: number }) => `page ${pageParam}`)
    const observer = new InfiniteQueryObserver(client, {
      queryKey: appsListKey(),
      queryFn: queryFn as never,
      initialPageParam: 1,
      getNextPageParam: (_last: unknown, pages: unknown[]) => pages.length + 1,
    })
    cleanups.push(observer.subscribe(() => undefined))
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))

    await mutate(client, {
      mutationKey: renameApp(),
      // The user loads another page while the write's callbacks run.
      onSuccess: () => observer.fetchNextPage(),
    })
    await settle()

    // Both retained pages are read again: two loads, then a refetch of both pages.
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(4))
  })

  it('refreshes a pre-write read that returned its old data while the callbacks ran', async () => {
    const client = createClient()
    const staleRead = createDeferred<string>()
    const queryFn = vi.fn().mockReturnValueOnce(staleRead.promise).mockResolvedValue('fresh')
    const observer = new QueryObserver(client, { queryKey: appsListKey(), queryFn })
    cleanups.push(observer.subscribe(() => undefined))
    tick()

    await mutate(client, {
      mutationKey: renameApp(),
      // The read lands after the write succeeded, while a policy is still waiting.
      onSuccess: async () => {
        tick()
        staleRead.resolve('stale')
        await settle()
        tick()
      },
    })

    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('fresh'))
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  it('leaves a read the callbacks started after the success running', async () => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())
    const read = createDeferred<string>()
    const queryFn = vi.fn(() => read.promise)
    let pending: Promise<unknown> | undefined

    await mutate(client, {
      mutationKey: renameApp(),
      // An unobserved read started by a callback, like a policy's detached refresh.
      onSuccess: () => {
        tick()
        pending = client.query({ queryKey: appDetailKey(), queryFn })
      },
    })
    await settle()
    read.resolve('fresh')

    await expect(pending).resolves.toBe('fresh')
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(appsList).toHaveBeenCalledTimes(2)
  })

  it('never refreshes a query that sets meta.invalidateAfterWrites: false', async () => {
    const client = createClient()
    const queryFn = vi.fn(async () => queryFn.mock.calls.length)
    const observer = new QueryObserver(client, {
      queryKey: appsListKey(),
      queryFn,
      meta: { invalidateAfterWrites: false },
    })
    cleanups.push(observer.subscribe(() => undefined))
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
    tick()

    await mutate(client, { mutationKey: renameApp() })
    await settle()

    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it('keeps the agent preview chat history out of agent refreshes', () => {
    const options = consoleQuery.agent.byAgentId.chatMessages.get.queryOptions({
      input: { params: { agent_id: 'agent-1' }, query: { conversation_id: 'conversation-1' } },
    })
    // Defaults reach the options at runtime; their static type does not list `meta`.
    expect(
      (options as { meta?: { invalidateAfterWrites?: false } }).meta?.invalidateAfterWrites,
    ).toBe(false)
  })

  it('refreshes the domains a policy declares in alsoInvalidate', async () => {
    const client = createClient()
    const features = await mountQuery(client, featuresKey())

    await mutate(client, {
      mutationKey: consoleQuery.apps.post.mutationKey(),
      meta: { alsoInvalidate: ['features'] },
    })
    await settle()

    expect(features).toHaveBeenCalledTimes(2)
  })

  it('scopes workspaces.current writes to their own resource', async () => {
    const client = createClient()
    const members = await mountQuery(client, membersKey())
    const models = await mountQuery(
      client,
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
        input: { params: { model_type: 'llm' } },
      }),
    )

    await mutate(client, {
      mutationKey: consoleQuery.workspaces.current.members.byMemberId.delete.mutationKey(),
    })
    await settle()

    expect(members).toHaveBeenCalledTimes(2)
    expect(models).toHaveBeenCalledTimes(1)
  })

  it.each<[string, MutationSpec]>([
    [
      'opted out with meta.invalidate: false',
      { mutationKey: renameApp(), meta: { invalidate: false } },
    ],
    ['a read run as a mutation', { mutationKey: consoleQuery.apps.byAppId.get.mutationKey() }],
    ['without a console key', { mutationKey: ['tag-bindings', 'apply'] }],
    ['without a key', {}],
  ])('does nothing for a mutation %s', async (_name, spec) => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())

    await mutate(client, spec)
    await settle()

    expect(appsList).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the request fails', async () => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())

    await expect(
      mutate(client, {
        mutationKey: renameApp(),
        mutationFn: () => Promise.reject(new Error('no')),
      }),
    ).rejects.toThrow('no')
    await settle()

    expect(appsList).toHaveBeenCalledTimes(1)
  })

  it('still refreshes when a callback throws after the request succeeded', async () => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())

    await expect(
      mutate(client, {
        mutationKey: renameApp(),
        onSuccess: () => Promise.reject(new Error('refetch failed')),
      }),
    ).rejects.toThrow('refetch failed')
    await settle()

    expect(appsList).toHaveBeenCalledTimes(2)
  })

  it('waits for the last pending mutation of the domain, then refreshes once for all', async () => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())
    const features = await mountQuery(client, featuresKey())
    const second = createDeferred<string>()

    const first = mutate(client, {
      mutationKey: renameApp(),
      meta: { alsoInvalidate: ['features'] },
    })
    const pending = mutate(client, { mutationKey: renameApp(), mutationFn: () => second.promise })
    await first
    await settle()

    // A refetch now could land on the pending write's optimistic value.
    expect(appsList).toHaveBeenCalledTimes(1)
    expect(features).toHaveBeenCalledTimes(1)

    tick()
    second.resolve('ok')
    await pending
    await settle()

    expect(appsList).toHaveBeenCalledTimes(2)
    expect(features).toHaveBeenCalledTimes(2)
  })

  it('flushes the recorded refresh when the last pending sibling fails', async () => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())
    const second = createDeferred<string>()

    const first = mutate(client, { mutationKey: renameApp() })
    const pending = mutate(client, { mutationKey: renameApp(), mutationFn: () => second.promise })
    await first
    second.reject(new Error('no'))
    await expect(pending).rejects.toThrow('no')
    await settle()

    expect(appsList).toHaveBeenCalledTimes(2)
  })

  it('waits for a pending opted-out write of the domain, such as an autosave', async () => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())
    const autosave = createDeferred<string>()

    const saving = mutate(client, {
      mutationKey:
        consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.put.mutationKey(),
      meta: { invalidate: false },
      mutationFn: () => autosave.promise,
    })
    // A comment write succeeds while the autosave is pending.
    await mutate(client, { mutationKey: renameApp() })
    await settle()
    expect(appsList).toHaveBeenCalledTimes(1)

    tick()
    autosave.resolve('saved')
    await saving
    await vi.waitFor(() => expect(appsList).toHaveBeenCalledTimes(2))
  })

  it('does not wait for a pending read sent as POST', async () => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())
    const never = createDeferred<string>()

    void mutate(client, {
      mutationKey: renameApp(),
      meta: { invalidate: false, readOnly: true },
      mutationFn: () => never.promise,
    })
    await mutate(client, { mutationKey: renameApp() })
    await settle()

    expect(appsList).toHaveBeenCalledTimes(2)
  })

  it('does not wait for a pending mutation of another domain', async () => {
    const client = createClient()
    const appsList = await mountQuery(client, appsListKey())
    const never = createDeferred<string>()

    void mutate(client, {
      mutationKey: consoleQuery.datasets.post.mutationKey(),
      mutationFn: () => never.promise,
    })
    await mutate(client, { mutationKey: renameApp() })
    await settle()

    expect(appsList).toHaveBeenCalledTimes(2)
  })

  it('does not refresh after a read sent as POST, so a preview that reloads on refresh cannot loop', async () => {
    const client = createClient()
    const pipelineKey = consoleQuery.rag.pipelines.byPipelineId.workflows.publish.get.queryKey({
      input: { params: { pipeline_id: 'pipeline-1' } },
    })
    const pipeline = vi.fn(async () => pipeline.mock.calls.length)
    const preview = vi.fn(async () => ({ content: 'page' }))
    const runPreview = () =>
      new MutationObserver(
        client,
        consoleQuery.rag.pipelines.byPipelineId.workflows.published.datasource.nodes.byNodeId.preview.post.mutationOptions(
          { mutationFn: preview as never },
        ),
      )
        .mutate({ params: { pipeline_id: 'pipeline-1', node_id: 'node-1' }, body: {} } as never)
        .catch(() => undefined)
    // Like a preview panel remounted whenever the pipeline it belongs to reloads.
    const observer = new QueryObserver(client, { queryKey: pipelineKey, queryFn: pipeline })
    cleanups.push(
      observer.subscribe((result) => {
        if (result.isSuccess && !result.isFetching && preview.mock.calls.length < 5)
          void runPreview()
      }),
    )
    await vi.waitFor(() => expect(preview).toHaveBeenCalledTimes(1))
    for (let step = 0; step < 5; step++) await settle()

    expect(preview).toHaveBeenCalledTimes(1)
    expect(pipeline).toHaveBeenCalledTimes(1)
  })

  it.each([
    [true, 1],
    [false, 2],
  ])(
    'refreshes after a pipeline run only when it is not a preview (is_preview: %s)',
    async (isPreview, calls) => {
      const client = createClient()
      const published = await mountQuery(
        client,
        consoleQuery.rag.pipelines.byPipelineId.workflows.publish.get.queryKey({
          input: { params: { pipeline_id: 'pipeline-1' } },
        }),
      )

      await new MutationObserver(
        client,
        consoleQuery.rag.pipelines.byPipelineId.workflows.published.run.post.mutationOptions({
          mutationFn: async () => ({}) as never,
        }),
      ).mutate({
        params: { pipeline_id: 'pipeline-1' },
        body: { is_preview: isPreview },
      } as never)
      await settle()

      // A preview only computes chunks; refetching the pipeline would reset the edited form.
      expect(published).toHaveBeenCalledTimes(calls)
    },
  )

  it('does not refetch over the optimistic value of a newer write that cancelled the read', async () => {
    const client = createClient()
    const firstLoad = createDeferred<string>()
    const restarted = createDeferred<string>()
    const queryFn = vi
      .fn()
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(restarted.promise)
      .mockResolvedValue('server')
    // An observed first load still running when the first write succeeds.
    const observer = new QueryObserver(client, { queryKey: appDetailKey(), queryFn })
    cleanups.push(observer.subscribe(() => undefined))
    tick()
    // The first write restarts that pre-write load.
    await mutate(client, { mutationKey: renameApp() })
    await settle()
    expect(queryFn).toHaveBeenCalledTimes(2)

    // A newer write stops that read and shows its value, like a comment move.
    const second = createDeferred<string>()
    const pending = mutate(client, {
      mutationKey: renameApp(),
      mutationFn: () => second.promise,
      onMutate: async () => {
        await client.cancelQueries({ queryKey: appDetailKey() })
        client.setQueryData(appDetailKey(), 'optimistic')
      },
    })
    await settle()
    await settle()

    restarted.resolve('before the newer write')
    await settle()
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(client.getQueryData(appDetailKey())).toBe('optimistic')

    // Once it settles, its own refresh reads the server again.
    tick()
    second.resolve('ok')
    await pending
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('server'))
  })
})

describe('mutation invalidation with console policies', () => {
  it('refreshes roster agents and evaluation workflow pickers after a workflow publish', async () => {
    const client = createClient()
    const agents = await mountQuery(client, consoleQuery.agent.get.queryKey({ input: {} }))
    const evaluationWorkflows = await mountQuery(
      client,
      consoleQuery.workspaces.current.availableEvaluationWorkflows.get.queryKey({ input: {} }),
    )
    const datasets = await mountQuery(client, datasetsListKey())

    const observer = new MutationObserver(
      client,
      consoleQuery.apps.byAppId.workflows.publish.post.mutationOptions({
        mutationFn: async () => ({ result: 'success', created_at: 1 }) as never,
      }),
    )
    await observer.mutate({ params: { app_id: 'app-1' }, body: {} } as never)
    await settle()

    expect(agents).toHaveBeenCalledTimes(2)
    expect(evaluationWorkflows).toHaveBeenCalledTimes(2)
    expect(datasets).toHaveBeenCalledTimes(1)
  })

  it('reads a skill search again after a rename the policy patched into it', async () => {
    const client = createClient()
    const skill = { id: 'skill-1', display_name: 'Before', updated_at: 1 }
    const detailKey = consoleQuery.workspaces.current.skills.bySkillId.get.queryKey({
      input: { params: { skill_id: 'skill-1' } },
    })
    // A search the renamed skill may stop matching: only the server knows its rows.
    const searchKey = consoleQuery.workspaces.current.skills.get.queryKey({
      input: { query: { keyword: 'Before' } },
    })
    client.setQueryData(detailKey, skill as never)
    const search = vi.fn(async () => ({ data: search.mock.calls.length === 1 ? [skill] : [] }))
    const observer = new QueryObserver(client, { queryKey: searchKey, queryFn: search as never })
    cleanups.push(observer.subscribe(() => undefined))
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
    tick()

    await new MutationObserver(
      client,
      consoleQuery.workspaces.current.skills.bySkillId.patch.mutationOptions({
        mutationFn: async () => ({ ...skill, display_name: 'Renamed' }) as never,
      }),
    ).mutate({ params: { skill_id: 'skill-1' }, body: { display_name: 'Renamed' } } as never)

    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual({ data: [] }))
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('refetches an environment deployment read the version rename cancelled', async () => {
    const client = createClient()
    const firstLoad = createDeferred<unknown>()
    const detail = vi
      .fn()
      .mockReturnValueOnce(firstLoad.promise)
      .mockResolvedValue({ environment_deployment: { id: 'env-1' } })
    const observer = new QueryObserver(client, {
      queryKey:
        consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryKey({
          input: { params: { app_id: 'app-1', environment_id: 'env-1' } },
        }),
      queryFn: detail as never,
    })
    cleanups.push(observer.subscribe(() => undefined))
    tick()

    // The editor closes right after Save; nothing else would restart the cancelled read.
    await new MutationObserver(
      client,
      consoleQuery.apps.byAppId.workflows.byWorkflowId.patch.mutationOptions({
        mutationFn: async () => ({ id: 'workflow-1', marked_name: 'Renamed' }) as never,
      }),
    ).mutate({
      params: { app_id: 'app-1', workflow_id: 'workflow-1' },
      body: { marked_name: 'Renamed' },
    } as never)

    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
    expect(detail).toHaveBeenCalledTimes(2)
  })

  it('declares the snippet detail a snippet publish writes into', () => {
    // The publish cancels reads of the snippet detail before writing it; the fallback refetches
    // the ones it cancelled.
    expect(
      consoleQuery.snippets.bySnippetId.workflows.publish.post.mutationOptions().meta
        ?.alsoInvalidate,
    ).toContain('workspaces.current.customizedSnippets')
  })
})
