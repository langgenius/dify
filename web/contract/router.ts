import { account } from '@dify/contracts/api/console/account/orpc.gen'
import { activate } from '@dify/contracts/api/console/activate/orpc.gen'
import { agent } from '@dify/contracts/api/console/agent/orpc.gen'
import { allWorkspaces } from '@dify/contracts/api/console/all-workspaces/orpc.gen'
import { apiBasedExtension } from '@dify/contracts/api/console/api-based-extension/orpc.gen'
import { apiKeyAuth } from '@dify/contracts/api/console/api-key-auth/orpc.gen'
import { appDslVersion } from '@dify/contracts/api/console/app-dsl-version/orpc.gen'
import { app } from '@dify/contracts/api/console/app/orpc.gen'
import { apps } from '@dify/contracts/api/console/apps/orpc.gen'
import { auth } from '@dify/contracts/api/console/auth/orpc.gen'
import { billing } from '@dify/contracts/api/console/billing/orpc.gen'
import { codeBasedExtension } from '@dify/contracts/api/console/code-based-extension/orpc.gen'
import { compliance } from '@dify/contracts/api/console/compliance/orpc.gen'
import { dataSource } from '@dify/contracts/api/console/data-source/orpc.gen'
import { datasets } from '@dify/contracts/api/console/datasets/orpc.gen'
import { emailCodeLogin } from '@dify/contracts/api/console/email-code-login/orpc.gen'
import { emailRegister } from '@dify/contracts/api/console/email-register/orpc.gen'
import { features } from '@dify/contracts/api/console/features/orpc.gen'
import { files } from '@dify/contracts/api/console/files/orpc.gen'
import { forgotPassword } from '@dify/contracts/api/console/forgot-password/orpc.gen'
import { form } from '@dify/contracts/api/console/form/orpc.gen'
import { info } from '@dify/contracts/api/console/info/orpc.gen'
import { installedApps } from '@dify/contracts/api/console/installed-apps/orpc.gen'
import { instructionGenerate } from '@dify/contracts/api/console/instruction-generate/orpc.gen'
import { login } from '@dify/contracts/api/console/login/orpc.gen'
import { logout } from '@dify/contracts/api/console/logout/orpc.gen'
import { notification } from '@dify/contracts/api/console/notification/orpc.gen'
import { notion } from '@dify/contracts/api/console/notion/orpc.gen'
import { oauth } from '@dify/contracts/api/console/oauth/orpc.gen'
import { rag } from '@dify/contracts/api/console/rag/orpc.gen'
import { refreshToken } from '@dify/contracts/api/console/refresh-token/orpc.gen'
import { remoteFiles } from '@dify/contracts/api/console/remote-files/orpc.gen'
import { resetPassword } from '@dify/contracts/api/console/reset-password/orpc.gen'
import { ruleCodeGenerate } from '@dify/contracts/api/console/rule-code-generate/orpc.gen'
import { ruleGenerate } from '@dify/contracts/api/console/rule-generate/orpc.gen'
import { ruleStructuredOutputGenerate } from '@dify/contracts/api/console/rule-structured-output-generate/orpc.gen'
import { spec } from '@dify/contracts/api/console/spec/orpc.gen'
import { systemFeatures } from '@dify/contracts/api/console/system-features/orpc.gen'
import { tagBindings } from '@dify/contracts/api/console/tag-bindings/orpc.gen'
import { tags } from '@dify/contracts/api/console/tags/orpc.gen'
import { test } from '@dify/contracts/api/console/test/orpc.gen'
import { trialModels } from '@dify/contracts/api/console/trial-models/orpc.gen'
import { website } from '@dify/contracts/api/console/website/orpc.gen'
import { workflowGenerate } from '@dify/contracts/api/console/workflow-generate/orpc.gen'
import { workflow } from '@dify/contracts/api/console/workflow/orpc.gen'
import { workspaces } from '@dify/contracts/api/console/workspaces/orpc.gen'
import { contract as enterpriseContract } from '@dify/contracts/enterprise/orpc.gen'
import { exploreRouterContract } from './console/explore'
import { pluginsRouterContract } from './console/plugins'
import { snippetsRouterContract } from './console/snippets'
import { triggersRouterContract } from './console/trigger'
import { trialAppsRouterContract } from './console/try-app'

const communityContract = {
  account,
  activate,
  agent,
  allWorkspaces,
  apiBasedExtension,
  apiKeyAuth,
  app,
  appDslVersion,
  apps,
  auth,
  billing,
  codeBasedExtension,
  compliance,
  dataSource,
  datasets,
  emailCodeLogin,
  emailRegister,
  features,
  files,
  forgotPassword,
  form,
  info,
  installedApps,
  instructionGenerate,
  login,
  logout,
  notification,
  notion,
  oauth,
  rag,
  refreshToken,
  remoteFiles,
  resetPassword,
  ruleCodeGenerate,
  ruleGenerate,
  ruleStructuredOutputGenerate,
  spec,
  systemFeatures,
  tagBindings,
  tags,
  test,
  trialModels,
  website,
  workflow,
  workflowGenerate,
  workspaces,
}

export const consoleRouterContract = {
  enterprise: enterpriseContract,
  ...communityContract,
  explore: exploreRouterContract,
  plugins: pluginsRouterContract,
  snippets: snippetsRouterContract,
  triggers: triggersRouterContract,
  trialApps: trialAppsRouterContract,
}
