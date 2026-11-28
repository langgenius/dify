import type { RouterUtils } from '@orpc/tanstack-query'
import type { ConsoleClient } from '../index'
import type { ConsolePolicies, ConsoleQuery } from './types'
import { invalidateQueryKeys } from './shared'

export function ragPipelinePolicies(consoleQuery: ConsoleQuery): ConsolePolicies['rag'] {
  return {
    pipeline: {
      templates: {
        byTemplateId: { get: { queryOptions: { staleTime: 0 } } },
      },
      customized: {
        templates: {
          byTemplateId: {
            patch: {
              mutationOptions: {
                // Waits for the customized template list it edits.
                onSuccess: (_data, _variables, _result, { client }) => {
                  return invalidateQueryKeys(client, [customizedPipelineTemplatesKey(consoleQuery)])
                },
              },
            },
            delete: {
              mutationOptions: {
                onSuccess: async (_data, { params }, _result, { client }) => {
                  const queryKey = customizedPipelineTemplatesKey(consoleQuery)
                  if (client.isFetching({ queryKey, exact: true }))
                    await client.cancelQueries({ queryKey, exact: true })
                  client.setQueryData(
                    queryKey,
                    (current) =>
                      current && {
                        ...current,
                        pipeline_templates: current.pipeline_templates.filter(
                          (template) => template.id !== params.template_id,
                        ),
                      },
                  )
                  void client.invalidateQueries({ queryKey, exact: true })
                },
              },
            },
          },
        },
      },
      // Waits for the dataset list the new pipeline dataset joins.
      emptyDataset: {
        post: {
          mutationOptions: {
            onSuccess: (data, _variables, _result, { client }) => {
              if (!data) return
              return invalidateQueryKeys(client, [consoleQuery.datasets.get.key()])
            },
          },
        },
      },
      dataset: {
        post: {
          mutationOptions: {
            // Waits for the dataset list the new pipeline dataset joins.
            onSuccess: (_data, _variables, _result, { client }) => {
              return invalidateQueryKeys(client, [consoleQuery.datasets.get.key()])
            },
          },
        },
      },
    },
    pipelines: {
      transform: {
        datasets: {
          byDatasetId: {
            post: {
              mutationOptions: {
                // Waits for the converted dataset's detail.
                onSuccess: (data, { params }, _result, { client }) => {
                  if (data.status !== 'success') return
                  return invalidateQueryKeys(client, [
                    consoleQuery.datasets.byDatasetId.get.queryKey({
                      input: { params: { dataset_id: params.dataset_id } },
                    }),
                  ])
                },
              },
            },
          },
        },
      },
      datasourcePlugins: {
        get: {
          queryOptions: { staleTime: 0, retry: false },
        },
      },
      // DSL import failures are reported by the import flow; an import creates a dataset.
      imports: {
        post: { mutationOptions: { meta: { errorToast: false, alsoInvalidate: ['datasets'] } } },
        byImportId: {
          confirm: {
            post: {
              mutationOptions: { meta: { errorToast: false, alsoInvalidate: ['datasets'] } },
            },
          },
        },
      },
      byPipelineId: {
        customized: {
          publish: {
            post: {
              mutationOptions: {
                // Waits for the customized template list the published pipeline joins.
                onSuccess: (_data, _variables, _result, { client }) => {
                  return invalidateQueryKeys(client, [customizedPipelineTemplatesKey(consoleQuery)])
                },
              },
            },
          },
        },
        workflowRuns: {
          tasks: {
            byTaskId: {
              stop: {
                post: {
                  mutationOptions: {
                    // Waits for the pipeline's run history, also after a failed response: one can
                    // still follow an accepted stop request.
                    onSettled: (_data, _error, variables, _result, context) => {
                      return invalidateQueryKeys(context.client, [
                        consoleQuery.rag.pipelines.byPipelineId.workflowRuns.key({
                          input: { params: { pipeline_id: variables.params.pipeline_id } },
                        }),
                      ])
                    },
                  },
                },
              },
            },
          },
        },
        workflows: {
          publish: {
            post: {
              mutationOptions: {
                // Dataset cards show the pipeline's publish state.
                meta: { alsoInvalidate: ['datasets'] },
                // Waits for the published workflow and the version list.
                onSuccess: (_data, variables, _result, context) => {
                  return invalidateQueryKeys(context.client, [
                    consoleQuery.rag.pipelines.byPipelineId.workflows.publish.get.key({
                      input: { params: variables.params },
                    }),
                    consoleQuery.rag.pipelines.byPipelineId.workflows.get.key({
                      input: { params: variables.params },
                    }),
                  ])
                },
              },
            },
          },
          byWorkflowId: {
            // The version editor reopens with the name and notes from this list, and saves
            // both, so the edit waits for the reload.
            patch: {
              mutationOptions: {
                onSuccess: (_data, variables, _result, context) => {
                  return invalidateQueryKeys(context.client, [
                    consoleQuery.rag.pipelines.byPipelineId.workflows.get.key({
                      input: { params: { pipeline_id: variables.params.pipeline_id } },
                    }),
                  ])
                },
              },
            },
            delete: {
              mutationOptions: {
                // Reset the version lists so they reload from the first page: the deleted version is gone
                // even if the reload fails, and no stale page can shift the next one. Not awaited, so
                // callers can close their UI as soon as the version is deleted.
                onSuccess: (_data, variables, _result, context) => {
                  void context.client.resetQueries({
                    queryKey: consoleQuery.rag.pipelines.byPipelineId.workflows.get.key({
                      type: 'infinite',
                      input: { params: { pipeline_id: variables.params.pipeline_id } },
                    }),
                  })
                },
              },
            },
          },
          draft: {
            processing: { parameters: { get: { queryOptions: { staleTime: 0 } } } },
            preProcessing: { parameters: { get: { queryOptions: { staleTime: 0 } } } },
          },
          published: {
            processing: { parameters: { get: { queryOptions: { staleTime: 0 } } } },
            preProcessing: { parameters: { get: { queryOptions: { staleTime: 0 } } } },
          },
        },
      },
    },
  }
}

function customizedPipelineTemplatesKey(query: RouterUtils<ConsoleClient>) {
  return query.rag.pipeline.templates.get.queryKey({ input: { query: { type: 'customized' } } })
}
