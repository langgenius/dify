import type { PersonalAccessTokenListResponse } from '@dify/contracts/api/console/account/types.gen'
import type { EmailCodeLoginPayload } from '@dify/contracts/api/console/email-code-login/types.gen'
import type { EmailRegisterResetPayload } from '@dify/contracts/api/console/email-register/types.gen'
import type { LoginPayload } from '@dify/contracts/api/console/login/types.gen'
import type { RouterUtils } from '@orpc/tanstack-query'
import type { QueryClient } from '@tanstack/react-query'
import type { ConsoleClient } from '../index'
import type { ConsolePolicies, ConsoleQuery } from './types'
import { getHttpErrorStatus } from '@/service/http-error'
import { invalidateQueryKeys } from './shared'

// Signing in replaces the account, so the redirect waits for its profile to reload from
// scratch; resetting also drops an earlier 401.
const resetProfile = (consoleQuery: ConsoleQuery, client: QueryClient) =>
  client.resetQueries({ queryKey: consoleQuery.account.profile.get.key() })

export function authPolicies(
  consoleQuery: ConsoleQuery,
): Pick<ConsolePolicies, 'login' | 'emailCodeLogin' | 'emailRegister' | 'init'> {
  const onSignedIn = {
    mutationOptions: {
      onSuccess: (
        response: { result: string },
        { body }: { body: LoginPayload | EmailCodeLoginPayload | EmailRegisterResetPayload },
        _r: unknown,
        { client }: { client: QueryClient },
      ) => {
        if (response.result !== 'success' || ('mode' in body && body.mode === 'end_user')) return
        return resetProfile(consoleQuery, client)
      },
    },
  }
  return {
    login: { post: onSignedIn },
    emailCodeLogin: { validity: { post: onSignedIn } },
    emailRegister: { post: onSignedIn },
    init: {
      post: {
        mutationOptions: {
          // The install redirect reads the finished status right away.
          onSuccess: async (_data, _variables, _result, { client }) => {
            const queryKey = consoleQuery.init.get.queryKey()
            if (client.isFetching({ queryKey, exact: true }))
              await client.cancelQueries({ queryKey, exact: true })
            client.setQueryData(queryKey, { status: 'finished' })
          },
        },
      },
    },
  }
}

export function accountPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['account'] {
  return {
    init: {
      post: {
        mutationOptions: {
          onSuccess: (_data, _variables, _result, { client }) => resetProfile(consoleQuery, client),
        },
      },
    },
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
          onSuccess: async (created, _variables, _onMutateResult, context) => {
            const { secret: _secret, ...token } = created
            if (
              context.client.isFetching({
                queryKey: consoleQuery.account.personalAccessTokens.get.key(),
              })
            )
              await context.client.cancelQueries({
                queryKey: consoleQuery.account.personalAccessTokens.get.key(),
              })
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
          // Passive probe: most callers degrade to "not a student"; verification and pricing
          // render their own error.
          meta: { errorToast: false },
          retry: false,
        },
      },
      post: {
        mutationOptions: {
          // Verified education changes the plan features.
          meta: { alsoInvalidate: ['features'] },
          // Waits for the education status.
          onSuccess: (data, _variables, _onMutateResult, context) => {
            if (data.message !== 'success') return
            return context.client.invalidateQueries({
              queryKey: consoleQuery.account.education.get.key(),
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
