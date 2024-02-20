import { CodeLanguage } from './types'
import type { CodeNodeType } from './types'

export const mockData: CodeNodeType = {
  title: 'Test',
  desc: 'Test',
  type: 'Test',
  variables: [
    {
      variable: 'name',
      value_selector: ['aaa', 'name'],
    },
    {
      variable: 'age',
      value_selector: ['bbb', 'b', 'c'],
    },
  ],
  code_language: CodeLanguage.python3,
  code: 'print("hello world")',
  outputs: [
    {
      variable: 'output',
      variable_type: 'string',
    },
  ],
}
