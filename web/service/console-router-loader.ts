import type { AnyContractRouter } from '@orpc/contract'
import { contractLoaders } from '@dify/contracts/api/console/orpc.gen'

type ConsoleContractExtension = Record<string, unknown>

const wrapConsoleContract = (segment: string, contract: unknown): ConsoleContractExtension => ({ [segment]: contract })

async function loadGeneratedConsoleContract(segment: string) {
  const loader = contractLoaders[segment as keyof typeof contractLoaders]
  if (!loader)
    return null

  return loader() as Promise<AnyContractRouter>
}

const customConsoleContractLoaders: Record<string, () => Promise<ConsoleContractExtension>> = {
  enterprise: () => import('@dify/contracts/enterprise/orpc.gen').then(({ contract }) => wrapConsoleContract('enterprise', contract)),
  explore: () => import('@/contract/console/explore').then(({ exploreConsoleRouterContract }) => exploreConsoleRouterContract),
  plugins: () => import('@/contract/console/plugins').then(({ pluginsConsoleRouterContract }) => pluginsConsoleRouterContract),
  snippets: () => import('@/contract/console/snippets').then(({ snippetsConsoleRouterContract }) => snippetsConsoleRouterContract),
  trialApps: () => import('@/contract/console/try-app').then(({ trialAppsConsoleRouterContract }) => trialAppsConsoleRouterContract),
}

export async function loadConsoleContractForSegment(segment: string) {
  const customContractLoader = customConsoleContractLoaders[segment]
  if (customContractLoader) {
    const customContract = await customContractLoader()
    if (Object.keys(customContract).length > 0)
      return customContract as AnyContractRouter
  }

  const generatedContract = await loadGeneratedConsoleContract(segment)
  if (generatedContract)
    return generatedContract

  throw new Error(`Console contract segment "${segment}" is not configured.`)
}
