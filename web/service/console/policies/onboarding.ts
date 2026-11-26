import type { ConsolePolicies, ConsoleQuery } from './types'

export function onboardingPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['onboarding'] {
  return {
    stepByStepTour: {
      state: {
        patch: {
          mutationOptions: {
            onSuccess: (state, _variables, _result, { client }) => {
              client.setQueryData(
                consoleQuery.onboarding.stepByStepTour.state.get.queryKey(),
                state,
              )
            },
          },
        },
      },
    },
  }
}
