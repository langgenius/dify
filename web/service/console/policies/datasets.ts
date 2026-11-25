import type {
  DatasetListResponse,
  DocumentWithSegmentsListResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { InfiniteData } from '@tanstack/react-query'
import type { ConsolePolicies, ConsoleQuery } from './types'
import { getHttpErrorStatus } from '@/service/http-error'
import { invalidateQueryKeys } from './shared'

export function datasetPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['datasets'] {
  return {
    // Process rules are read once to describe a running import.
    processRule: { get: { queryOptions: { refetchOnWindowFocus: false } } },
    byDatasetId: {
      fileScanPolicy: {
        put: {
          mutationOptions: {
            onSuccess: (policy, variables, _result, context) => {
              context.client.setQueryData(
                consoleQuery.datasets.byDatasetId.fileScanPolicy.get.queryKey({
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
              { queryKey: consoleQuery.datasets.get.key({ type: 'query' }) },
              (list: DatasetListResponse | undefined) => {
                if (!list?.data.some((item) => item.id === variables.params.dataset_id)) return list
                const total = Math.max(0, list.total - 1)
                return {
                  ...list,
                  data: list.data.filter((item) => item.id !== variables.params.dataset_id),
                  total,
                  has_more: list.page * list.limit < total,
                }
              },
            )
            context.client.setQueriesData(
              { queryKey: consoleQuery.datasets.get.key({ type: 'infinite' }) },
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
            context: { silent: true },
            // An upgrade job changes the dataset card and the list of running upgrades.
            onSuccess: (_job, _variables, _result, { client }) => {
              void client.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
              void client.invalidateQueries({
                queryKey: consoleQuery.datasets.knowledgeFsUpgradeJobs.get.key(),
              })
            },
          },
        },
        byJobId: {
          post: {
            mutationOptions: {
              onSuccess: (_job, { params }, _result, { client }) => {
                void client.invalidateQueries({
                  queryKey:
                    consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get.queryKey({
                      input: {
                        params: { dataset_id: params.dataset_id, job_id: params.job_id },
                      },
                    }),
                })
                void client.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
                void client.invalidateQueries({
                  queryKey: consoleQuery.datasets.knowledgeFsUpgradeJobs.get.key(),
                })
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
              onSettled: (_data, error, variables, _onMutateResult, context) => {
                if (error) return

                void invalidateQueryKeys(context.client, [
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
        // Creating or re-saving a document changes the dataset card, the document list and
        // the document's detail.
        post: {
          mutationOptions: {
            onSuccess: (_data, { params }, _result, { client }) => {
              const input = { params: { dataset_id: params.dataset_id } }
              void client.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
              void client.invalidateQueries({
                queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({ input }),
              })
              void client.invalidateQueries({
                queryKey: consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.key({
                  input,
                }),
              })
            },
          },
        },
        status: {
          byAction: {
            batch: {
              patch: {
                mutationOptions: {
                  onSuccess: (_data, { params }, _result, { client }) => {
                    // Enabled documents leave the auto-disabled notice.
                    if (params.action !== 'enable') return
                    void client.invalidateQueries({
                      queryKey: consoleQuery.datasets.byDatasetId.autoDisableLogs.get.queryKey({
                        input: { params: { dataset_id: params.dataset_id } },
                      }),
                    })
                  },
                },
              },
            },
          },
        },
        delete: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const documentIds = new Set(variables.query?.document_id ?? [])
              const input = { params: variables.params }
              context.client.setQueriesData(
                {
                  queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({
                    type: 'query',
                    input,
                  }),
                },
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
                onSuccess: (_data, { params }, _result, { client }) => {
                  const documents = consoleQuery.datasets.byDatasetId.documents
                  void client.invalidateQueries({
                    queryKey: documents.get.key({
                      input: { params: { dataset_id: params.dataset_id } },
                    }),
                  })
                  void client.invalidateQueries({
                    queryKey: documents.byDocumentId.get.key({ input: { params } }),
                  })
                },
              },
            },
          },
          pipelineExecutionLog: { get: { queryOptions: { staleTime: 0 } } },
        },
        // Document metadata shows in the dataset fields, the document list and each
        // document's detail.
        metadata: {
          post: {
            mutationOptions: {
              onSettled: (_data, error, variables, _result, context) => {
                if (error) return
                const params = { dataset_id: variables.params.dataset_id }
                void invalidateQueryKeys(context.client, [
                  consoleQuery.datasets.byDatasetId.metadata.get.queryKey({ input: { params } }),
                ])
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
                void invalidateQueryKeys(context.client, [
                  consoleQuery.datasets.byDatasetId.documents.get.key({ input: { params } }),
                  consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.key({
                    input: { params },
                  }),
                ])
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
                onSettled: (_data, error, variables, _result, context) => {
                  if (error) return
                  void invalidateQueryKeys(context.client, [
                    consoleQuery.datasets.byDatasetId.metadata.get.queryKey({
                      input: { params: { dataset_id: variables.params.dataset_id } },
                    }),
                  ])
                },
              },
            },
          },
        },
      },
    },
    // A dataset created with its first document joins the dataset list.
    init: {
      post: {
        mutationOptions: {
          onSuccess: (_data, _variables, _result, { client }) => {
            void client.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
          },
        },
      },
    },
    externalKnowledgeApi: {
      byExternalKnowledgeApiId: {
        delete: {
          mutationOptions: {
            onSuccess: (_data, { params }, _result, { client }) => {
              const queryKey = consoleQuery.datasets.externalKnowledgeApi.get.queryKey({
                input: {},
              })
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
          onSuccess: (_data, _variables, _onMutateResult, context) => {
            void context.client.invalidateQueries({
              queryKey: consoleQuery.datasets.apiKeys.get.key(),
            })
          },
        },
      },
      byApiKeyId: {
        delete: {
          mutationOptions: {
            onSuccess: (_data, _variables, _onMutateResult, context) => {
              void context.client.invalidateQueries({
                queryKey: consoleQuery.datasets.apiKeys.get.key(),
              })
            },
          },
        },
      },
    },
  }
}
