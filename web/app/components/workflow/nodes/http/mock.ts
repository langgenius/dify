import { BlockEnum } from '../../types'
import { BodyType, Method } from './types'
import type { HttpNodeType } from './types'

export const mockData: HttpNodeType = {
  title: 'Test',
  desc: 'Test',
  type: BlockEnum.HttpRequest,
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
  method: Method.get,
  url: 'https://api.dify.com/xx',
  headers: 'Content-Type: application/json\nAccept: */*',
  params: '',
  body: {
    type: BodyType.none,
    data: '',
  },
}
