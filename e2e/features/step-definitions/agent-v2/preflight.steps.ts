import type { DifyWorld } from '../../support/world'
import { Given } from '@cucumber/cucumber'
import { skipMissingAgentBuilderStableChatModel } from '../../../support/preflight'

Given('the Agent Builder stable chat model is available', async function (this: DifyWorld) {
  const stableModel = await skipMissingAgentBuilderStableChatModel(this)
  if (stableModel === 'skipped')
    return stableModel

  this.agentBuilderStableChatModel = stableModel
})
