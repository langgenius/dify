import type {
  KnowledgeFsGoldenQuestionListResponse,
  KnowledgeFsSpaceListResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { RouterUtils } from '@orpc/tanstack-query'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { ConsoleClient } from '../index'
import type { ConsolePolicies, ConsoleQuery } from './types'
import { invalidateQueryKeys } from './shared'

export function knowledgeFsPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['knowledgeFs'] {
  return {
    spaces: {
      byControlSpaceId: {
        patch: {
          mutationOptions: {
            onSuccess: async (space, { params }, _result, { client }) => {
              const queryKey = consoleQuery.knowledgeFs.spaces.byControlSpaceId.get.queryKey({
                input: { params: { control_space_id: params.control_space_id } },
              })
              await client.cancelQueries({ queryKey })
              client.setQueryData(queryKey, space)
              // Stores the detail from the response and waits for every space list variant.
              return invalidateQueryKeys(client, [consoleQuery.knowledgeFs.spaces.get.key()])
            },
          },
        },
        members: {
          put: {
            mutationOptions: {
              onSuccess: async (permissions, { params }, _result, { client }) => {
                const queryKey =
                  consoleQuery.knowledgeFs.spaces.byControlSpaceId.permissions.get.queryKey({
                    input: { params: { control_space_id: params.control_space_id } },
                  })
                await client.cancelQueries({ queryKey })
                client.setQueryData(queryKey, permissions)
              },
            },
          },
        },
        externalAccess: {
          put: {
            mutationOptions: {
              onSuccess: async (externalAccess, { params }, _result, { client }) => {
                const queryKey =
                  consoleQuery.knowledgeFs.spaces.byControlSpaceId.externalAccess.get.queryKey({
                    input: { params: { control_space_id: params.control_space_id } },
                  })
                await client.cancelQueries({ queryKey })
                client.setQueryData(queryKey, externalAccess)
              },
            },
          },
        },
        settings: {
          patch: {
            mutationOptions: {
              onSuccess: async (response, { params }, _result, { client }) => {
                const queryKey =
                  consoleQuery.knowledgeFs.spaces.byControlSpaceId.settings.get.queryKey({
                    input: { params: { control_space_id: params.control_space_id } },
                  })
                await client.cancelQueries({ queryKey })
                client.setQueryData(queryKey, response.settings)
              },
            },
          },
        },
        quality: {
          replayRuns: {
            post: {
              mutationOptions: {
                onSuccess: (run, { params }, _result, { client }) => {
                  const replayRuns =
                    consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.replayRuns
                  client.setQueryData(
                    replayRuns.byRunId.get.queryKey({
                      input: {
                        params: { control_space_id: params.control_space_id, run_id: run.id },
                      },
                    }),
                    // Polling may already hold a newer revision of the run.
                    (current) => (current && current.revision >= run.revision ? current : run),
                  )
                  void client.invalidateQueries({
                    queryKey: replayRuns.get.key({
                      input: { params: { control_space_id: params.control_space_id } },
                      type: 'infinite',
                    }),
                    refetchType: 'none',
                  })
                },
              },
            },
          },
        },
        goldenQuestions: {
          // Creating, importing or deleting questions waits for the space's question list.
          post: {
            mutationOptions: {
              onSuccess: (_data, { params }, _result, { client }) => {
                return invalidateGoldenQuestionList(consoleQuery, client, params.control_space_id)
              },
            },
          },
          bulkImport: {
            post: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) => {
                  return invalidateGoldenQuestionList(consoleQuery, client, params.control_space_id)
                },
              },
            },
          },
          byQuestionId: {
            // Bulk deletes run one mutation per question: the last pending delete of the space
            // refreshes the list once and waits for it.
            delete: {
              mutationOptions: {
                onMutate: ({ params }, { client }) => {
                  startGoldenQuestionDelete(client, params.control_space_id)
                },
                onSettled: (_data, _error, { params }, _result, { client }) => {
                  if (!finishGoldenQuestionDelete(client, params.control_space_id)) return
                  return invalidateGoldenQuestionList(consoleQuery, client, params.control_space_id)
                },
              },
            },
            patch: {
              mutationOptions: {
                onSuccess: async (question, { params }, _result, { client }) => {
                  const get = consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.get
                  const input = { params: { control_space_id: params.control_space_id } }
                  const scope = { queryKey: get.key({ input }) }
                  await client.cancelQueries(scope)
                  client.setQueriesData<InfiniteData<KnowledgeFsGoldenQuestionListResponse>>(
                    { queryKey: get.key({ input, type: 'infinite' }) },
                    (list) =>
                      list && {
                        ...list,
                        pages: list.pages.map((page) => ({
                          ...page,
                          data: page.data.map((item) =>
                            item.id === question.id ? question : item,
                          ),
                        })),
                      },
                  )
                  void client.invalidateQueries(scope)
                },
              },
            },
          },
        },
        documents: {
          // Waits for the document list (status) and the task list the queued re-index tasks
          // join; golden questions refresh in the background.
          reindex: {
            post: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) => {
                  const space = consoleQuery.knowledgeFs.spaces.byControlSpaceId
                  const input = { params: { control_space_id: params.control_space_id } }
                  void invalidateQueryKeys(client, [space.goldenQuestions.get.key({ input })])
                  return invalidateQueryKeys(client, [
                    space.logicalDocuments.get.key({ input }),
                    space.backgroundTasks.get.key({ input }),
                  ])
                },
              },
            },
          },
          byDocumentId: {
            patch: {
              mutationOptions: {
                // Waits for the document's detail and the document list; golden questions that
                // show a renamed document refresh in the background.
                onSuccess: (_data, { params, body }, _result, { client }) => {
                  const space = consoleQuery.knowledgeFs.spaces.byControlSpaceId
                  const input = { params: { control_space_id: params.control_space_id } }
                  if ('displayName' in body.patch)
                    void invalidateQueryKeys(client, [space.goldenQuestions.get.key({ input })])
                  return invalidateQueryKeys(client, [
                    space.logicalDocuments.byDocumentId.get.key({ input: { params } }),
                    space.logicalDocuments.get.key({ input }),
                  ])
                },
              },
            },
          },
        },
        fileScanPolicy: {
          put: {
            mutationOptions: {
              onSuccess: (policy, variables, _result, context) => {
                context.client.setQueryData(
                  consoleQuery.knowledgeFs.spaces.byControlSpaceId.fileScanPolicy.get.queryKey({
                    input: { params: variables.params },
                  }),
                  policy,
                )
                // Each scanner reports how many knowledge bases select it.
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.fileScan.providers.get.key(),
                })
              },
            },
          },
        },
        delete: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              context.client.setQueriesData(
                { queryKey: consoleQuery.knowledgeFs.spaces.get.key({ type: 'query' }) },
                (list: KnowledgeFsSpaceListResponse | undefined) => {
                  if (
                    !list?.data.some(
                      (item) => item.control_space_id === variables.params.control_space_id,
                    )
                  )
                    return list
                  return {
                    ...list,
                    data: list.data.filter(
                      (item) => item.control_space_id !== variables.params.control_space_id,
                    ),
                  }
                },
              )
              context.client.setQueriesData(
                { queryKey: consoleQuery.knowledgeFs.spaces.get.key({ type: 'infinite' }) },
                (list: InfiniteData<KnowledgeFsSpaceListResponse, unknown> | undefined) => {
                  if (
                    !list?.pages.some((page) =>
                      page.data.some(
                        (item) => item.control_space_id === variables.params.control_space_id,
                      ),
                    )
                  )
                    return list
                  return {
                    ...list,
                    pages: list.pages.map((page) => ({
                      ...page,
                      data: page.data.filter(
                        (item) => item.control_space_id !== variables.params.control_space_id,
                      ),
                    })),
                  }
                },
              )
              void context.client.invalidateQueries({
                queryKey: consoleQuery.knowledgeFs.spaces.get.key(),
              })
            },
          },
        },
      },
    },
  }
}

const pendingGoldenQuestionDeletes = new WeakMap<QueryClient, Map<string, number>>()

function startGoldenQuestionDelete(client: QueryClient, controlSpaceId: string) {
  const pending = pendingGoldenQuestionDeletes.get(client) ?? new Map<string, number>()
  pendingGoldenQuestionDeletes.set(client, pending)
  pending.set(controlSpaceId, (pending.get(controlSpaceId) ?? 0) + 1)
}

/** Returns true when no other delete of the space is still pending. */
function finishGoldenQuestionDelete(client: QueryClient, controlSpaceId: string) {
  const pending = pendingGoldenQuestionDeletes.get(client)
  const remaining = (pending?.get(controlSpaceId) ?? 1) - 1
  if (remaining > 0) {
    pending!.set(controlSpaceId, remaining)
    return false
  }
  pending?.delete(controlSpaceId)
  return true
}

function invalidateGoldenQuestionList(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  controlSpaceId: string,
) {
  return invalidateQueryKeys(client, [
    query.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.get.key({
      input: { params: { control_space_id: controlSpaceId } },
    }),
  ])
}
