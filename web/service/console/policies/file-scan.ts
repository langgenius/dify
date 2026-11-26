import type { QueryClient } from '@tanstack/react-query'
import type { ConsolePolicies, ConsoleQuery } from './types'
import { invalidateQueryKeys } from './shared'

export function fileScanPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['fileScan'] {
  return {
    providers: {
      // `FileScanProvidersPage` opens its dialog with the row from this list, so saves
      // wait for it; otherwise a quick reopen saves the old settings back.
      post: {
        mutationOptions: {
          onSettled: (_data, error, _variables, _result, context) => {
            if (error) return
            return invalidateProviders(consoleQuery, context.client)
          },
        },
      },
      byProviderId: {
        patch: {
          mutationOptions: {
            onSettled: (_data, error, _variables, _result, context) => {
              if (error) return
              return invalidateProviders(consoleQuery, context.client)
            },
          },
        },
        delete: {
          mutationOptions: {
            // Waits for the scanner list it removes from.
            onSettled: (_data, error, _variables, _result, context) => {
              if (error) return
              return invalidateProviders(consoleQuery, context.client)
            },
          },
        },
        test: {
          post: {
            // A finished check always stores a new status, including a failing one.
            mutationOptions: {
              onSettled: (_data, error, _variables, _result, context) => {
                if (error) return
                // The scanner row shows the result only through the refreshed list, so its
                // Test button stays loading until the new status lands.
                return invalidateProviders(consoleQuery, context.client)
              },
            },
          },
        },
      },
    },
  }
}

function invalidateProviders(query: ConsoleQuery, client: QueryClient) {
  return invalidateQueryKeys(client, [query.fileScan.providers.get.key()])
}
