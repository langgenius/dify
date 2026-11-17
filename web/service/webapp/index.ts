import type { contract } from '@dify/contracts/api/web/orpc.gen'
import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { TanstackQueryOperationContext } from '@orpc/tanstack-query'
import type { WebAppAddress } from '../webapp-address'
import { createORPCClient } from '@orpc/client'
import { webAppBrowserLink } from './browser'
import { createWebAppQuery } from './webapp-query'

export type WebAppClientContext = TanstackQueryOperationContext & {
  /** Pin queries to their App and include this address in their query key. */
  address?: WebAppAddress
  authSession?: number
  silent?: boolean
}

export type WebAppClient = JsonifiedClient<
  ContractRouterClient<typeof contract, WebAppClientContext>
>

export const webAppClient: WebAppClient = createORPCClient(webAppBrowserLink)
// Account-level and App-level Webapp APIs use different auth parameters; the transport handles them separately, while this layer manages queries and caching.
export const webAppQuery = createWebAppQuery(webAppClient)
