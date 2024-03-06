import type { StartNodeType } from './types'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'

export const mockData: StartNodeType = {
  title: 'Start',
  desc: 'Test',
  type: BlockEnum.Start,
  variables: [
    {
      type: InputVarType.textInput,
      label: 'Test',
      variable: 'a',
      max_length: 10,
      default: 'test',
      required: true,
      hint: 'Test',
    },
    {
      type: InputVarType.paragraph,
      label: 'Test',
      variable: 'para',
      default: 'test',
      required: true,
      hint: 'Test',
    },
    {
      type: InputVarType.select,
      label: 'Test',
      variable: 'sel',
      default: 'test',
      required: false,
      hint: 'Test',
      options: ['op1', 'op2'],
    },
    {
      type: InputVarType.number,
      label: 'Test',
      variable: 'num',
      default: '1',
      required: true,
      hint: 'Test',
    },
  ],
}
