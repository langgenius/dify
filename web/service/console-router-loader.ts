import type { AnyContractRouter } from '@orpc/contract'
import { contractLoaders } from '@dify/contracts/api/console/orpc.gen'

const generatedConsoleContractLoaders: Partial<Record<string, () => Promise<AnyContractRouter>>> =
  contractLoaders

async function loadGeneratedConsoleContract(segment: string) {
  const loader = generatedConsoleContractLoaders[segment]
  if (!loader) return null

  return loader()
}

async function loadEnterpriseContract(): Promise<AnyContractRouter> {
  const [{ contract: enterpriseContract }, { contract: appDeployContract }] = await Promise.all([
    import('@dify/contracts/enterprise/orpc.gen'),
    import('@dify/contracts/enterprise-app-deploy/orpc.gen'),
  ])

  return {
    enterprise: {
      ...enterpriseContract,
      appDeploy: appDeployContract,
    },
  }
}

async function loadKnowledgeFsContract(): Promise<AnyContractRouter> {
  const { contract } = await import('@dify/contracts/knowledge-fs/orpc.gen')
  return { knowledgeFs: contract }
}

export async function loadConsoleContractForSegment(segment: string) {
  if (segment === 'enterprise') return loadEnterpriseContract()
  if (segment === 'knowledgeFs') return loadKnowledgeFsContract()

  const generatedContract = await loadGeneratedConsoleContract(segment)
  if (generatedContract) return generatedContract

  throw new Error(`Console contract segment "${segment}" is not configured.`)
}
