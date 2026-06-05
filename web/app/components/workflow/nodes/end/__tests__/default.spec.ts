import type { EndNodeType } from '../types'
import { BlockEnum } from '@/app/components/workflow/types'
import nodeDefault from '../default'

const validOutputs: EndNodeType['outputs'] = [{
  variable: 'workflow_id',
  value_selector: ['sys', 'workflow_id'],
}]

const createPayload = (overrides: Partial<EndNodeType> = {}): EndNodeType => ({
  title: 'End',
  desc: '',
  type: BlockEnum.End,
  outputs: [],
  ...nodeDefault.defaultValue,
  ...overrides,
})

describe('end/default', () => {
  it('should initialize the node with an empty output list', () => {
    expect(nodeDefault.defaultValue.outputs).toEqual([])
  })

  it('should require output configuration by default', () => {
    const t = vi.fn((key: string) => key)

    const result = nodeDefault.checkValid(createPayload(), t)

    expect(result.isValid).toBe(false)
    expect(result.errorMessage).toBe('errorMsg.fieldRequired')
  })

  it('should treat configured output as valid', () => {
    const t = vi.fn((key: string) => key)

    const result = nodeDefault.checkValid(createPayload({ outputs: validOutputs }), t)

    expect(result.isValid).toBe(true)
    expect(result.errorMessage).toBe('')
  })
})
