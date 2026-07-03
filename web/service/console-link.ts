import type { ClientContext, ClientLink } from '@orpc/client'
import type { AnyContractRouter } from '@orpc/contract'
import { DynamicLink } from '@orpc/client'
import { loadConsoleContractForSegment } from './console-router-loader'

export function createConsoleDynamicLink<TContext extends ClientContext>(
  createLink: (contract: AnyContractRouter) => ClientLink<TContext>,
) {
  const routerLinkPromises = new Map<string, Promise<ClientLink<TContext>>>()

  function getRouterLink(path: readonly string[]) {
    const segment = path[0]
    if (!segment)
      throw new Error('Console contract path is empty.')

    let routerLinkPromise = routerLinkPromises.get(segment)
    if (!routerLinkPromise) {
      routerLinkPromise = loadConsoleContractForSegment(segment).then(createLink).catch((error) => {
        routerLinkPromises.delete(segment)
        throw error
      })
      routerLinkPromises.set(segment, routerLinkPromise)
    }

    return routerLinkPromise
  }

  return new DynamicLink<TContext>((_options, path) => getRouterLink(path))
}
