import type { CommonNodeType } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { isHumanInputV2NodeData } from '../types'

const data = (version?: unknown, type: BlockEnum = BlockEnum.HumanInput) =>
  ({
    title: 'Human Input',
    desc: '',
    type,
    ...(version === undefined ? {} : { version }),
  }) as CommonNodeType

describe('isHumanInputV2NodeData', () => {
  it('recognizes only persisted human-input nodes with string version 2', () => {
    expect(isHumanInputV2NodeData(data('2'))).toBe(true)
    expect(isHumanInputV2NodeData(data())).toBe(false)
    expect(isHumanInputV2NodeData(data('1'))).toBe(false)
    expect(isHumanInputV2NodeData(data(2))).toBe(false)
    expect(isHumanInputV2NodeData(data('2', BlockEnum.Code))).toBe(false)
  })
})
