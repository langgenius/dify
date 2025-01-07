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
  test('iteration nodes', () => {
    expect(graphToLogStruct('start -> (iteration, 1, [2, 3])')).toEqual([
      {
        id: 'start',
        node_id: 'start',
        title: 'start',
        execution_metadata: {},
        status: 'succeeded',
      },
      {
        id: '1',
        node_id: '1',
        title: '1',
        execution_metadata: {},
        status: 'succeeded',
        node_type: 'iteration',
      },
      {
        id: '2',
        node_id: '2',
        title: '2',
        execution_metadata: { iteration_id: '1', iteration_index: 0 },
        status: 'succeeded',
      },
      {
        id: '3',
        node_id: '3',
        title: '3',
        execution_metadata: { iteration_id: '1', iteration_index: 1 },
        status: 'succeeded',
      },
    ])
  })
  test('retry nodes', () => {
    expect(graphToLogStruct('start -> (retry, 1, 3)')).toEqual([
      {
        id: 'start',
        node_id: 'start',
        title: 'start',
        execution_metadata: {},
        status: 'succeeded',
      },
      {
        id: '1',
        node_id: '1',
        title: '1',
        execution_metadata: {},
        status: 'succeeded',
      },
      {
        id: '1',
        node_id: '1',
        title: '1',
        execution_metadata: {},
        status: 'retry',
      },
      {
        id: '1',
        node_id: '1',
        title: '1',
        execution_metadata: {},
        status: 'retry',
      },
      {
        id: '1',
        node_id: '1',
        title: '1',
        execution_metadata: {},
        status: 'retry',
      },
    ])
  })
})
