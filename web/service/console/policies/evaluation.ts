import type { ConsolePolicies, ConsoleQuery } from './types'

export function evaluationPolicies(
  consoleQuery: ConsoleQuery,
): ConsolePolicies['byEvaluateTargetType'] {
  return {
    byEvaluateTargetId: {
      evaluation: {
        put: {
          mutationOptions: {
            onSettled: (_data, error, variables, _onMutateResult, context) => {
              if (error) return

              return context.client.invalidateQueries({
                queryKey: consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.get.key({
                  type: 'query',
                  input: { params: variables.params },
                }),
              })
            },
          },
        },
        run: {
          post: {
            mutationOptions: {
              onSettled: (_data, error, variables, _onMutateResult, context) => {
                if (error) return

                return context.client.invalidateQueries({
                  queryKey:
                    consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.logs.get.key({
                      type: 'query',
                      input: { params: variables.params },
                    }),
                })
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
                    const targetParams = {
                      evaluate_target_id: params.evaluate_target_id,
                      evaluate_target_type: params.evaluate_target_type,
                    }
                    return Promise.all([
                      context.client.invalidateQueries({
                        queryKey:
                          consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.logs.get.key(
                            {
                              type: 'query',
                              input: { params: targetParams },
                            },
                          ),
                      }),
                      context.client.invalidateQueries({
                        queryKey:
                          consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.runs.byRunId.get.key(
                            {
                              type: 'query',
                              input: { params },
                            },
                          ),
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
                    const targetParams = {
                      evaluate_target_id: params.evaluate_target_id,
                      evaluate_target_type: params.evaluate_target_type,
                    }
                    return Promise.all([
                      context.client.invalidateQueries({
                        queryKey:
                          consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.logs.get.key(
                            {
                              type: 'query',
                              input: { params: targetParams },
                            },
                          ),
                      }),
                      context.client.invalidateQueries({
                        queryKey:
                          consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.runs.byRunId.get.key(
                            {
                              type: 'query',
                              input: { params },
                            },
                          ),
                      }),
                    ])
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
