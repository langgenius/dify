import type { CommonNodeType } from '@/app/components/workflow/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { getDefaultValue } from '../utils'

const codeNode = (outputs: Record<string, VarType>) =>
  ({
    type: BlockEnum.Code,
    outputs: Object.fromEntries(
      Object.entries(outputs).map(([key, type]) => [key, { type, children: null }]),
    ),
  }) as unknown as CommonNodeType

describe('getDefaultValue', () => {
  it('should seed an integer code output with a numeric default', () => {
    expect(getDefaultValue(codeNode({ page: VarType.integer }))).toEqual([
      { key: 'page', type: VarType.integer, value: 0 },
    ])
  })

  it('should keep the numeric default of number and integer outputs identical', () => {
    const forms = getDefaultValue(
      codeNode({ count: VarType.number, page: VarType.integer, label: VarType.string }),
    )

    expect(forms).toEqual([
      { key: 'count', type: VarType.number, value: 0 },
      { key: 'page', type: VarType.integer, value: 0 },
      { key: 'label', type: VarType.string, value: '' },
    ])
  })
})
