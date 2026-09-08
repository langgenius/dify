import type { consoleRouterContract } from '@dify/contracts/console'
import type { ClientLink } from '@orpc/client'
import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { TanstackQueryOperationContext } from '@orpc/tanstack-query'
import { createORPCClient, DynamicLink } from '@orpc/client'
import { consoleBrowserLink } from './browser'
import { createConsoleQuery } from './query-policies'

export type ConsoleClientContext = TanstackQueryOperationContext & {
  keepalive?: boolean
  silent?: boolean
}

export type ConsoleClient = JsonifiedClient<
  ContractRouterClient<typeof consoleRouterContract, ConsoleClientContext>
>

declare global {
  var $consoleServerLink: ClientLink<ConsoleClientContext> | undefined
}

const consoleLink = new DynamicLink<ConsoleClientContext>(() => {
  if (typeof window === 'undefined') {
    if (!globalThis.$consoleServerLink)
      throw new Error(
        'Console server transport is not registered. Import @/service/console/server at the server entrypoint.',
      )
    return globalThis.$consoleServerLink
  }
  return consoleBrowserLink
})

export const consoleClient: ConsoleClient = createORPCClient(consoleLink)
export const consoleQuery = createConsoleQuery(consoleClient)
