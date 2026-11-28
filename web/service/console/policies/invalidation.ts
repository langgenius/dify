import type { ConsolePolicies } from './types'
import { mergePolicies } from './merge'

// No cached data changes, or the owner reconciles the cache itself.
const skip = { mutationOptions: { meta: { invalidate: false } } } as const

/**
 * Reads sent as POST: previews, estimates, validations and tests, downloads, searches and
 * option lookups. They change nothing a query reads, and some run from a mount effect, so a
 * refresh after each one could loop. `__tests__/mutation-coverage.spec.ts` fails for a write
 * whose name looks read-only and is neither listed here nor listed there as a real write.
 */
export const READ_ONLY_POSTS = [
  'enterprise.releaseService.precheckRelease',
  'enterprise.releaseService.computeDeploymentOptions',
  'byEvaluateTargetType.byEvaluateTargetId.datasetTemplate.download.post',
  'byEvaluateTargetType.byEvaluateTargetId.evaluation.nodeInfo.post',
  'account.changeEmail.checkEmailUnique.post',
  'account.changeEmail.validity.post',
  'agent.byAgentId.composer.validate.post',
  'agent.byAgentId.sandbox.files.download.post',
  'agent.byAgentId.audioToText.post',
  'agent.byAgentId.textToAudio.post',
  'apps.byAppId.audioToText.post',
  'apps.byAppId.textToAudio.post',
  'apps.byAppId.advancedChat.workflows.draft.humanInput.nodes.byNodeId.form.preview.post',
  'apps.byAppId.advancedChat.workflows.draft.humanInput.nodes.byNodeId.messageTemplate.test.post',
  'apps.byAppId.workflowRuns.byWorkflowRunId.agentNodes.byNodeId.sandbox.files.download.post',
  'apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.deliveryTest.post',
  'apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.form.preview.post',
  'apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.messageTemplate.test.post',
  'apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.validate.post',
  'apps.byAppId.workflows.draft.testCredentials.preflight.post',
  'datasets.indexingEstimate.post',
  'datasets.notionIndexingEstimate.post',
  'datasets.byDatasetId.documents.downloadZip.post',
  'datasets.byDatasetId.evaluation.template.download.post',
  'fileScan.providers.byProviderId.test.post',
  'installedApps.byInstalledAppId.audioToText.post',
  'installedApps.byInstalledAppId.textToAudio.post',
  'knowledgeFs.queryStream.post',
  'knowledgeFs.sourceProviderPreview.post',
  'knowledgeFs.spaces.byControlSpaceId.logicalDocuments.downloadZip.post',
  'knowledgeFs.spaces.byControlSpaceId.queryStreamCapability.post',
  'knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.crawlPreview.post',
  'knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.test.post',
  'knowledgeFs.tasks.byTaskId.streamCapability.post',
  'rag.pipelines.byPipelineId.workflows.published.datasource.nodes.byNodeId.preview.post',
  'snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.validate.post',
  'trialApps.byAppId.audioToText.post',
  'trialApps.byAppId.textToAudio.post',
  'workspaces.current.humanInput.v2.channels.email.test.post',
  'workspaces.current.humanInput.v2.channels.email.byChannelId.test.post',
  'workspaces.current.humanInput.v2.channels.im.test.post',
  'workspaces.current.humanInput.v2.channels.im.byChannelId.test.post',
  'workspaces.current.members.ownerTransferCheck.post',
  'workspaces.current.modelProviders.byProvider.credentials.validate.post',
  'workspaces.current.modelProviders.byProvider.models.credentials.validate.post',
  'workspaces.current.modelProviders.byProvider.models.loadBalancingConfigs.credentialsValidate.post',
  'workspaces.current.modelProviders.byProvider.models.loadBalancingConfigs.byConfigId.credentialsValidate.post',
  'workspaces.current.plugin.list.installations.ids.post',
  'workspaces.current.plugin.list.latestVersions.post',
  'workspaces.current.plugin.parameters.dynamicOptionsWithCredentials.post',
  'workspaces.current.skills.bySkillId.files.check.post',
  'workspaces.current.toolProvider.api.schema.post',
  'workspaces.current.toolProvider.api.test.pre.post',
] as const

