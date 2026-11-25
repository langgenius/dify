import type { RouterUtils } from '@orpc/tanstack-query'
import type { QueryClient } from '@tanstack/react-query'
import type { ConsoleClient } from '../index'
import type { ConsolePolicies, ConsoleQuery } from './types'
import { noop } from 'es-toolkit/function'
import { getHttpErrorStatus } from '@/service/http-error'

export function accountPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['account'] {
  return {
    personalAccessTokens: {
      byTokenId: {
        delete: {
          mutationOptions: {
            onSuccess: async (_data, variables, _onMutateResult, context) => {
              context.client.removeQueries({
                queryKey: consoleQuery.account.personalAccessTokens.byTokenId.get.queryKey({
                  input: { params: variables.params },
                }),
              })
              await context.client.invalidateQueries({
                queryKey: consoleQuery.account.personalAccessTokens.get.key(),
              })
            },
          },
        },
        patch: {
          mutationOptions: {
            onError: (error, variables, _onMutateResult, context) =>
              refreshRejectedPersonalToken(
                error,
                context.client,
                variables.params.token_id,
                consoleQuery,
              ),
            onSuccess: async (_data, variables, _onMutateResult, context) => {
              await Promise.all([
                context.client.invalidateQueries({
                  queryKey: consoleQuery.account.personalAccessTokens.get.key(),
                }),
                context.client.invalidateQueries({
                  queryKey: consoleQuery.account.personalAccessTokens.byTokenId.get.queryKey({
                    input: { params: variables.params },
                  }),
                }),
              ])
            },
          },
        },
      },
      post: {
        mutationOptions: {
          onSuccess: (_data, _variables, _onMutateResult, context) => {
            void context.client
              .invalidateQueries({
                queryKey: consoleQuery.account.personalAccessTokens.get.key(),
              })
              .catch(noop)
          },
        },
      },
    },
    education: {
      get: {
        queryOptions: {
          // Passive probe: every callsite degrades to "not a student", so no toast.
          context: { silent: true },
          retry: false,
        },
      },
      post: {
        mutationOptions: {
          onSuccess: (data, _variables, _onMutateResult, context) => {
            if (data.message !== 'success') return

            void context.client.invalidateQueries({
              queryKey: consoleQuery.account.education.get.key(),
            })
            // Verified education changes the plan features.
            void context.client.invalidateQueries({
              queryKey: consoleQuery.features.get.queryKey(),
            })
          },
        },
      },
    },
    password: {
      post: {
        mutationOptions: {
          // The request alone decides success; a slow profile refresh must not hold the mutation.
          onSuccess: (_data, _variables, _onMutateResult, context) => {
            void context.client.invalidateQueries({
              queryKey: consoleQuery.account.profile.get.queryKey(),
            })
          },
        },
      },
    },
    profile: {
      patch: {
        mutationOptions: {
          onSuccess: async (_data, _variables, _onMutateResult, context) => {
            await context.client.invalidateQueries({
              queryKey: consoleQuery.account.profile.get.key(),
            })
          },
        },
      },
    },
  }
}

async function refreshRejectedPersonalToken(
  error: unknown,
  client: QueryClient,
  tokenId: string,
  query: RouterUtils<ConsoleClient>,
) {
  const status = getHttpErrorStatus(error)
  if (status !== 403 && status !== 404 && status !== 409) return
  await Promise.all([
    client.invalidateQueries({ queryKey: query.account.personalAccessTokens.get.key() }),
    client.invalidateQueries({
      queryKey: query.account.personalAccessTokens.byTokenId.get.queryKey({
        input: { params: { token_id: tokenId } },
      }),
    }),
  ])
}
