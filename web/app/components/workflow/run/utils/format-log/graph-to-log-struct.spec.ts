import graphToLogStruct, { parseNodeString } from './graph-to-log-struct'

describe('graphToLogStruct', () => {
  test('parseNodeString', () => {
    expect(parseNodeString('(node1, param1, (node2, param2, (node3, param1)), param4)')).toEqual({
      node: 'node1',
      params: [
        'param1',
        {
          node: 'node2',
          params: [
            'param2',
            {
              node: 'node3',
              params: [
                'param1',
              ],
            },
          ],
        },
        'param4',
      ],
    })
  })
  test('retry nodes', () => {
    console.log(graphToLogStruct('start -> (retry, 1, 3)'))
  })
})
