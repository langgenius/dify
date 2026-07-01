import type { DifyWorld } from '../../support/world'
import { Given } from '@cucumber/cucumber'
import {
  skipMissingAgentBuilderBrokenChatModel,
  skipMissingAgentBuilderStableChatModel,
  skipMissingPreseededAgent,
  skipMissingPreseededDataset,
  skipMissingPreseededTool,
  skipMissingPreseededWorkflow,
} from '../../../support/preflight'

Given('the Agent Builder stable chat model is available', async function (this: DifyWorld) {
  const stableModel = await skipMissingAgentBuilderStableChatModel(this)
  if (stableModel === 'skipped')
    return stableModel

  this.agentBuilderStableChatModel = stableModel
})

Given('the Agent Builder broken chat model is available', async function (this: DifyWorld) {
  const brokenModel = await skipMissingAgentBuilderBrokenChatModel(this)
  if (brokenModel === 'skipped')
    return brokenModel

  this.agentBuilderBrokenChatModel = brokenModel
})

Given(
  'the Agent Builder preseeded Agent {string} is available',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await skipMissingPreseededAgent(this, resourceName)
    if (resource === 'skipped')
      return resource

    this.agentBuilderPreseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded workflow {string} is available',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await skipMissingPreseededWorkflow(this, resourceName)
    if (resource === 'skipped')
      return resource

    this.agentBuilderPreseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded dataset {string} is available',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await skipMissingPreseededDataset(this, resourceName)
    if (resource === 'skipped')
      return resource

    this.agentBuilderPreseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded tool {string} is available',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await skipMissingPreseededTool(this, resourceName)
    if (resource === 'skipped')
      return resource

    this.agentBuilderPreseededResources[resourceName] = resource
  },
)
