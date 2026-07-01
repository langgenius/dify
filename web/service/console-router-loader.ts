import type { AnyContractRouter } from '@orpc/contract'
import { contractLoaders } from '@dify/contracts/api/console/orpc.gen'

const wrapConsoleContract = (segment: string, contract: unknown) => ({ [segment]: contract }) as AnyContractRouter

async function loadGeneratedConsoleContract(segment: string) {
  const loader = contractLoaders[segment as keyof typeof contractLoaders]
  if (!loader)
    return null

  return loader() as Promise<AnyContractRouter>
}

const customConsoleContractLoaders: Record<string, () => Promise<AnyContractRouter>> = {
  enterprise: () => import('@dify/contracts/enterprise/orpc.gen').then(({ contract }) => wrapConsoleContract('enterprise', contract)),
  explore: () => import('@/contract/console/explore').then(({ exploreRouterContract }) => wrapConsoleContract('explore', exploreRouterContract)),
  modelProviders: () =>
    import('@/contract/console/model-providers').then(({ modelProvidersRouterContract }) => wrapConsoleContract('modelProviders', modelProvidersRouterContract)),
  plugins: () => import('@/contract/console/plugins').then(({ pluginsRouterContract }) => wrapConsoleContract('plugins', pluginsRouterContract)),
  rbacAccessConfig: () =>
    import('@/contract/console/access-control').then(({ rbacAccessConfigContract }) => wrapConsoleContract('rbacAccessConfig', rbacAccessConfigContract)),
  triggers: () => import('@/contract/console/trigger').then(({ triggersRouterContract }) => wrapConsoleContract('triggers', triggersRouterContract)),
  trialApps: () => import('@/contract/console/try-app').then(({ trialAppsRouterContract }) => wrapConsoleContract('trialApps', trialAppsRouterContract)),
}

export async function loadConsoleContractForSegment(segment: string) {
  const customContractLoader = customConsoleContractLoaders[segment]
  if (customContractLoader)
    return customContractLoader()

  const generatedContract = await loadGeneratedConsoleContract(segment)
  if (generatedContract)
    return generatedContract

  throw new Error(`Console contract segment "${segment}" is not configured.`)
}
