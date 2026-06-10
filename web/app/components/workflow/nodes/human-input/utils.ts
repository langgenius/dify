import type { FormInputItem } from './types'
import type { ValueSelector } from '@/app/components/workflow/types'
import { isParagraphFormInput, isSelectFormInput } from './types'

export const isOutput = (valueSelector: string[]) => {
  return valueSelector[0] === '$output'
}

export const getHumanInputFormDependencySelectors = (inputs: FormInputItem[]): ValueSelector[] => {
  return inputs.flatMap((input) => {
    if (isParagraphFormInput(input) && input.default.type === 'variable' && input.default.selector.length > 0)
      return [input.default.selector]

    if (isSelectFormInput(input) && input.option_source.type === 'variable' && input.option_source.selector.length > 0)
      return [input.option_source.selector]

    return []
  })
}
