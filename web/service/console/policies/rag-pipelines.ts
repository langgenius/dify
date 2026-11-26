import type { RouterUtils } from '@orpc/tanstack-query'
import type { ConsoleClient } from '../index'
import type { ConsolePolicies, ConsoleQuery } from './types'

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
                onSuccess: (_data, _variables, _result, { client }) => {
                  void client.invalidateQueries({
                    queryKey: customizedPipelineTemplatesKey(consoleQuery),
                  })
                },
              },
            },
            delete: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) => {
                  const queryKey = customizedPipelineTemplatesKey(consoleQuery)
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
      // A new pipeline dataset joins the dataset list.
      emptyDataset: {
        post: {
          mutationOptions: {
            onSuccess: (data, _variables, _result, { client }) => {
              if (!data) return
              void client.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
            },
          },
        },
      },
      dataset: {
        post: {
          mutationOptions: {
            onSuccess: (_data, _variables, _result, { client }) => {
              void client.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
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
                onSuccess: (data, { params }, _result, { client }) => {
                  if (data.status !== 'success') return
                  void client.invalidateQueries({
                    queryKey: consoleQuery.datasets.byDatasetId.get.queryKey({
                      input: { params: { dataset_id: params.dataset_id } },
                    }),
                  })
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
      // DSL import failures are reported by the import flow.
      imports: {
        post: { mutationOptions: { context: { silent: true } } },
        byImportId: {
          confirm: { post: { mutationOptions: { context: { silent: true } } } },
        },
      },
      byPipelineId: {
        customized: {
          publish: {
            post: {
              mutationOptions: {
                onSuccess: (_data, _variables, _result, { client }) => {
                  void client.invalidateQueries({
                    queryKey: customizedPipelineTemplatesKey(consoleQuery),
                  })
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
                    // A failed response can still follow an accepted stop request.
                    onSettled: (_data, _error, variables, _result, context) => {
                      return context.client.invalidateQueries({
                        queryKey: consoleQuery.rag.pipelines.byPipelineId.workflowRuns.key({
                          input: { params: { pipeline_id: variables.params.pipeline_id } },
                        }),
                      })
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
                onSuccess: (_data, variables, _result, context) =>
                  Promise.all([
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.rag.pipelines.byPipelineId.workflows.publish.get.key({
                        input: { params: variables.params },
                      }),
                    }),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.rag.pipelines.byPipelineId.workflows.get.key({
                        input: { params: variables.params },
                      }),
                    }),
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.datasets.get.key(),
                    }),
                  ]),
              },
            },
          },
          byWorkflowId: {
            patch: {
              mutationOptions: {
                onSuccess: (_data, variables, _result, context) => {
                  return Promise.all([
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.rag.pipelines.byPipelineId.workflows.get.key({
                        input: { params: { pipeline_id: variables.params.pipeline_id } },
                      }),
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
