import type { ResourceAccessTokenListResponse } from '@dify/contracts/api/console/resource-access-tokens/types.gen'
import type { ConsolePolicies, ConsoleQuery } from './types'

export function resourceAccessTokenPolicies(
  consoleQuery: ConsoleQuery,
): ConsolePolicies['resourceAccessTokens'] {
  return {
    post: {
      mutationOptions: {
        onSettled: (_data, error, _variables, _result, context) => {
          if (error) return
          void context.client.invalidateQueries({
            queryKey: consoleQuery.resourceAccessTokens.get.key(),
          })
        },
      },
    },
    byTokenId: {
      patch: {
        mutationOptions: {
          onSettled: (_data, error, _variables, _result, context) => {
            if (error) return
            void context.client.invalidateQueries({
              queryKey: consoleQuery.resourceAccessTokens.get.key(),
            })
          },
        },
      },
      relations: {
        byRelationId: {
          delete: {
            mutationOptions: {
              networkMode: 'always',
              onSettled: async (_data, error, { params }, _result, { client }) => {
                if (error) return
                const queryKey = consoleQuery.resourceAccessTokens.get.key()
                await client.cancelQueries({ queryKey })
                client.setQueriesData<ResourceAccessTokenListResponse>({ queryKey }, (current) => {
                  if (!current?.data.some((row) => row.token_id === params.token_id)) return current

                  return {
                    ...current,
                    data: current.data.filter((row) => row.token_id !== params.token_id),
                    total: Math.max(0, current.total - 1),
                  }
                })
                void client.invalidateQueries({ queryKey })
              },
            },
          },
        },
      },
    },
  }
}
