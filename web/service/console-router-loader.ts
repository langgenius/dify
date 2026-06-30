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
  agent: () => import('@/contract/console/agent').then(({ agentRouterContract }) => wrapConsoleContract('agent', agentRouterContract)),
  apps: () => import('@/contract/console/apps').then(({ appsRouterContract }) => wrapConsoleContract('apps', appsRouterContract)),
  billing: () => import('@/contract/console/billing').then(({ billingRouterContract }) => wrapConsoleContract('billing', billingRouterContract)),
  enterprise: () => import('@dify/contracts/enterprise/orpc.gen').then(({ contract }) => wrapConsoleContract('enterprise', contract)),
  explore: () => import('@/contract/console/explore').then(({ exploreRouterContract }) => wrapConsoleContract('explore', exploreRouterContract)),
  files: () => import('@/contract/console/files').then(({ filesRouterContract }) => wrapConsoleContract('files', filesRouterContract)),
  modelProviders: () =>
    import('@/contract/console/model-providers').then(({ modelProvidersRouterContract }) => wrapConsoleContract('modelProviders', modelProvidersRouterContract)),
  notification: () =>
    import('@/contract/console/notification').then(({ notificationContract }) => wrapConsoleContract('notification', notificationContract)),
  notificationDismiss: () =>
    import('@/contract/console/notification').then(({ notificationDismissContract }) => wrapConsoleContract('notificationDismiss', notificationDismissContract)),
  plugins: () => import('@/contract/console/plugins').then(({ pluginsRouterContract }) => wrapConsoleContract('plugins', pluginsRouterContract)),
  rbacAccessConfig: () =>
    import('@/contract/console/access-control').then(({ rbacAccessConfigContract }) => wrapConsoleContract('rbacAccessConfig', rbacAccessConfigContract)),
  snippets: () => import('@/contract/console/snippets').then(({ snippetsRouterContract }) => wrapConsoleContract('snippets', snippetsRouterContract)),
  tags: () => import('@/contract/console/tags').then(({ tagsRouterContract }) => wrapConsoleContract('tags', tagsRouterContract)),
  triggers: () => import('@/contract/console/trigger').then(({ triggersRouterContract }) => wrapConsoleContract('triggers', triggersRouterContract)),
  trialApps: () => import('@/contract/console/try-app').then(({ trialAppsRouterContract }) => wrapConsoleContract('trialApps', trialAppsRouterContract)),
  workflowComments: () =>
    import('@/contract/console/workflow-comment').then(({ workflowCommentContracts }) => wrapConsoleContract('workflowComments', workflowCommentContracts)),
  workflowDraft: () =>
    import('@/contract/console/workflow').then(({ workflowDraftRouterContract }) => wrapConsoleContract('workflowDraft', workflowDraftRouterContract)),
  workspaces: () => import('@/contract/console/workspaces').then(({ workspacesRouterContract }) => wrapConsoleContract('workspaces', workspacesRouterContract)),
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
