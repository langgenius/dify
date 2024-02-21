import type { HttpNodeType } from './types'

export const mockData: HttpNodeType = {
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
  method: 'get',
  url: 'https://api.dify.com/xx',
  headers: '',
  params: '',
  body: {
    type: 'json',
    data: '',
  },
}
