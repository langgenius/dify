import type { ClientContext, ClientLink } from '@orpc/client'
import type { AnyContractRouter } from '@orpc/contract'
import { contractLoaders } from '@dify/contracts/api/console/orpc.gen'
import { DynamicLink } from '@orpc/client'
import { getContractRouter, isContractProcedure } from '@orpc/contract'
import { parseDefinedError } from './defined-error'

const generatedConsoleContractLoaders: Partial<Record<string, () => Promise<AnyContractRouter>>> =
  contractLoaders

async function loadConsoleContractForSegment(segment: string): Promise<AnyContractRouter> {
  if (segment === 'enterprise') {
    const [{ contract: enterpriseContract }, { contract: appDeployContract }] = await Promise.all([
      import('@dify/contracts/enterprise/orpc.gen'),
      import('@dify/contracts/enterprise-app-deploy/orpc.gen'),
    ])
    return { enterprise: { ...enterpriseContract, appDeploy: appDeployContract } }
  }
  if (segment === 'knowledgeFs') {
    const { contract } = await import('@dify/contracts/knowledge-fs/orpc.gen')
    return { knowledgeFs: contract }
  }
  const loader = generatedConsoleContractLoaders[segment]
  if (!loader) throw new Error(`Console contract segment "${segment}" is not configured.`)
  return loader()
}

export function createConsoleContractLink<TContext extends ClientContext>(
  createLink: (contract: AnyContractRouter) => ClientLink<TContext>,
) {
  const routerLinkPromises = new Map<string, Promise<ClientLink<TContext>>>()

  function getRouterLink(path: readonly string[]) {
    const segment = path[0]
    if (!segment) throw new Error('Console contract path is empty.')

    let routerLinkPromise = routerLinkPromises.get(segment)
    if (!routerLinkPromise) {
      routerLinkPromise = loadConsoleContractForSegment(segment)
        .then((contract): ClientLink<TContext> => {
          const link = createLink(contract)
          return {
            async call(path, input, options) {
              try {
                return await link.call(path, input, options)
              } catch (error) {
                const procedure = getContractRouter(contract, path)
                if (isContractProcedure(procedure))
                  throw (await parseDefinedError(procedure, error)) ?? error
                throw error
              }
            },
          }
        })
        .catch((error) => {
          routerLinkPromises.delete(segment)
          throw error
        })
      routerLinkPromises.set(segment, routerLinkPromise)
    }

    return routerLinkPromise
  }

  return new DynamicLink<TContext>((_options, path) => getRouterLink(path))
}
