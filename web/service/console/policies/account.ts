import type { PersonalAccessTokenListResponse } from '@dify/contracts/api/console/account/types.gen'
import type { RouterUtils } from '@orpc/tanstack-query'
import type { QueryClient } from '@tanstack/react-query'
import type { ConsoleClient } from '../index'
import type { ConsolePolicies, ConsoleQuery } from './types'
import { getHttpErrorStatus } from '@/service/http-error'
import { invalidateQueryKeys } from './shared'

export function accountPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['account'] {
  return {
    personalAccessTokens: {
      byTokenId: {
        delete: {
          mutationOptions: {
            // Drops the token's detail and waits for the token list it leaves.
            onSuccess: (_data, variables, _onMutateResult, context) => {
              context.client.removeQueries({
                queryKey: consoleQuery.account.personalAccessTokens.byTokenId.get.queryKey({
                  input: { params: variables.params },
                }),
              })
              return invalidateQueryKeys(context.client, [
                consoleQuery.account.personalAccessTokens.get.key(),
              ])
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
            onSuccess: (_data, variables, _onMutateResult, context) => {
              void invalidateQueryKeys(context.client, [
                consoleQuery.account.personalAccessTokens.get.key(),
              ])
              // The edit form seeds its next draft and version from this detail, and closing it
              // would cancel an unfinished refetch, so the save waits for the new version.
              return invalidateQueryKeys(context.client, [
                consoleQuery.account.personalAccessTokens.byTokenId.get.queryKey({
                  input: { params: variables.params },
                }),
              ])
            },
          },
        },
      },
      post: {
        mutationOptions: {
          // The dialog shows the one-time secret as soon as the create resolves, so the new
          // token is written into the cached lists instead of waiting for their refetch.
          onSuccess: (created, _variables, _onMutateResult, context) => {
            const { secret: _secret, ...token } = created
            context.client.setQueriesData<PersonalAccessTokenListResponse>(
              { queryKey: consoleQuery.account.personalAccessTokens.get.key() },
              (list) =>
                list && list.page === 1 && !list.data.some((row) => row.id === token.id)
                  ? { ...list, data: [token, ...list.data], total: list.total + 1 }
                  : list,
            )
            void invalidateQueryKeys(context.client, [
              consoleQuery.account.personalAccessTokens.get.key(),
            ])
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

            // Verified education changes the plan features, which refresh in the background;
            // the save waits for the education status.
            void context.client.invalidateQueries({
              queryKey: consoleQuery.features.get.queryKey(),
            })
            return context.client.invalidateQueries({
              queryKey: consoleQuery.account.education.get.key(),
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
          // The preference page shows the saved timezone from the refreshed profile and stays
          // read-only until it lands, so the picker does not flip back to the old value.
          onSuccess: (_data, _variables, _onMutateResult, context) =>
            invalidateQueryKeys(context.client, [consoleQuery.account.profile.get.key()]),
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
  void invalidateQueryKeys(client, [query.account.personalAccessTokens.get.key()])
  // The edit form keeps Save disabled while pending, then blocks it once the refreshed
  // detail reports the token as expired or gone.
  await invalidateQueryKeys(client, [
    query.account.personalAccessTokens.byTokenId.get.queryKey({
      input: { params: { token_id: tokenId } },
    }),
  ])
}
