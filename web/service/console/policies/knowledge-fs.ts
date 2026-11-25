import type {
  KnowledgeFsGoldenQuestionListResponse,
  KnowledgeFsSpaceListResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { RouterUtils } from '@orpc/tanstack-query'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { ConsoleClient } from '../index'
import type { ConsolePolicies, ConsoleQuery } from './types'

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
              // List cards render the same name, icon and visibility; refresh every list variant.
              void client.invalidateQueries({
                queryKey: consoleQuery.knowledgeFs.spaces.get.key(),
              })
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
          // Creating, importing or deleting questions changes the space's question list.
          post: {
            mutationOptions: {
              onSuccess: (_data, { params }, _result, { client }) =>
                invalidateGoldenQuestionList(consoleQuery, client, params.control_space_id),
            },
          },
          bulkImport: {
            post: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) =>
                  invalidateGoldenQuestionList(consoleQuery, client, params.control_space_id),
              },
            },
          },
          byQuestionId: {
            delete: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) =>
                  invalidateGoldenQuestionList(consoleQuery, client, params.control_space_id),
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
          // Queued re-index tasks change document status and the space's task list.
          reindex: {
            post: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) => {
                  const space = consoleQuery.knowledgeFs.spaces.byControlSpaceId
                  const input = { params: { control_space_id: params.control_space_id } }
                  void Promise.allSettled([
                    client.invalidateQueries({
                      queryKey: space.logicalDocuments.get.key({ input }),
                    }),
                    client.invalidateQueries({
                      queryKey: space.backgroundTasks.get.key({ input }),
                    }),
                    client.invalidateQueries({
                      queryKey: space.goldenQuestions.get.key({ input }),
                    }),
                  ])
                },
              },
            },
          },
          byDocumentId: {
            patch: {
              mutationOptions: {
                onSuccess: (_data, { params, body }, _result, { client }) => {
                  const space = consoleQuery.knowledgeFs.spaces.byControlSpaceId
                  const input = { params: { control_space_id: params.control_space_id } }
                  void client.invalidateQueries({
                    queryKey: space.logicalDocuments.byDocumentId.get.key({
                      input: { params },
                    }),
                  })
                  void client.invalidateQueries({
                    queryKey: space.logicalDocuments.get.key({ input }),
                  })
                  if ('displayName' in body.patch)
                    void client.invalidateQueries({
                      queryKey: space.goldenQuestions.get.key({ input }),
                    })
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

function invalidateGoldenQuestionList(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  controlSpaceId: string,
) {
  return client.invalidateQueries({
    queryKey: query.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.get.key({
      input: { params: { control_space_id: controlSpaceId } },
    }),
  })
}
