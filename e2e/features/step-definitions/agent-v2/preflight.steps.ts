import type { DifyWorld } from '../../support/world'
import { Given } from '@cucumber/cucumber'
import {
  skipMissingAgentBuilderBrokenChatModel,
  skipMissingAgentBuilderStableChatModel,
  skipMissingIndexingPreseededDataset,
  skipMissingPreseededAgent,
  skipMissingPreseededAgentBackendApiKey,
  skipMissingPreseededAgentDriveSkill,
  skipMissingPreseededAgentFileTreeFixture,
  skipMissingPreseededAgentPublishedWebApp,
  skipMissingPreseededAgentWorkflowReference,
  skipMissingPreseededDataset,
  skipMissingPreseededTool,
  skipMissingPreseededWorkflow,
  skipMissingReadyPreseededDataset,
} from '../../../support/preflight'

Given('the Agent Builder stable chat model is available', async function (this: DifyWorld) {
  const stableModel = await skipMissingAgentBuilderStableChatModel(this)
  if (stableModel === 'skipped') return stableModel

  this.agentBuilderStableChatModel = stableModel
})

Given('the Agent Builder broken chat model is available', async function (this: DifyWorld) {
  const brokenModel = await skipMissingAgentBuilderBrokenChatModel(this)
  if (brokenModel === 'skipped') return brokenModel

  this.agentBuilderBrokenChatModel = brokenModel
})

Given(
  'the Agent Builder preseeded Agent {string} is available',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await skipMissingPreseededAgent(this, resourceName)
    if (resource === 'skipped') return resource

    this.agentBuilderPreseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded workflow {string} is available',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await skipMissingPreseededWorkflow(this, resourceName)
    if (resource === 'skipped') return resource

    this.agentBuilderPreseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded dataset {string} is available',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await skipMissingPreseededDataset(this, resourceName)
    if (resource === 'skipped') return resource

    this.agentBuilderPreseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded dataset {string} is indexed and ready',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await skipMissingReadyPreseededDataset(this, resourceName)
    if (resource === 'skipped') return resource

    this.agentBuilderPreseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded dataset {string} is indexing',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await skipMissingIndexingPreseededDataset(this, resourceName)
    if (resource === 'skipped') return resource

    this.agentBuilderPreseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded tool {string} is available',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await skipMissingPreseededTool(this, resourceName)
    if (resource === 'skipped') return resource

    this.agentBuilderPreseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded Agent {string} includes drive skill {string}',
  async function (this: DifyWorld, agentName: string, skillName: string) {
    const resource = await skipMissingPreseededAgentDriveSkill(this, agentName, skillName)
    if (resource === 'skipped') return resource

    this.agentBuilderPreseededResources[`${agentName} / ${skillName}`] = resource
  },
)

Given(
  'the Agent Builder preseeded Agent {string} includes the file tree fixture files',
  async function (this: DifyWorld, agentName: string) {
    const resource = await skipMissingPreseededAgentFileTreeFixture(this, agentName)
    if (resource === 'skipped') return resource

    this.agentBuilderPreseededResources[`${agentName} / file tree fixture`] = resource
  },
)

Given(
  'the Agent Builder preseeded Agent {string} has Backend service API access with an API key',
  async function (this: DifyWorld, agentName: string) {
    const resource = await skipMissingPreseededAgentBackendApiKey(this, agentName)
    if (resource === 'skipped') return resource

    this.agentBuilderPreseededResources[`${agentName} / Backend service API key`] = resource
  },
)

Given(
  'the Agent Builder preseeded Agent {string} has published Web app access',
  async function (this: DifyWorld, agentName: string) {
    const resource = await skipMissingPreseededAgentPublishedWebApp(this, agentName)
    if (resource === 'skipped') return resource

    this.agentBuilderPreseededResources[`${agentName} / Web app`] = resource
  },
)

Given(
  'the Agent Builder preseeded Agent {string} is referenced by workflow {string}',
  async function (this: DifyWorld, agentName: string, workflowName: string) {
    const resource = await skipMissingPreseededAgentWorkflowReference(this, agentName, workflowName)
    if (resource === 'skipped') return resource

    this.agentBuilderPreseededResources[`${agentName} / ${workflowName}`] = resource
  },
)
