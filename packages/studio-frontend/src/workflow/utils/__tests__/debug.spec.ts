import { VarInInspectType } from '@/types/workflow'
import { VarType } from '../../types'
import { outputToVarInInspect } from '../debug'

describe('outputToVarInInspect', () => {
  it('should create a VarInInspect object with correct fields', () => {
    const result = outputToVarInInspect({
      nodeId: 'node-1',
      name: 'output',
      value: 'hello world',
    })

    expect(result).toMatchObject({
      type: VarInInspectType.node,
      name: 'output',
      description: '',
      selector: ['node-1', 'output'],
      value_type: VarType.string,
      value: 'hello world',
      edited: false,
      visible: true,
      is_truncated: false,
      full_content: { size_bytes: 0, download_url: '' },
    })
    expect(result.id).toBeDefined()
  })

  it('should handle different value types', () => {
    const result = outputToVarInInspect({
      nodeId: 'n2',
      name: 'count',
      value: 42,
    })

    expect(result.value).toBe(42)
    expect(result.selector).toEqual(['n2', 'count'])
  })

  it('should handle null value', () => {
    const result = outputToVarInInspect({
      nodeId: 'n3',
      name: 'empty',
      value: null,
    })

    expect(result.value).toBeNull()
  })
})
