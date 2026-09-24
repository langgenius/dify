import { consoleRouterContract as generatedConsoleRouterContract } from './generated/api/console/router.gen.ts'
import { contract as enterpriseAppDeployContract } from './generated/enterprise-app-deploy/orpc.gen.ts'
import { contract as knowledgeFsContract } from './generated/knowledge-fs/orpc.gen.ts'

export const consoleRouterContract = {
  ...generatedConsoleRouterContract,
  enterprise: {
    ...generatedConsoleRouterContract.enterprise,
    appDeploy: enterpriseAppDeployContract,
  },
  knowledgeFs: knowledgeFsContract,
}
