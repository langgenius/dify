import format from '..'
import { agentNodeData, multiStepsCircle, oneStepCircle } from '../data'

describe('agent', () => {
  it('list should transform to tree', () => {
    expect(format(agentNodeData.in as unknown as Parameters<typeof format>[0])).toEqual(agentNodeData.expect)
  })

  it('list should remove circle log item', () => {
    expect(format(oneStepCircle.in as unknown as Parameters<typeof format>[0])).toEqual(oneStepCircle.expect)
    expect(format(multiStepsCircle.in as unknown as Parameters<typeof format>[0])).toEqual(multiStepsCircle.expect)
  })
})
