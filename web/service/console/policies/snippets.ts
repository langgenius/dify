import type { ConsolePolicies, ConsoleQuery } from './types'
import { invalidateQueryKeys } from './shared'

export function snippetPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['snippets'] {
  return {
    bySnippetId: {
      workflowRuns: {
        tasks: {
          byTaskId: {
            stop: {
              post: {
                mutationOptions: {
                  // A failed response can still follow an accepted stop request. Waits for the
                  // run history and details the stopped run is read from.
                  onSettled: (_data, _error, variables, _result, context) =>
                    invalidateQueryKeys(context.client, [
                      consoleQuery.snippets.bySnippetId.workflowRuns.key({
                        input: { params: { snippet_id: variables.params.snippet_id } },
                      }),
                    ]),
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
                // Waits for the version list (reloaded from its first page) and the published
                // workflow the new version is read from; the draft and runs refresh in the background.
                const versions = context.client.resetQueries({
                  queryKey: consoleQuery.snippets.bySnippetId.workflows.get.key({
                    type: 'infinite',
                    input: { params: { snippet_id: variables.params.snippet_id } },
                  }),
                })
                const input = { params: { snippet_id: variables.params.snippet_id } }
                void invalidateQueryKeys(context.client, [
                  consoleQuery.snippets.bySnippetId.workflows.draft.get.key({
                    type: 'query',
                    input,
                  }),
                  consoleQuery.snippets.bySnippetId.workflowRuns.get.key({ type: 'query' }),
                  consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.lastRun.get.key({
                    type: 'query',
                  }),
                ])
                return Promise.all([
                  versions,
                  invalidateQueryKeys(context.client, [
                    consoleQuery.snippets.bySnippetId.workflows.publish.get.key({
                      type: 'query',
                      input,
                    }),
                  ]),
                ])
              },
            },
          },
        },
        byWorkflowId: {
          patch: {
            mutationOptions: {
              // The version editor reopens with the name and notes from this list, and saves
              // both, so the edit waits for the reload.
              onSuccess: (_data, variables, _result, context) => {
                return invalidateQueryKeys(context.client, [
                  consoleQuery.snippets.bySnippetId.workflows.get.key({
                    input: { params: { snippet_id: variables.params.snippet_id } },
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
                      // The composer is written from the response; waits for the roster agent
                      // list and the saved agent's detail, invite options refresh in the background.
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
                        void invalidateQueryKeys(context.client, [
                          consoleQuery.agent.inviteOptions.get.key(),
                        ])

                        const agentId =
                          composerState.binding?.binding_type === 'roster_agent'
                            ? composerState.binding.agent_id
                            : undefined
                        return invalidateQueryKeys(context.client, [
                          consoleQuery.agent.get.key(),
                          ...(agentId
                            ? [
                                consoleQuery.agent.byAgentId.get.queryKey({
                                  input: { params: { agent_id: agentId } },
                                }),
                              ]
                            : []),
                        ])
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