// A read sent as POST: skips the fallback and never holds back another write's refresh.
const readOnly = { mutationOptions: { meta: { invalidate: false, readOnly: true } } } as const

// Builds `{ a: { b: readOnly } }` from 'a.b'.
const readOnlyAt = (path: string): ConsolePolicies =>
  path
    .split('.')
    .reduceRight<unknown>((node, segment) => ({ [segment]: node }), readOnly) as ConsolePolicies

const tagBinding = {
  mutationOptions: {
    meta: {
      alsoInvalidate: [
        'tags',
        'apps',
        'datasets',
        'knowledgeFs',
        'agent',
        'workspaces.current.skills',
      ],
    },
  },
}

/**
 * How the invalidation fallback (`../mutation-invalidation.ts`) treats procedures that no
 * other policy describes. By default every successful console mutation refreshes the active
 * queries of its own domain in the background.
 *
 * - `invalidate: false` skips the fallback: sign-in and generation endpoints that change no
 *   cached data, and autosaves whose policy writes the response, which would otherwise
 *   refetch the whole editor on every keystroke batch.
 * - `alsoInvalidate` names other domains a write changes.
 *
 * A procedure whose policy lives in a domain file declares its `meta` there instead.
 */
// A pipeline run with `is_preview` only computes chunks to show.
const isPreviewRun = (variables: unknown) =>
  typeof variables === 'object' &&
  variables !== null &&
  'body' in variables &&
  typeof variables.body === 'object' &&
  variables.body !== null &&
  'is_preview' in variables.body &&
  variables.body.is_preview === true

const namedPolicies: ConsolePolicies = {
  login: { post: skip },
  workspaces: {
    // The first workspace updates the account profile and makes workspace-scoped reads available.
    activate: {
      post: {
        mutationOptions: {
          meta: {
            alsoInvalidate: ['account.profile', 'workspaces.get', 'workspaces.current', 'features'],
          },
        },
      },
    },
    // Both reload the page once they succeed.
    info: { post: skip },
    switch: { post: skip },
  },
  logout: { post: skip },
  refreshToken: { post: skip },
  emailCodeLogin: { post: skip, validity: { post: skip } },
  emailRegister: { post: skip, sendEmail: { post: skip }, validity: { post: skip } },
  forgotPassword: { post: skip, resets: { post: skip }, validity: { post: skip } },
  resetPassword: { post: skip },
  instructionGenerate: { post: skip, template: { post: skip } },
  ruleGenerate: { post: skip },
  ruleCodeGenerate: { post: skip },
  ruleStructuredOutputGenerate: { post: skip },
  workflowGenerate: { post: skip, stream: { post: skip }, suggestions: { post: skip } },
  // Binding a tag changes the tag's usage counts and the tagged resource's list row.
  tagBindings: { post: tagBinding, remove: { post: tagBinding } },
  agent: {
    byAgentId: {
      // The preview chat keeps its history current while it streams and remounts on new data,
      // so an unrelated agent write must not refetch it mid-response.
      chatMessages: { get: { queryOptions: { meta: { invalidateAfterWrites: false } } } },
      // Autosaves: their policies write the saved state.
      composer: { put: skip },
      buildDraft: {
        put: skip,
        checkout: { post: skip },
        // The discarded draft is removed by its owner; a refetch would read a missing draft.
        delete: skip,
      },
    },
  },
  rag: {
    pipelines: {
      byPipelineId: {
        workflows: {
          published: {
            run: {
              post: {
                mutationOptions: {
                  meta: { invalidate: (variables: unknown) => !isPreviewRun(variables) },
                },
              },
            },
          },
        },
      },
    },
  },
  apps: {
    byAppId: {
      workflows: {
        draft: {
          nodes: { byNodeId: { agentComposer: { put: skip } } },
        },
      },
    },
  },
  snippets: {
    bySnippetId: {
      workflows: {
        draft: {
          nodes: { byNodeId: { agentComposer: { put: skip } } },
        },
      },
    },
  },
}

export const invalidationPolicies: ConsolePolicies = mergePolicies<ConsolePolicies>(
  namedPolicies,
  ...READ_ONLY_POSTS.map(readOnlyAt),
)
