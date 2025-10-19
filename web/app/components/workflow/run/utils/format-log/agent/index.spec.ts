import format from '.'
import { agentNodeData, multiStepsCircle, oneStepCircle } from './data'

describe('agent', () => {
  test('list should transform to tree', () => {
    // console.log(format(agentNodeData.in as any))
    expect(format(agentNodeData.in as any)).toEqual(agentNodeData.expect)
  })

  test('list should remove circle log item', () => {
    // format(oneStepCircle.in as any)
    expect(format(oneStepCircle.in as any)).toEqual(oneStepCircle.expect)
    expect(format(multiStepsCircle.in as any)).toEqual(multiStepsCircle.expect)
  })
})
