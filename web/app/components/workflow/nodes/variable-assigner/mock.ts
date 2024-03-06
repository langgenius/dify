import { BlockEnum } from '../../types'
import type { VariableAssignerNodeType } from './types'

export const mockData: VariableAssignerNodeType = {
  title: 'Variable Assigner',
  desc: 'Test',
  type: BlockEnum.VariableAssigner,
  output_type: 'string',
  variables: [
    ['aaa', 'name'],
    ['bbb', 'b', 'c'],
  ],
}
