import { account } from '@dify/contracts/api/console/account/orpc.gen'
import { activate } from '@dify/contracts/api/console/activate/orpc.gen'
import { allWorkspaces } from '@dify/contracts/api/console/all-workspaces/orpc.gen'
import { apiBasedExtension } from '@dify/contracts/api/console/api-based-extension/orpc.gen'
import { apiKeyAuth } from '@dify/contracts/api/console/api-key-auth/orpc.gen'
import { appDslVersion } from '@dify/contracts/api/console/app-dsl-version/orpc.gen'
import { app } from '@dify/contracts/api/console/app/orpc.gen'
import { auth } from '@dify/contracts/api/console/auth/orpc.gen'
import { codeBasedExtension } from '@dify/contracts/api/console/code-based-extension/orpc.gen'
import { compliance } from '@dify/contracts/api/console/compliance/orpc.gen'
import { dataSource } from '@dify/contracts/api/console/data-source/orpc.gen'
import { datasets } from '@dify/contracts/api/console/datasets/orpc.gen'
import { emailCodeLogin } from '@dify/contracts/api/console/email-code-login/orpc.gen'
import { emailRegister } from '@dify/contracts/api/console/email-register/orpc.gen'
import { features } from '@dify/contracts/api/console/features/orpc.gen'
import { forgotPassword } from '@dify/contracts/api/console/forgot-password/orpc.gen'
import { form } from '@dify/contracts/api/console/form/orpc.gen'
import { info } from '@dify/contracts/api/console/info/orpc.gen'
import { installedApps } from '@dify/contracts/api/console/installed-apps/orpc.gen'
import { instructionGenerate } from '@dify/contracts/api/console/instruction-generate/orpc.gen'
import { login } from '@dify/contracts/api/console/login/orpc.gen'
import { logout } from '@dify/contracts/api/console/logout/orpc.gen'
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
import { test } from '@dify/contracts/api/console/test/orpc.gen'
import { trialModels } from '@dify/contracts/api/console/trial-models/orpc.gen'
import { website } from '@dify/contracts/api/console/website/orpc.gen'
import { workflowGenerate } from '@dify/contracts/api/console/workflow-generate/orpc.gen'
import { workflow } from '@dify/contracts/api/console/workflow/orpc.gen'
import { contract as enterpriseContract } from '@dify/contracts/enterprise/orpc.gen'
import { rbacAccessConfigContract } from './console/access-control'
import { agentRouterContract } from './console/agent'
import { appsRouterContract } from './console/apps'
import { billingRouterContract } from './console/billing'
import { exploreRouterContract } from './console/explore'
import { filesRouterContract } from './console/files'
import { modelProvidersRouterContract } from './console/model-providers'
import { notificationContract, notificationDismissContract } from './console/notification'
import { pluginsRouterContract } from './console/plugins'
import { snippetsRouterContract } from './console/snippets'
import { tagsRouterContract } from './console/tags'
import { triggersRouterContract } from './console/trigger'
import { trialAppsRouterContract } from './console/try-app'
import { workflowDraftRouterContract } from './console/workflow'
import { workflowCommentContracts } from './console/workflow-comment'
import { workspacesRouterContract } from './console/workspaces'

const communityContract = {
  account,
  activate,
  allWorkspaces,
  apiBasedExtension,
  apiKeyAuth,
  app,
  appDslVersion,
  auth,
  codeBasedExtension,
  compliance,
  dataSource,
  datasets,
  emailCodeLogin,
  emailRegister,
  features,
  forgotPassword,
  form,
  info,
  installedApps,
  instructionGenerate,
  login,
  logout,
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
  test,
  trialModels,
  website,
  workflow,
  workflowGenerate,
}

export const consoleRouterContract = {
  enterprise: enterpriseContract,
  ...communityContract,
  agent: agentRouterContract,
  apps: appsRouterContract,
  billing: billingRouterContract,
  explore: exploreRouterContract,
  files: filesRouterContract,
  modelProviders: modelProvidersRouterContract,
  notification: notificationContract,
  notificationDismiss: notificationDismissContract,
  plugins: pluginsRouterContract,
  rbacAccessConfig: rbacAccessConfigContract,
  snippets: snippetsRouterContract,
  tags: tagsRouterContract,
  triggers: triggersRouterContract,
  trialApps: trialAppsRouterContract,
  workflowComments: workflowCommentContracts,
  workflowDraft: workflowDraftRouterContract,
  workspaces: workspacesRouterContract,
}
