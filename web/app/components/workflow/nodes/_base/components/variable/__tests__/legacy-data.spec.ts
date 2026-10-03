import type { HttpNodeType } from '@/app/components/workflow/nodes/http/types'
import type { IterationNodeType } from '@/app/components/workflow/nodes/iteration/types'
import type { Node } from '@/app/components/workflow/types'
import { describe, expect, it } from 'vitest'
import { AuthorizationType, BodyType, Method } from '@/app/components/workflow/nodes/http/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { getNodeUsedVars } from '../utils'

const createNode = <T>(data: Node<T>['data']): Node<T> => ({
  id: 'node-1',
  type: 'custom',
  position: { x: 0, y: 0 },
  data,
})

describe('legacy workflow variable data', () => {
  it('tolerates HTTP request nodes with missing body data', () => {
    const node = createNode<HttpNodeType>({
      type: BlockEnum.HttpRequest,
      title: 'HTTP Request',
      desc: '',
      variables: [],
      method: Method.post,
      url: 'https://{{#start.host#}}/items',
      authorization: { type: AuthorizationType.none },
      headers: 'Authorization: Bearer {{#env.API_KEY#}}',
      params: '',
      body: {
        type: BodyType.json,
        data: undefined as unknown as HttpNodeType['body']['data'],
      },
      timeout: {},
      ssl_verify: true,
    })

    expect(getNodeUsedVars(node)).toEqual(
      expect.arrayContaining([
        ['start', 'host'],
        ['env', 'API_KEY'],
      ]),
    )
  })

  it('ignores iteration nodes without a selected iterator', () => {
    const node = createNode<IterationNodeType>({
      type: BlockEnum.Iteration,
      title: 'Iteration',
      desc: '',
      start_node_id: '',
      iterator_selector: undefined as unknown as IterationNodeType['iterator_selector'],
      iterator_input_type: VarType.arrayString,
      output_selector: [],
      output_type: VarType.arrayString,
      is_parallel: false,
      parallel_nums: 10,
      error_handle_mode: undefined as unknown as IterationNodeType['error_handle_mode'],
      flatten_output: true,
      _isShowTips: false,
    })

    expect(getNodeUsedVars(node)).toEqual([])
  })
})
