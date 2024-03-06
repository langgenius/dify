import { BlockEnum } from '../../types'
import { EndVarType } from './types'
import type { EndNodeType } from './types'

export const mockData: EndNodeType = {
  title: 'End',
  desc: 'Test',
  type: BlockEnum.End,
  outputs: {
    type: EndVarType.structured,
    plain_text_selector: ['aaa', 'name'],
    structured_variables: [
      {
        variable: 'test',
        value_selector: ['aaa', 'name'],
      },
    ],
  },
}
