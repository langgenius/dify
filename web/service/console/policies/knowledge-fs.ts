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
              if (client.isFetching({ queryKey })) await client.cancelQueries({ queryKey })
              client.setQueryData(queryKey, space)
              // Stores the detail from the response and waits for every space list variant.
              return invalidateQueryKeys(client, [consoleQuery.knowledgeFs.spaces.get.key()])
            },
          },
        },
        // The card keeps the submitted tags until the knowledge lists and the tag counts reload,
        // also after a rejected replacement, which may still have been applied.
        tags: {
          put: {
            mutationOptions: {
              onSettled: (_data, _error, _variables, _result, { client }) =>
                invalidateQueryKeys(client, [
                  consoleQuery.knowledgeFs.spaces.get.key(),
                  consoleQuery.tags.get.key({
                    type: 'query',
                    input: { query: { type: 'knowledge' } },
                  }),
                ]),
            },
          },
        },
        // Waits for the field list and the documents that show the fields' values.
        metadata: {
          post: {
            mutationOptions: {
              onSuccess: (_data, { params }, _result, { client }) =>
                invalidateMetadataQueries(consoleQuery, client, params.control_space_id),
            },
          },
          byFieldId: {
            patch: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) =>
                  invalidateMetadataQueries(consoleQuery, client, params.control_space_id),
              },
            },
            delete: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) =>
                  invalidateMetadataQueries(consoleQuery, client, params.control_space_id),
              },
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
                if (client.isFetching({ queryKey })) await client.cancelQueries({ queryKey })
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
                if (client.isFetching({ queryKey })) await client.cancelQueries({ queryKey })
                client.setQueryData(queryKey, externalAccess)
              },
            },
          },
        },
        tidy: {
          settings: {
            patch: {
              mutationOptions: {
                onSuccess: (_data, _variables, _result, { client }) =>
                  invalidateTidyQueries(consoleQuery, client),
              },
            },
          },
          retry: {
            post: {
              mutationOptions: {
                onSuccess: (_data, _variables, _result, { client }) =>
                  invalidateTidyQueries(consoleQuery, client),
              },
            },
          },
          findings: {
            byFindingId: {
              actions: {
                post: {
                  mutationOptions: {
                    onSuccess: (_data, _variables, _result, { client }) =>
                      invalidateTidyQueries(consoleQuery, client),
                  },
                },
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
                if (client.isFetching({ queryKey })) await client.cancelQueries({ queryKey })
                client.setQueryData(queryKey, response.settings)
              },
            },
          },
        },
        quality: {
          badCases: {
            byBadCaseId: {
              patch: {
                mutationOptions: {
                  // Waits for the bad-case list, so a dismissed case leaves it before the row
                  // stops pending.
                  onSuccess: (_data, { params }, _result, { client }) =>
                    invalidateQueryKeys(client, [
                      consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.badCases.get.key({
                        input: { params: { control_space_id: params.control_space_id } },
                      }),
                    ]),
                },
              },
            },
          },
          replayRuns: {
            post: {
              mutationOptions: {
                onSuccess: async (run, { params }, _result, { client }) => {
                  const replayRuns =
                    consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.replayRuns
                  const queryKey = replayRuns.byRunId.get.queryKey({
                    input: {
                      params: { control_space_id: params.control_space_id, run_id: run.id },
                    },
                  })
                  if (client.isFetching({ queryKey, exact: true }))
                    await client.cancelQueries({ queryKey, exact: true })
                  client.setQueryData(
                    queryKey,
                    // Polling may already hold a newer revision of the run.
                    (current) => (current && current.revision >= run.revision ? current : run),
                  )
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
                  if (client.isFetching(scope)) await client.cancelQueries(scope)
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
          // join.
          reindex: {
            post: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) => {
                  const space = consoleQuery.knowledgeFs.spaces.byControlSpaceId
                  const input = { params: { control_space_id: params.control_space_id } }
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
                // Waits for the document's detail and the document list.
                onSuccess: (_data, { params }, _result, { client }) => {
                  const space = consoleQuery.knowledgeFs.spaces.byControlSpaceId
                  const input = { params: { control_space_id: params.control_space_id } }
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
              // Each scanner reports how many knowledge bases select it.
              meta: { alsoInvalidate: ['fileScan'] },
              onSuccess: async (policy, variables, _result, context) => {
                const queryKey =
                  consoleQuery.knowledgeFs.spaces.byControlSpaceId.fileScanPolicy.get.queryKey({
                    input: { params: variables.params },
                  })
                if (context.client.isFetching({ queryKey, exact: true }))
                  await context.client.cancelQueries({ queryKey, exact: true })
                context.client.setQueryData(queryKey, policy)
              },
            },
          },
        },
        delete: {
          mutationOptions: {
            onSuccess: async (_data, variables, _result, context) => {
              const lists = { queryKey: consoleQuery.knowledgeFs.spaces.get.key({ type: 'query' }) }
              const infiniteLists = {
                queryKey: consoleQuery.knowledgeFs.spaces.get.key({ type: 'infinite' }),
              }
              if (context.client.isFetching(lists) || context.client.isFetching(infiniteLists))
                await Promise.all([
                  context.client.cancelQueries(lists),
                  context.client.cancelQueries(infiniteLists),
                ])
              context.client.setQueriesData(
                lists,
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
                infiniteLists,
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

/** A review action can disable a document, so document lists and the overview follow. */
function invalidateTidyQueries(query: RouterUtils<ConsoleClient>, client: QueryClient) {
  return invalidateQueryKeys(client, [
    query.knowledgeFs.spaces.byControlSpaceId.tidy.key(),
    query.knowledgeFs.spaces.byControlSpaceId.documents.key(),
    query.knowledgeFs.spaces.byControlSpaceId.overview.key(),
  ])
}

function invalidateMetadataQueries(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  controlSpaceId: string,
) {
  const space = query.knowledgeFs.spaces.byControlSpaceId
  const input = { params: { control_space_id: controlSpaceId } }
  return invalidateQueryKeys(client, [
    space.metadata.get.key({ input }),
    space.logicalDocuments.get.key({ input }),
  ])
}
