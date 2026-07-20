import type { DifyWorld } from '../../support/world'
import { Given } from '@cucumber/cucumber'
import { requirePreseededAgentWorkflowReference } from '../../agent-v2/support/fixtures/access'
import { requireAgentBackendRuntime } from '../../agent-v2/support/fixtures/agent-backend'
import {
  requirePreseededAgent,
  requirePreseededDualRetrievalAgentConfiguration,
  requirePreseededFullConfigAgentCoreConfiguration,
  requirePreseededToolStatesAgentConfiguration,
  requirePreseededWorkflow,
} from '../../agent-v2/support/fixtures/agents'
import { requireReadyPreseededDataset } from '../../agent-v2/support/fixtures/datasets'
import {
  requireAgentBuilderAgentDecisionChatModel,
  requireAgentBuilderSpeechToTextModel,
  requireAgentBuilderStableChatModel,
} from '../../agent-v2/support/fixtures/models'
import { requirePreseededTool } from '../../agent-v2/support/fixtures/tools'

Given('the Agent Builder stable chat model is available', async function (this: DifyWorld) {
  const stableModel = await requireAgentBuilderStableChatModel(this)

  this.agentBuilder.fixtures.stableModel = stableModel
})

Given('the workspace default speech-to-text model is active', async function (this: DifyWorld) {
  const speechToTextModel = await requireAgentBuilderSpeechToTextModel(this)

  this.agentBuilder.fixtures.speechToTextModel = speechToTextModel
})

Given('the Agent Builder agent-decision chat model is available', async function (this: DifyWorld) {
  const agentDecisionModel = await requireAgentBuilderAgentDecisionChatModel(this)

  this.agentBuilder.fixtures.agentDecisionModel = agentDecisionModel
})

Given('the Agent v2 runtime backend is available', async function (this: DifyWorld) {
  await requireAgentBackendRuntime(this)
})

Given(
  'the Agent Builder preseeded Agent {string} is available',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await requirePreseededAgent(this, resourceName)

    this.agentBuilder.fixtures.preseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded workflow {string} is available',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await requirePreseededWorkflow(this, resourceName)

    this.agentBuilder.fixtures.preseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded dataset {string} is indexed and ready',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await requireReadyPreseededDataset(this, resourceName)

    this.agentBuilder.fixtures.preseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded tool {string} is available',
  async function (this: DifyWorld, resourceName: string) {
    const resource = await requirePreseededTool(this, resourceName)

    this.agentBuilder.fixtures.preseededResources[resourceName] = resource
  },
)

Given(
  'the Agent Builder preseeded Agent {string} includes the core fixture configuration',
  async function (this: DifyWorld, agentName: string) {
    const resource = await requirePreseededFullConfigAgentCoreConfiguration(this, agentName)

    this.agentBuilder.fixtures.preseededResources[`${agentName} / core fixture configuration`] =
      resource
  },
)

Given(
  'the Agent Builder preseeded Agent {string} includes the tool state fixture configuration',
  async function (this: DifyWorld, agentName: string) {
    const resource = await requirePreseededToolStatesAgentConfiguration(this, agentName)

    this.agentBuilder.fixtures.preseededResources[
      `${agentName} / tool state fixture configuration`
    ] = resource
  },
)

Given(
  'the Agent Builder preseeded Agent {string} includes the dual retrieval fixture configuration',
  async function (this: DifyWorld, agentName: string) {
    const resource = await requirePreseededDualRetrievalAgentConfiguration(this, agentName)

    this.agentBuilder.fixtures.preseededResources[
      `${agentName} / dual retrieval fixture configuration`
    ] = resource
  },
)

Given(
  'the Agent Builder preseeded Agent {string} is referenced by workflow {string}',
  async function (this: DifyWorld, agentName: string, workflowName: string) {
    const resource = await requirePreseededAgentWorkflowReference(this, agentName, workflowName)

    this.agentBuilder.fixtures.preseededResources[`${agentName} / ${workflowName}`] = resource
  },
)
