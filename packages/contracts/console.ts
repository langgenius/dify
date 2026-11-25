import { consoleRouterContract as generatedConsoleRouterContract } from './generated/api/console/router.gen.ts'
import { contract as enterpriseAppDeployContract } from './generated/enterprise-app-deploy/orpc.gen.ts'
import { consoleSsoContract } from './sso.ts'

export const consoleRouterContract = {
  ...generatedConsoleRouterContract,
  enterprise: {
    ...generatedConsoleRouterContract.enterprise,
    // The generated console SSO routes take no input, so they cannot send the invite token.
    consoleSso: consoleSsoContract,
    appDeploy: enterpriseAppDeployContract,
  },
}
