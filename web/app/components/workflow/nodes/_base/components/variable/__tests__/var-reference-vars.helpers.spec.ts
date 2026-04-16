import type { NodeOutPutVar, Var } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
import {
  filterReferenceVars,
  getValueSelector,
  getVariableCategory,
  getVariableDisplayName,
} from '../var-reference-vars.helpers'

describe('var-reference-vars helpers', () => {
  it('should derive display names for flat and mapped variables', () => {
    expect(getVariableDisplayName('sys.files', false)).toBe('files')
    expect(getVariableDisplayName('current', true, true)).toBe('current_code')
    expect(getVariableDisplayName('foo', true, false)).toBe('foo')
  })

  it('should resolve variable categories', () => {
    expect(getVariableCategory({ isEnv: true, isChatVar: false })).toBe('environment')
    expect(getVariableCategory({ isEnv: false, isChatVar: true })).toBe('conversation')
    expect(getVariableCategory({ isEnv: false, isChatVar: false, isLoopVar: true })).toBe('loop')
    expect(getVariableCategory({ isEnv: false, isChatVar: false, isRagVariable: true })).toBe('rag')
  })

  it('should build selectors by variable scope and file support', () => {
    const itemData: Var = { variable: 'output', type: VarType.string }
    expect(getValueSelector({
      itemData,
      isFlat: true,
      isSupportFileVar: true,
      isFile: false,
      isSys: false,
      isEnv: false,
      isChatVar: false,
      nodeId: 'node-1',
      objPath: [],
    })).toEqual(['output'])

    expect(getValueSelector({
      itemData: { variable: 'env.apiKey', type: VarType.string },
      isFlat: false,
      isSupportFileVar: true,
      isFile: false,
      isSys: false,
      isEnv: true,
      isChatVar: false,
      nodeId: 'node-1',
      objPath: ['parent'],
    })).toEqual(['parent', 'env', 'apiKey'])

    expect(getValueSelector({
      itemData: { variable: 'file', type: VarType.file },
      isFlat: false,
      isSupportFileVar: false,
      isFile: true,
      isSys: false,
      isEnv: false,
      isChatVar: false,
      nodeId: 'node-1',
      objPath: [],
    })).toBeUndefined()
  })

  it('should filter out invalid vars and apply search text', () => {
    const vars = filterReferenceVars([
      {
        title: 'Node A',
        nodeId: 'node-a',
        vars: [
          { variable: 'valid_name', type: VarType.string },
          { variable: 'invalid-key', type: VarType.string },
        ],
      },
      {
        title: 'Node B',
        nodeId: 'node-b',
        vars: [{ variable: 'another_value', type: VarType.string }],
      },
    ] as NodeOutPutVar[], 'another')

    expect(vars).toHaveLength(1)
    expect(vars[0]!.title).toBe('Node B')
    expect(vars[0]!.vars).toEqual([expect.objectContaining({ variable: 'another_value' })])
  })
})
