import type { DifyWorld } from '../../support/world'
import { Given } from '@cucumber/cucumber'
import {
  skipMissingPreseededAgentBackendApiKey,
  skipMissingPreseededAgentPublishedWebApp,
  skipMissingPreseededAgentWorkflowReference,
} from '../../agent-v2/support/preflight/access'
import { skipMissingAgentBackendRuntime } from '../../agent-v2/support/preflight/agent-backend'
import {
  skipMissingPreseededAgent,
  skipMissingPreseededAgentDriveSkill,
  skipMissingPreseededDualRetrievalAgentConfiguration,
  skipMissingPreseededFullConfigAgentCoreConfiguration,
  skipMissingPreseededOAuthToolAgentConfiguration,
  skipMissingPreseededToolStatesAgentConfiguration,
  skipMissingPreseededWorkflow,
} from '../../agent-v2/support/preflight/agents'
import {
  skipMissingIndexingPreseededDataset,
  skipMissingReadyPreseededDataset,
} from '../../agent-v2/support/preflight/datasets'
import {
  skipMissingAgentBuilderAgentDecisionChatModel,
  skipMissingAgentBuilderBrokenChatModel,
  skipMissingAgentBuilderSpeechToTextModel,
  skipMissingAgentBuilderStableChatModel,
} from '../../agent-v2/support/preflight/models'
import { skipMissingPreseededTool } from '../../agent-v2/support/preflight/tools'

Given('the Agent Builder stable chat model is available', async function (this: DifyWorld) {
  const stableModel = await skipMissingAgentBuilderStableChatModel(this)
  if (stableModel === 'skipped') return stableModel

  this.agentBuilder.preflight.stableModel = stableModel
})

Given('the workspace default speech-to-text model is active', async function (this: DifyWorld) {
  const speechToTextModel = await skipMissingAgentBuilderSpeechToTextModel(this)
  if (speechToTextModel === 'skipped') return speechToTextModel

  this.agentBuilder.preflight.speechToTextModel = speechToTextModel
})

Given('the Agent Builder agent-decision chat model is available', async function (this: DifyWorld) {
  const agentDecisionModel = await skipMissingAgentBuilderAgentDecisionChatModel(this)
  if (agentDecisionModel === 'skipped') return agentDecisionModel

  this.agentBuilder.preflight.agentDecisionModel = agentDecisionModel
})

Given('the Agent Builder broken chat model is available', async function (this: DifyWorld) {
  const brokenModel = await skipMissingAgentBuilderBrokenChatModel(this)
  if (brokenModel === 'skipped') return brokenModel

  this.agentBuilder.preflight.brokenModel = brokenModel
})

Given('the Agent v2 runtime backend is available', async function (this: DifyWorld) {
  const runtimeBackend = await skipMissingAgentBackendRuntime(this)
  if (runtimeBackend === 'skipped') return runtimeBackend
})

Given(
  'the Agent Builder preseeded Agent {string} is available',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await skipMissingPreseededAgent(this, resourceName)
    if (resource === 'skipped') return resource

    this.agentBuilder.preflight.preseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded workflow {string} is available',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await skipMissingPreseededWorkflow(this, resourceName)
    if (resource === 'skipped') return resource

    this.agentBuilder.preflight.preseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded dataset {string} is indexed and ready',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await skipMissingReadyPreseededDataset(this, resourceName)
    if (resource === 'skipped') return resource

    this.agentBuilder.preflight.preseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded dataset {string} is indexing',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await skipMissingIndexingPreseededDataset(this, resourceName)
    if (resource === 'skipped') return resource

    this.agentBuilder.preflight.preseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded tool {string} is available',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await skipMissingPreseededTool(this, resourceName)
    if (resource === 'skipped') return resource

    this.agentBuilder.preflight.preseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded Agent {string} includes drive skill {string}',
  async function (this: DifyWorld, agentName: string, skillName: string) {
    const resource = await skipMissingPreseededAgentDriveSkill(this, agentName, skillName)
    if (resource === 'skipped') return resource

    this.agentBuilder.preflight.preseededResources[`${agentName} / ${skillName}`] = resource
  },
)

Given(
  'the Agent Builder preseeded Agent {string} includes the core fixture configuration',
  async function (this: DifyWorld, agentName: string) {
    const resource = await skipMissingPreseededFullConfigAgentCoreConfiguration(this, agentName)
    if (resource === 'skipped') return resource

    this.agentBuilder.preflight.preseededResources[`${agentName} / core fixture configuration`] =
      resource
  },
)

Given(
  'the Agent Builder preseeded Agent {string} includes the tool state fixture configuration',
  async function (this: DifyWorld, agentName: string) {
    const resource = await skipMissingPreseededToolStatesAgentConfiguration(this, agentName)
    if (resource === 'skipped') return resource

    this.agentBuilder.preflight.preseededResources[
      `${agentName} / tool state fixture configuration`
    ] = resource
  },
)

Given(
  'the Agent Builder preseeded Agent {string} includes an OAuth2 tool credential',
  async function (this: DifyWorld, agentName: string) {
    const resource = await skipMissingPreseededOAuthToolAgentConfiguration(this, agentName)
    if (resource === 'skipped') return resource

    this.agentBuilder.preflight.preseededResources[`${agentName} / OAuth2 tool credential`] =
      resource
  },
)

Given(
  'the Agent Builder preseeded Agent {string} includes the dual retrieval fixture configuration',
  async function (this: DifyWorld, agentName: string) {
    const resource = await skipMissingPreseededDualRetrievalAgentConfiguration(this, agentName)
    if (resource === 'skipped') return resource

    this.agentBuilder.preflight.preseededResources[
      `${agentName} / dual retrieval fixture configuration`
    ] = resource
  },
)

Given(
  'the Agent Builder preseeded Agent {string} has Backend service API access with an API key',
  async function (this: DifyWorld, agentName: string) {
    const resource = await skipMissingPreseededAgentBackendApiKey(this, agentName)
    if (resource === 'skipped') return resource

    this.agentBuilder.preflight.preseededResources[`${agentName} / Backend service API key`] =
      resource
  },
)

Given(
  'the Agent Builder preseeded Agent {string} has published Web app access',
  async function (this: DifyWorld, agentName: string) {
    const resource = await skipMissingPreseededAgentPublishedWebApp(this, agentName)
    if (resource === 'skipped') return resource

    this.agentBuilder.preflight.preseededResources[`${agentName} / Web app`] = resource
  },
)

Given(
  'the Agent Builder preseeded Agent {string} is referenced by workflow {string}',
  async function (this: DifyWorld, agentName: string, workflowName: string) {
    const resource = await skipMissingPreseededAgentWorkflowReference(this, agentName, workflowName)
    if (resource === 'skipped') return resource

    this.agentBuilder.preflight.preseededResources[`${agentName} / ${workflowName}`] = resource
  },
)
