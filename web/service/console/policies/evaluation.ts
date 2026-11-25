import type { ConsolePolicies, ConsoleQuery } from './types'
import { invalidateQueryKeys } from './shared'

// Callers report a run, cancel, or retry from the response, so the run history reloads
// without holding the action pending. A config save waits for its reload (see below).
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

              // The editor hydrates the whole draft from this config, so the save stays
              // pending until it lands; a later response would wipe newer edits.
              return invalidateQueryKeys(context.client, [
                consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.get.key({
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
                  consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.logs.get.key({
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
                    const targetParams = {
                      evaluate_target_id: params.evaluate_target_id,
                      evaluate_target_type: params.evaluate_target_type,
                    }
                    void invalidateQueryKeys(context.client, [
                      consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.logs.get.key({
                        type: 'query',
                        input: { params: targetParams },
                      }),
                      consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.runs.byRunId.get.key(
                        {
                          type: 'query',
                          input: { params },
                        },
                      ),
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
                    void invalidateQueryKeys(context.client, [
                      consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.logs.get.key({
                        type: 'query',
                        input: { params: targetParams },
                      }),
                      consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.runs.byRunId.get.key(
                        {
                          type: 'query',
                          input: { params },
                        },
                      ),
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
