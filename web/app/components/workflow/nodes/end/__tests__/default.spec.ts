import type { EndNodeType } from '../types'
import { BlockEnum } from '@/app/components/workflow/types'
import nodeDefault from '../default'

const defaultOutputs: EndNodeType['outputs'] = [{
  variable: 'workflow_id',
  value_selector: ['sys', 'workflow_id'],
}]

const createPayload = (overrides: Partial<EndNodeType> = {}): EndNodeType => ({
  title: 'End',
  desc: '',
  type: BlockEnum.End,
  ...nodeDefault.defaultValue,
  outputs: defaultOutputs,
  ...overrides,
})

describe('end/default', () => {
  it('should initialize the node with sys.workflow_id output', () => {
    expect(nodeDefault.defaultValue.outputs).toEqual(defaultOutputs)
  })

  it('should treat the default output as valid', () => {
    const t = vi.fn((key: string) => key)

    const result = nodeDefault.checkValid(createPayload(), t)

    expect(result.isValid).toBe(true)
    expect(result.errorMessage).toBe('')
  })
})
