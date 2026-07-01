import type { DifyWorld } from '../../support/world'
import { Given, Then } from '@cucumber/cucumber'
import { skipBlockedPrecondition } from '../../agent-v2/support/preflight/common'

async function skipStandaloneOutputVariables(world: DifyWorld) {
  return skipBlockedPrecondition(
    world,
    'Standalone Agent Output Variables are not available: output variables currently belong to Workflow Agent v2 nodes.',
    {
      owner: 'product',
      remediation: 'Expose standalone Agent Output Variables or keep this scenario excluded until the product path exists.',
    },
  )
}

Given('Agent v2 standalone Output Variables are available', async function (this: DifyWorld) {
  return skipStandaloneOutputVariables(this)
})

Then('Agent v2 standalone Output Variables should be available', async function (this: DifyWorld) {
  return skipStandaloneOutputVariables(this)
})

async function skipWorkflowOutputRetryStrategy(world: DifyWorld) {
  return skipBlockedPrecondition(
    world,
    'Agent v2 workflow Output Variables retry strategy is not available in the current editor UI.',
    {
      owner: 'product',
      remediation: 'Expose user-visible retry strategy controls before enabling this scenario.',
    },
  )
}

Given('Agent v2 workflow output retry strategy is available', async function (this: DifyWorld) {
  return skipWorkflowOutputRetryStrategy(this)
})

Then('Agent v2 workflow output retry strategy should be available', async function (this: DifyWorld) {
  return skipWorkflowOutputRetryStrategy(this)
})

async function skipWorkflowTaskOutputReferenceDeletionConsistency(world: DifyWorld) {
  return skipBlockedPrecondition(
    world,
    'Agent v2 workflow task output deletion consistency is not available: deleting an output from the list currently leaves the Prompt token without a stable user-visible invalid-reference state.',
    {
      owner: 'product',
      remediation: 'Define whether deletion should sync the Prompt token, block deletion, or expose an invalid-reference state before enabling this scenario.',
    },
  )
}

Given(
  'Agent v2 workflow task output reference deletion consistency is available',
  async function (this: DifyWorld) {
    return skipWorkflowTaskOutputReferenceDeletionConsistency(this)
  },
)

Then(
  'Agent v2 workflow task output reference deletion consistency should be available',
  async function (this: DifyWorld) {
    return skipWorkflowTaskOutputReferenceDeletionConsistency(this)
  },
)

async function skipWorkflowOutputRetryCountValidation(world: DifyWorld) {
  return skipBlockedPrecondition(
    world,
    'Agent v2 workflow Output Variables retry count validation is not reachable because retry strategy controls are not available in the current editor UI.',
    {
      owner: 'product',
      remediation: 'Expose retry count controls and validation states before enabling this scenario.',
    },
  )
}

Given('Agent v2 workflow output retry count validation is available', async function (this: DifyWorld) {
  return skipWorkflowOutputRetryCountValidation(this)
})

Then('Agent v2 workflow output retry count validation should be available', async function (this: DifyWorld) {
  return skipWorkflowOutputRetryCountValidation(this)
})
