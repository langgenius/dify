import type { consoleQuery } from '@/service/console'
import { withConsoleResponses } from '@/test/console/service-responses'

/** Supply only operation results; generated options and Query observers stay real. */
export function withTokenResponses(
  query: typeof consoleQuery,
  respond: (operation: string, input: never) => unknown,
) {
  const operations = [
    'account.personalAccessTokens.get',
    'account.personalAccessTokens.post',
    'account.personalAccessTokens.byTokenId.get',
    'account.personalAccessTokens.byTokenId.delete',
    'account.personalAccessTokenResources.get',
    'account.personalAccessTokenWorkspaces.get',
  ]
  return withConsoleResponses(
    query,
    Object.fromEntries(
      operations.map((operation) => [operation, (input: never) => respond(operation, input)]),
    ),
  )
}
