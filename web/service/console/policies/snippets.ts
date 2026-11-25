import type { ConsolePolicies, ConsoleQuery } from './types'

export function snippetPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['snippets'] {
  return {
    bySnippetId: {
      workflowRuns: {
        tasks: {
          byTaskId: {
            stop: {
              post: {
                mutationOptions: {
                  // A failed response can still follow an accepted stop request.
                  onSettled: (_data, _error, variables, _result, context) => {
                    return context.client.invalidateQueries({
                      queryKey: consoleQuery.snippets.bySnippetId.workflowRuns.key({
                        input: { params: { snippet_id: variables.params.snippet_id } },
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
              onSuccess: (_data, variables, _onMutateResult, context) => {
                context.client.setQueryData(
                  consoleQuery.workspaces.current.customizedSnippets.bySnippetId.get.queryKey({
                    input: { params: { snippet_id: variables.params.snippet_id } },
                  }),
                  (snippet) => (snippet ? { ...snippet, is_published: true } : snippet),
                )
                // The version list reloads from its first page; the publisher does not wait.
                void context.client.resetQueries({
                  queryKey: consoleQuery.snippets.bySnippetId.workflows.get.key({
                    type: 'infinite',
                    input: { params: { snippet_id: variables.params.snippet_id } },
                  }),
                })
                return Promise.all([
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.snippets.bySnippetId.workflows.draft.get.key({
                      type: 'query',
                      input: { params: { snippet_id: variables.params.snippet_id } },
                    }),
                  }),
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.snippets.bySnippetId.workflows.publish.get.key({
                      type: 'query',
                      input: { params: { snippet_id: variables.params.snippet_id } },
                    }),
                  }),
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.snippets.bySnippetId.workflowRuns.get.key({
                      type: 'query',
                    }),
                  }),
                  context.client.invalidateQueries({
                    queryKey:
                      consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.lastRun.get.key(
                        { type: 'query' },
                      ),
                  }),
                ])
              },
            },
          },
        },
        byWorkflowId: {
          patch: {
            mutationOptions: {
              onSuccess: (_data, variables, _result, context) => {
                return Promise.all([
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.snippets.bySnippetId.workflows.get.key({
                      input: { params: { snippet_id: variables.params.snippet_id } },
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
                  queryKey: consoleQuery.snippets.bySnippetId.workflows.get.key({
                    type: 'infinite',
                    input: { params: { snippet_id: variables.params.snippet_id } },
                  }),
                })
              },
            },
          },
        },
        draft: {
          nodes: {
            byNodeId: {
              agentComposer: {
                put: {
                  mutationOptions: {
                    onSuccess: (composerState, variables, _onMutateResult, context) => {
                      context.client.setQueryData(
                        consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey(
                          {
                            input: {
                              params: variables.params,
                            },
                          },
                        ),
                        composerState,
                      )
                    },
                  },
                },
                copyFromRoster: {
                  post: {
                    mutationOptions: {
                      onSuccess: (composerState, variables, _onMutateResult, context) => {
                        context.client.setQueryData(
                          consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey(
                            {
                              input: {
                                params: variables.params,
                              },
                            },
                          ),
                          composerState,
                        )
                      },
                    },
                  },
                },
                saveToRoster: {
                  post: {
                    mutationOptions: {
                      onSuccess: (composerState, variables, _onMutateResult, context) => {
                        context.client.setQueryData(
                          consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey(
                            {
                              input: {
                                params: variables.params,
                              },
                            },
                          ),
                          composerState,
                        )
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.agent.get.key(),
                        })
                        context.client.invalidateQueries({
                          queryKey: consoleQuery.agent.inviteOptions.get.key(),
                        })

                        const agentId =
                          composerState.binding?.binding_type === 'roster_agent'
                            ? composerState.binding.agent_id
                            : undefined
                        if (agentId) {
                          context.client.invalidateQueries({
                            queryKey: consoleQuery.agent.byAgentId.get.queryKey({
                              input: {
                                params: {
                                  agent_id: agentId,
                                },
                              },
                            }),
                          })
                        }
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }
}
