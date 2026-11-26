import type { ConsolePolicies, ConsoleQuery } from './types'

export function fileScanPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['fileScan'] {
  return {
    providers: {
      post: {
        mutationOptions: {
          onSettled: (_data, error, _variables, _result, context) => {
            if (error) return
            return context.client.invalidateQueries({
              queryKey: consoleQuery.fileScan.providers.get.key(),
            })
          },
        },
      },
      byProviderId: {
        patch: {
          mutationOptions: {
            onSettled: (_data, error, _variables, _result, context) => {
              if (error) return
              return context.client.invalidateQueries({
                queryKey: consoleQuery.fileScan.providers.get.key(),
              })
            },
          },
        },
        delete: {
          mutationOptions: {
            onSettled: (_data, error, _variables, _result, context) => {
              if (error) return
              return context.client.invalidateQueries({
                queryKey: consoleQuery.fileScan.providers.get.key(),
              })
            },
          },
        },
        test: {
          post: {
            // A finished check always stores a new status, including a failing one.
            mutationOptions: {
              onSettled: (_data, error, _variables, _result, context) => {
                if (error) return
                return context.client.invalidateQueries({
                  queryKey: consoleQuery.fileScan.providers.get.key(),
                })
              },
            },
          },
        },
      },
    },
  }
}
