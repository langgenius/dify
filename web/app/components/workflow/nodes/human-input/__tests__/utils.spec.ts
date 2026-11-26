import type { FormInputItem } from '../types'
import { InputVarType } from '@/app/components/workflow/types'
import { getHumanInputFormDependencySelectors } from '../utils'

describe('getHumanInputFormDependencySelectors', () => {
  it('skips omitted and empty paragraph defaults but retains variable dependencies', () => {
    const inputs: FormInputItem[] = [
      {
        type: InputVarType.paragraph,
        output_variable_name: 'missing',
      } as FormInputItem,
      {
        type: InputVarType.paragraph,
        output_variable_name: 'empty',
        default: { type: 'constant', selector: [], value: '' },
      },
      {
        type: InputVarType.paragraph,
        output_variable_name: 'variable',
        default: { type: 'variable', selector: ['start', 'answer'], value: '' },
      },
      {
        type: InputVarType.paragraph,
        output_variable_name: 'unset-variable',
        default: { type: 'variable', selector: [], value: '' },
      },
    ]

    expect(getHumanInputFormDependencySelectors(inputs)).toEqual([['start', 'answer']])
  })
})
