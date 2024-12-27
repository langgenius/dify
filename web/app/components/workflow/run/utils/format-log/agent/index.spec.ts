import format from '.'
import { agentNodeData } from './data'

describe('agent', () => {
  test('list should transform to tree', () => {
    // console.log(format(agentNodeData.in as any))
    expect(format(agentNodeData.in as any)).toEqual(agentNodeData.expect)
  })
})
