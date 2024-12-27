export const simpleIterationData = (() => {
  // start -> code(output: [1, 2, 3]) -> iteration(output: ['aaa', 'aaa', 'aaa']) -> end(output: ['aaa', 'aaa', 'aaa'])
  const startNode = {
    id: '36c9860a-39e6-4107-b750-655b07895f47',
    index: 1,
    predecessor_node_id: null,
    node_id: '1735023354069',
    node_type: 'start',
    title: 'Start',
    inputs: {
      'sys.files': [],
      'sys.user_id': '5ee03762-1d1a-46e8-ba0b-5f419a77da96',
      'sys.app_id': '8a5e87f8-6433-40f4-a67a-4be78a558dc7',
      'sys.workflow_id': 'bb5e2b89-40ac-45c9-9ccb-4f2cd926e080',
      'sys.workflow_run_id': '76adf675-a7d3-4cc1-9282-ed7ecfe4f65d',
    },
    process_data: null,
    outputs: {
      'sys.files': [],
      'sys.user_id': '5ee03762-1d1a-46e8-ba0b-5f419a77da96',
      'sys.app_id': '8a5e87f8-6433-40f4-a67a-4be78a558dc7',
      'sys.workflow_id': 'bb5e2b89-40ac-45c9-9ccb-4f2cd926e080',
      'sys.workflow_run_id': '76adf675-a7d3-4cc1-9282-ed7ecfe4f65d',
    },
    status: 'succeeded',
    error: null,
    elapsed_time: 0.011458,
    execution_metadata: null,
    extras: {},
    created_by_end_user: null,
    finished_at: 1735023510,
  }

  const outputArrayNode = {
    id: 'a3105c5d-ff9e-44ea-9f4c-ab428958af20',
    index: 2,
    predecessor_node_id: '1735023354069',
    node_id: '1735023361224',
    node_type: 'code',
    title: 'Code',
    inputs: null,
    process_data: null,
    outputs: {
      result: [
        1,
        2,
        3,
      ],
    },
    status: 'succeeded',
    error: null,
    elapsed_time: 0.103333,
    execution_metadata: null,
    extras: {},
    finished_at: 1735023511,
  }

  const iterationNode = {
    id: 'a823134d-9f1a-45a4-8977-db838d076316',
    index: 3,
    predecessor_node_id: '1735023361224',
    node_id: '1735023391914',
    node_type: 'iteration',
    title: 'Iteration',
    inputs: null,
    process_data: null,
    outputs: {
      output: [
        'aaa',
        'aaa',
        'aaa',
      ],
    },

  }

  const iterations = [
    {
      id: 'a84a22d8-0f08-4006-bee2-fa7a7aef0420',
      index: 4,
      predecessor_node_id: '1735023391914start',
      node_id: '1735023409906',
      node_type: 'code',
      title: 'Code 2',
      inputs: null,
      process_data: null,
      outputs: {
        result: 'aaa',
      },
      status: 'succeeded',
      error: null,
      elapsed_time: 0.112688,
      execution_metadata: {
        iteration_id: '1735023391914',
        iteration_index: 0,
      },
      extras: {},
      created_at: 1735023511,
      finished_at: 1735023511,
    },
    {
      id: 'ff71d773-a916-4513-960f-d7dcc4fadd86',
      index: 5,
      predecessor_node_id: '1735023391914start',
      node_id: '1735023409906',
      node_type: 'code',
      title: 'Code 2',
      inputs: null,
      process_data: null,
      outputs: {
        result: 'aaa',
      },
      status: 'succeeded',
      error: null,
      elapsed_time: 0.126034,
      execution_metadata: {
        iteration_id: '1735023391914',
        iteration_index: 1,
      },
      extras: {},
      created_at: 1735023511,
      finished_at: 1735023511,
    },
    {
      id: 'd91c3ef9-0162-4013-9272-d4cc7fb1f188',
      index: 6,
      predecessor_node_id: '1735023391914start',
      node_id: '1735023409906',
      node_type: 'code',
      title: 'Code 2',
      inputs: null,
      process_data: null,
      outputs: {
        result: 'aaa',
      },
      status: 'succeeded',
      error: null,
      elapsed_time: 0.122716,
      execution_metadata: {
        iteration_id: '1735023391914',
        iteration_index: 2,
      },
      extras: {},
      created_at: 1735023511,
      finished_at: 1735023511,
    },
  ]

  const endNode = {
    id: 'e6ad6560-1aa3-43f3-89e3-e5287c9ea272',
    index: 7,
    predecessor_node_id: '1735023391914',
    node_id: '1735023417757',
    node_type: 'end',
    title: 'End',
    inputs: {
      output: [
        'aaa',
        'aaa',
        'aaa',
      ],
    },
    process_data: null,
    outputs: {
      output: [
        'aaa',
        'aaa',
        'aaa',
      ],
    },
    status: 'succeeded',
    error: null,
    elapsed_time: 0.017552,
    execution_metadata: null,
    extras: {},
    finished_at: 1735023511,
  }

  return {
    in: [startNode, outputArrayNode, iterationNode, ...iterations, endNode],
    expect: [startNode, outputArrayNode, {
      ...iterationNode,
      details: [
        [iterations[0]],
        [iterations[1]],
        [iterations[2]],
      ],
    }, endNode],
  }
})()
