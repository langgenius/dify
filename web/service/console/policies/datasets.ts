import type {
  DatasetListResponse,
  DocumentWithSegmentsListResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { InfiniteData } from '@tanstack/react-query'
import type { ConsolePolicies, ConsoleQuery } from './types'
import { getHttpErrorStatus } from '@/service/http-error'
import { addCreatedKeyToLists, invalidateQueryKeys } from './shared'

export function datasetPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['datasets'] {
  return {
    // Process rules are read once to describe a running import.
    processRule: { get: { queryOptions: { refetchOnWindowFocus: false } } },
    byDatasetId: {
      fileScanPolicy: {
        put: {
          mutationOptions: {
            // Each scanner reports how many knowledge bases select it.
            meta: { alsoInvalidate: ['fileScan'] },
            onSuccess: async (policy, variables, _result, context) => {
              const queryKey = consoleQuery.datasets.byDatasetId.fileScanPolicy.get.queryKey({
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
            const lists = { queryKey: consoleQuery.datasets.get.key({ type: 'query' }) }
            const infiniteLists = { queryKey: consoleQuery.datasets.get.key({ type: 'infinite' }) }
            if (context.client.isFetching(lists) || context.client.isFetching(infiniteLists))
              await Promise.all([
                context.client.cancelQueries(lists),
                context.client.cancelQueries(infiniteLists),
              ])
            context.client.setQueriesData(lists, (list: DatasetListResponse | undefined) => {
              if (!list?.data.some((item) => item.id === variables.params.dataset_id)) return list
              const total = Math.max(0, list.total - 1)
              return {
                ...list,
                data: list.data.filter((item) => item.id !== variables.params.dataset_id),
                total,
                has_more: list.page * list.limit < total,
              }
            })
            context.client.setQueriesData(
              infiniteLists,
              (list: InfiniteData<DatasetListResponse, unknown> | undefined) => {
                if (
                  !list?.pages.some((page) =>
                    page.data.some((item) => item.id === variables.params.dataset_id),
                  )
                )
                  return list
                return {
                  ...list,
                  pages: list.pages.map((page) => {
                    const total = Math.max(0, page.total - 1)
                    return {
                      ...page,
                      data: page.data.filter((item) => item.id !== variables.params.dataset_id),
                      total,
                      has_more: page.page * page.limit < total,
                    }
                  }),
                }
              },
            )
            void context.client.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
          },
        },
      },
      // The upgrade dialog reports start failures, including model issues, inline.
      knowledgeFsUpgrades: {
        post: {
          mutationOptions: {
            meta: { errorToast: false },
            // Waits for the running-upgrades list the job joins.
            onSuccess: (_job, _variables, _result, { client }) =>
              invalidateQueryKeys(client, [consoleQuery.datasets.knowledgeFsUpgradeJobs.get.key()]),
          },
        },
        byJobId: {
          post: {
            mutationOptions: {
              // Waits for the job's detail and the running-upgrades list.
              onSuccess: (_job, { params }, _result, { client }) => {
                return invalidateQueryKeys(client, [
                  consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get.queryKey({
                    input: {
                      params: { dataset_id: params.dataset_id, job_id: params.job_id },
                    },
                  }),
                  consoleQuery.datasets.knowledgeFsUpgradeJobs.get.key(),
                ])
              },
            },
          },
        },
      },
      evaluation: {
        put: {
          mutationOptions: {
            onSettled: (_data, error, variables, _onMutateResult, context) => {
              if (error) return

              // The editor hydrates the whole draft from this config, so the save stays
              // pending until it lands; a later response would wipe newer edits.
              return invalidateQueryKeys(context.client, [
                consoleQuery.datasets.byDatasetId.evaluation.get.key({
                  type: 'query',
                  input: { params: variables.params },
                }),
              ])
            },
          },
        },
        run: {
          post: {
            mutationOptions: {
              // Waits for the run history the new run joins.
              onSettled: (_data, error, variables, _onMutateResult, context) => {
                if (error) return

                return invalidateQueryKeys(context.client, [
                  consoleQuery.datasets.byDatasetId.evaluation.logs.get.key({
                    type: 'query',
                    input: { params: variables.params },
                  }),
                ])
              },
            },
          },
        },
        runs: {
          byRunId: {
            cancel: {
              post: {
                mutationOptions: {
                  onSettled: (_data, error, variables, _onMutateResult, context) => {
                    if (error) return

                    const params = variables.params
                    const targetParams = { dataset_id: params.dataset_id }
                    return invalidateQueryKeys(context.client, [
                      consoleQuery.datasets.byDatasetId.evaluation.logs.get.key({
                        type: 'query',
                        input: { params: targetParams },
                      }),
                      consoleQuery.datasets.byDatasetId.evaluation.runs.byRunId.get.key({
                        type: 'query',
                        input: { params },
                      }),
                    ])
                  },
                },
              },
            },
            retry: {
              post: {
                mutationOptions: {
                  onSettled: (_data, error, variables, _onMutateResult, context) => {
                    if (error) return

                    const params = variables.params
                    const targetParams = { dataset_id: params.dataset_id }
                    return invalidateQueryKeys(context.client, [
                      consoleQuery.datasets.byDatasetId.evaluation.logs.get.key({
                        type: 'query',
                        input: { params: targetParams },
                      }),
                      consoleQuery.datasets.byDatasetId.evaluation.runs.byRunId.get.key({
                        type: 'query',
                        input: { params },
                      }),
                    ])
                  },
                },
              },
            },
          },
        },
      },
      get: {
        queryOptions: {
          // A missing or inaccessible dataset sends the detail page back to the list.
          retry: (failureCount, error) => {
            const status = getHttpErrorStatus(error)
            if (status === 403 || status === 404) return false

            return failureCount < 3
          },
        },
      },
      documents: {
        // Waits for the document list and the document's detail.
        post: {
          mutationOptions: {
            onSuccess: (_data, { params }, _result, { client }) => {
              const input = { params: { dataset_id: params.dataset_id } }
              return invalidateQueryKeys(client, [
                consoleQuery.datasets.byDatasetId.documents.get.key({ input }),
                consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.key({ input }),
              ])
            },
          },
        },
        delete: {
          mutationOptions: {
            onSuccess: async (_data, variables, _result, context) => {
              const documentIds = new Set(variables.query?.document_id ?? [])
              const input = { params: variables.params }
              const lists = {
                queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({
                  type: 'query',
                  input,
                }),
              }
              if (context.client.isFetching(lists)) await context.client.cancelQueries(lists)
              context.client.setQueriesData(
                lists,
                (list: DocumentWithSegmentsListResponse | undefined) => {
                  if (!list) return list
                  const data = list.data.filter((document) => !documentIds.has(document.id))
                  if (data.length === list.data.length) return list
                  const total = Math.max(0, list.total - (list.data.length - data.length))
                  return { ...list, data, total, has_more: list.page * list.limit < total }
                },
              )
              void context.client.invalidateQueries({
                queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({ input }),
              })
            },
          },
        },
        byDocumentId: {
          rename: {
            post: {
              mutationOptions: {
                // Waits for the document list and the renamed document's detail.
                onSuccess: (_data, { params }, _result, { client }) => {
                  const documents = consoleQuery.datasets.byDatasetId.documents
                  return invalidateQueryKeys(client, [
                    documents.get.key({ input: { params: { dataset_id: params.dataset_id } } }),
                    documents.byDocumentId.get.key({ input: { params } }),
                  ])
                },
              },
            },
          },
          pipelineExecutionLog: { get: { queryOptions: { staleTime: 0 } } },
        },
        metadata: {
          post: {
            mutationOptions: {
              onSettled: (_data, error, variables, _result, context) => {
                if (error) return
                const params = { dataset_id: variables.params.dataset_id }
                // The document panel leaves edit mode for the values in the refreshed detail,
                // and the batch editor reopens from the document list (rewriting every field
                // it holds), so saving waits for both instead of seeding the old values.
                return invalidateQueryKeys(context.client, [
                  consoleQuery.datasets.byDatasetId.documents.get.key({ input: { params } }),
                  consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.key({
                    input: { params },
                  }),
                ])
              },
            },
          },
        },
      },
      metadata: {
        post: {
          mutationOptions: {
            onSettled: (_data, error, variables, _result, context) => {
              if (error) return
              // The metadata picker returns to its list right after creating a field, so the
              // new field is there to select.
              return invalidateQueryKeys(context.client, [
                consoleQuery.datasets.byDatasetId.metadata.get.queryKey({
                  input: { params: variables.params },
                }),
              ])
            },
          },
        },
        byMetadataId: {
          patch: {
            mutationOptions: {
              onSettled: (_data, error, variables, _result, context) => {
                if (error) return
                const params = { dataset_id: variables.params.dataset_id }
                // The rename dialog reopens with the name from this list.
                return invalidateQueryKeys(context.client, [
                  consoleQuery.datasets.byDatasetId.metadata.get.queryKey({ input: { params } }),
                ])
              },
            },
          },
          delete: {
            mutationOptions: {
              onSettled: (_data, error, variables, _result, context) => {
                if (error) return
                const params = { dataset_id: variables.params.dataset_id }
                // The batch editor and the field picker read these right after a delete; a
                // stale copy would send the deleted field back and fail the whole batch.
                return invalidateQueryKeys(context.client, [
                  consoleQuery.datasets.byDatasetId.metadata.get.queryKey({ input: { params } }),
                  consoleQuery.datasets.byDatasetId.documents.get.key({ input: { params } }),
                  consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.key({
                    input: { params },
                  }),
                ])
              },
            },
          },
        },
        builtIn: {
          byAction: {
            post: {
              mutationOptions: {
                // Shows the switch's new state at once, then waits for the field list that shows
                // the built-in fields.
                onSettled: async (_data, error, { params }, _result, { client }) => {
                  if (error) return
                  const queryKey = consoleQuery.datasets.byDatasetId.metadata.get.queryKey({
                    input: { params: { dataset_id: params.dataset_id } },
                  })
                  if (client.isFetching({ queryKey, exact: true }))
                    await client.cancelQueries({ queryKey, exact: true })
                  client.setQueryData(
                    queryKey,
                    (data) =>
                      data && { ...data, built_in_field_enabled: params.action === 'enable' },
                  )
                  return invalidateQueryKeys(client, [queryKey])
                },
              },
            },
          },
        },
      },
    },
    // Waits for the dataset list the new dataset (created with its first document) joins.
    init: {
      post: {
        mutationOptions: {
          onSuccess: (_data, _variables, _result, { client }) => {
            return invalidateQueryKeys(client, [consoleQuery.datasets.get.key()])
          },
        },
      },
    },
    externalKnowledgeApi: {
      byExternalKnowledgeApiId: {
        delete: {
          mutationOptions: {
            onSuccess: async (_data, { params }, _result, { client }) => {
              const queryKey = consoleQuery.datasets.externalKnowledgeApi.get.queryKey({
                input: {},
              })
              if (client.isFetching({ queryKey, exact: true }))
                await client.cancelQueries({ queryKey, exact: true })
              client.setQueryData(
                queryKey,
                (previous) =>
                  previous && {
                    ...previous,
                    data: previous.data.filter(
                      (api) => api.id !== params.external_knowledge_api_id,
                    ),
                  },
              )
              void client.invalidateQueries({ queryKey, exact: true })
            },
          },
        },
      },
    },
    apiKeys: {
      post: {
        mutationOptions: {
          // Writes the new key into its list, so the one-time secret shows at once.
          onSuccess: async (created, _variables, _onMutateResult, context) => {
            const listKey = consoleQuery.datasets.apiKeys.get.key()
            return addCreatedKeyToLists(context.client, listKey, created)
          },
        },
      },
      byApiKeyId: {
        delete: {
          mutationOptions: {
            // Waits for the key list the deleted key leaves.
            onSuccess: (_data, _variables, _onMutateResult, context) => {
              return invalidateQueryKeys(context.client, [consoleQuery.datasets.apiKeys.get.key()])
            },
          },
        },
      },
    },
  }
}
