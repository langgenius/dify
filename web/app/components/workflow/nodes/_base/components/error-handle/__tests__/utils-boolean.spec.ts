import type { CommonNodeType } from '@/app/components/workflow/types'
import { describe, expect, it } from 'vite-plus/test'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { getDefaultValue } from '../utils'

describe('getDefaultValue boolean outputs', () => {
  it('provides boolean and array-boolean fallbacks for code nodes', () => {
    const data = {
      type: BlockEnum.Code,
      outputs: {
        flag: { type: VarType.boolean },
        flags: { type: VarType.arrayBoolean },
      },
    } as unknown as CommonNodeType

    expect(getDefaultValue(data)).toEqual([
      { key: 'flag', type: VarType.boolean, value: false },
      { key: 'flags', type: VarType.arrayBoolean, value: '[]' },
    ])
  })
})
