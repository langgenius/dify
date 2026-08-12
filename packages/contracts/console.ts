import { consoleRouterContract as generatedConsoleRouterContract } from './generated/api/console/router.gen'
import { contract as enterpriseAppDeployContract } from './generated/enterprise-app-deploy/orpc.gen'

export const consoleRouterContract = {
  ...generatedConsoleRouterContract,
  enterprise: {
    ...generatedConsoleRouterContract.enterprise,
    appDeploy: enterpriseAppDeployContract,
  },
}
