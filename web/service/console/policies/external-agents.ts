import type { ConsolePolicies, ConsoleQuery } from './types'
import { refreshAgentTagCatalogs } from './shared'

export function externalAgentPolicies(
  consoleQuery: ConsoleQuery,
): Pick<ConsolePolicies, 'externalAgents' | 'externalAgentTests' | 'externalAgentInvocations'> {
  return {
    externalAgents: {
      post: {
        mutationOptions: {
          retry: false,
          onSettled: async (_data, _error, _variables, _onMutateResult, context) => {
            await context.client.invalidateQueries({
              queryKey: consoleQuery.externalAgents.get.key(),
            })
          },
        },
      },
      verify: { post: { mutationOptions: { retry: false, gcTime: 0 } } },
      byAgentId: {
        get: { queryOptions: { retry: false } },
        info: {
          patch: {
            mutationOptions: {
              retry: false,
              onSettled: async (_data, _error, variables, _onMutateResult, context) => {
                await Promise.all([
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.externalAgents.get.key(),
                  }),
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.externalAgents.byAgentId.get.queryKey({
                      input: { params: variables.params },
                    }),
                  }),
                ])
              },
            },
          },
        },
        connection: {
          put: {
            mutationOptions: {
              retry: false,
              onSettled: async (_data, _error, variables, _onMutateResult, context) => {
                await Promise.all([
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.externalAgents.get.key(),
                  }),
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.externalAgents.byAgentId.get.queryKey({
                      input: { params: variables.params },
                    }),
                  }),
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.externalAgents.byAgentId.references.get.queryKey({
                      input: { params: variables.params },
                    }),
                  }),
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.externalAgents.capabilities.get.queryKey({
                      input: { query: { agent_id: variables.params.agent_id } },
                    }),
                  }),
                ])
              },
            },
          },
        },
        enabled: {
          put: {
            mutationOptions: {
              retry: false,
              onSettled: async (_data, _error, variables, _onMutateResult, context) => {
                await Promise.all([
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.externalAgents.get.key(),
                  }),
                  context.client.invalidateQueries({
                    queryKey: consoleQuery.externalAgents.byAgentId.get.queryKey({
                      input: { params: variables.params },
                    }),
                  }),
                ])
              },
            },
          },
        },
        tracing: {
          put: {
            mutationOptions: {
              retry: false,
              onSettled: async (_data, _error, variables, _onMutateResult, context) => {
                await context.client.invalidateQueries({
                  queryKey: consoleQuery.externalAgents.byAgentId.get.queryKey({
                    input: { params: variables.params },
                  }),
                })
              },
            },
          },
        },
        delete: {
          mutationOptions: {
            retry: false,
            onSettled: async (_data, error, variables, _onMutateResult, context) => {
              const refetchType = error ? 'active' : 'none'
              await Promise.all([
                context.client.invalidateQueries({
                  queryKey: consoleQuery.externalAgents.get.key(),
                }),
                refreshAgentTagCatalogs(consoleQuery, context.client),
                context.client.invalidateQueries({
                  queryKey: consoleQuery.externalAgents.byAgentId.get.queryKey({
                    input: { params: variables.params },
                  }),
                  refetchType,
                }),
                context.client.invalidateQueries({
                  queryKey: consoleQuery.externalAgents.byAgentId.references.get.queryKey({
                    input: { params: variables.params },
                  }),
                  refetchType,
                }),
              ])
            },
          },
        },
        tests: {
          post: { mutationOptions: { retry: false, gcTime: 0 } },
          byInvocationId: {
            get: { queryOptions: { retry: false, gcTime: 0 } },
            cancel: { post: { mutationOptions: { retry: false } } },
          },
        },
        testFiles: {
          post: { mutationOptions: { retry: false } },
          pasteLink: { post: { mutationOptions: { retry: false } } },
          byLeaseId: { delete: { mutationOptions: { retry: false } } },
        },
        tracingConfig: {
          byProvider: {
            put: {
              mutationOptions: {
                retry: false,
                onSettled: async (_data, _error, _variables, _onMutateResult, context) => {
                  await context.client.invalidateQueries({
                    queryKey: consoleQuery.externalAgents.byAgentId.tracingConfig.key(),
                  })
                },
              },
            },
            delete: {
              mutationOptions: {
                retry: false,
                onSettled: async (_data, _error, _variables, _onMutateResult, context) => {
                  await context.client.invalidateQueries({
                    queryKey: consoleQuery.externalAgents.byAgentId.tracingConfig.key(),
                  })
                },
              },
            },
          },
        },
      },
    },
    externalAgentTests: { leavePage: { post: { mutationOptions: { retry: false } } } },
    externalAgentInvocations: {
      byInvocationId: {
        trace: {
          get: { queryOptions: { retry: false, gcTime: 0 } },
          steps: { byStepKey: { get: { queryOptions: { retry: false, gcTime: 0 } } } },
        },
      },
    },
  }
}
