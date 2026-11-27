import type { ConsolePolicies, ConsoleQuery } from './types'

export function onboardingPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['onboarding'] {
  return {
    stepByStepTour: {
      state: {
        patch: {
          mutationOptions: {
            onSuccess: async (state, _variables, _result, { client }) => {
              const queryKey = consoleQuery.onboarding.stepByStepTour.state.get.queryKey()
              if (client.isFetching({ queryKey, exact: true }))
                await client.cancelQueries({ queryKey, exact: true })
              client.setQueryData(queryKey, state)
            },
          },
        },
      },
    },
  }
}
