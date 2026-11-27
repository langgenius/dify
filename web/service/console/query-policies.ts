import type { RouterUtils } from '@orpc/tanstack-query'
import type { ConsoleClient } from './index'
import type { ConsolePolicies } from './policies/types'
import { createPolicyQueryUtils } from './mutation-policies'
import { accountPolicies, authPolicies } from './policies/account'
import { agentPolicies } from './policies/agents'
import { apiBasedExtensionPolicies } from './policies/api-based-extensions'
import { appPolicies } from './policies/apps'
import { dataSourceAuthPolicies } from './policies/data-source-auth'
import { datasetPolicies } from './policies/datasets'
import { enterprisePolicies } from './policies/enterprise'
import { evaluationPolicies } from './policies/evaluation'
import { fileScanPolicies } from './policies/file-scan'
import { freshnessPolicies } from './policies/freshness'
import { installedAppPolicies } from './policies/installed-apps'
import { invalidationPolicies } from './policies/invalidation'
import { knowledgeFsPolicies } from './policies/knowledge-fs'
import { mergePolicies } from './policies/merge'
import { onboardingPolicies } from './policies/onboarding'
import { ragPipelinePolicies } from './policies/rag-pipelines'
import { resourceAccessTokenPolicies } from './policies/resource-access-tokens'
import { snippetPolicies } from './policies/snippets'
import { tagPolicies } from './policies/tags'
import { workflowRunArchivePolicies } from './policies/workflow-run-archives'
import { workspacePolicies } from './policies/workspace'

/** Every console policy by procedure path. Callbacks read `query` lazily, when they run. */
export function createConsolePolicies(query: RouterUtils<ConsoleClient>) {
  return mergePolicies<ConsolePolicies>(
    {
      workflowRunArchives: workflowRunArchivePolicies(query),
      ...dataSourceAuthPolicies(query),
      ...authPolicies(query),
      rag: ragPipelinePolicies(query),
      workspaces: workspacePolicies(query),
      account: accountPolicies(query),
      apps: appPolicies(query),
      byEvaluateTargetType: evaluationPolicies(query),
      knowledgeFs: knowledgeFsPolicies(query),
      datasets: datasetPolicies(query),
      snippets: snippetPolicies(query),
      installedApps: installedAppPolicies(query),
      onboarding: onboardingPolicies(query),
      agent: agentPolicies(query),
      apiBasedExtension: apiBasedExtensionPolicies(query),
      fileScan: fileScanPolicies(query),
      resourceAccessTokens: resourceAccessTokenPolicies(query),
      tags: tagPolicies(query),
      enterprise: enterprisePolicies(query),
    },
    freshnessPolicies,
    invalidationPolicies,
  )
}

export function createConsoleQuery(consoleClient: ConsoleClient) {
  // Policies build keys from the router they configure; their callbacks read it lazily.
  const router: { current?: RouterUtils<ConsoleClient> } = {}
  const query = new Proxy({} as RouterUtils<ConsoleClient>, {
    get: (_target, property) => Reflect.get(router.current!, property),
  })
  const consoleQuery = createPolicyQueryUtils(consoleClient, {
    path: ['console'],
    experimental_defaults: createConsolePolicies(query),
  })
  router.current = consoleQuery
  return consoleQuery
}
