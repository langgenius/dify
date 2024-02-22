import { EndVarType } from './types'
import type { EndNodeType } from './types'

export const mockData: EndNodeType = {
  title: 'Test',
  desc: 'Test',
  type: 'Test',
  outputs: {
    type: EndVarType.plainText,
    plain_text_selector: ['test'],
    structured_variables: [
      {
        variable: 'test',
        value_selector: ['aaa', 'name'],
      },
    ],
  },
}
