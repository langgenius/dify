export const simpleRetryData = (() => {
  const startNode = {
    id: 'f7938b2b-77cd-43f0-814c-2f0ade7cbc60',
    index: 1,
    predecessor_node_id: null,
    node_id: '1735112903395',
    node_type: 'start',
    title: 'Start',
    inputs: {
      'sys.files': [],
      'sys.user_id': '6d8ad01f-edf9-43a6-b863-a034b1828ac7',
      'sys.app_id': '6180ead7-2190-4a61-975c-ec3bf29653da',
      'sys.workflow_id': 'eef6da45-244b-4c79-958e-f3573f7c12bb',
      'sys.workflow_run_id': 'fc8970ef-1406-484e-afde-8567dc22f34c',
    },
    process_data: null,
    outputs: {
      'sys.files': [],
      'sys.user_id': '6d8ad01f-edf9-43a6-b863-a034b1828ac7',
      'sys.app_id': '6180ead7-2190-4a61-975c-ec3bf29653da',
      'sys.workflow_id': 'eef6da45-244b-4c79-958e-f3573f7c12bb',
      'sys.workflow_run_id': 'fc8970ef-1406-484e-afde-8567dc22f34c',
    },
    status: 'succeeded',
    error: null,
    elapsed_time: 0.008715,
    execution_metadata: null,
    extras: {},
    created_at: 1735112940,
    created_by_role: 'account',
    created_by_account: {
      id: '6d8ad01f-edf9-43a6-b863-a034b1828ac7',
      name: '九彩拼盘',
      email: 'iamjoel007@gmail.com',
    },
    created_by_end_user: null,
    finished_at: 1735112940,
  }

  const httpNode = {
    id: '50220407-3420-4ad4-89da-c6959710d1aa',
    index: 2,
    predecessor_node_id: '1735112903395',
    node_id: '1735112908006',
    node_type: 'http-request',
    title: 'HTTP Request',
    inputs: null,
    process_data: {
      request: 'GET / HTTP/1.1\r\nHost: 404\r\n\r\n',
    },
    outputs: null,
    status: 'failed',
    error: 'timed out',
    elapsed_time: 30.247757,
    execution_metadata: null,
    extras: {},
    created_at: 1735112940,
    created_by_role: 'account',
    created_by_account: {
      id: '6d8ad01f-edf9-43a6-b863-a034b1828ac7',
      name: '九彩拼盘',
      email: 'iamjoel007@gmail.com',
    },
    created_by_end_user: null,
    finished_at: 1735112970,
  }

  const retry1 = {
    id: 'ed352b36-27fb-49c6-9e8f-cc755bfc25fc',
    index: 3,
    predecessor_node_id: '1735112903395',
    node_id: '1735112908006',
    node_type: 'http-request',
    title: 'HTTP Request',
    inputs: null,
    process_data: null,
    outputs: null,
    status: 'retry',
    error: 'timed out',
    elapsed_time: 10.011833,
    execution_metadata: {
      iteration_id: null,
      parallel_mode_run_id: null,
    },
    extras: {},
    created_at: 1735112940,
    created_by_role: 'account',
    created_by_account: {
      id: '6d8ad01f-edf9-43a6-b863-a034b1828ac7',
      name: '九彩拼盘',
      email: 'iamjoel007@gmail.com',
    },
    created_by_end_user: null,
    finished_at: 1735112950,
  }

  const retry2 = {
    id: '74dfb3d3-dacf-44f2-8784-e36bfa2d6c4e',
    index: 4,
    predecessor_node_id: '1735112903395',
    node_id: '1735112908006',
    node_type: 'http-request',
    title: 'HTTP Request',
    inputs: null,
    process_data: null,
    outputs: null,
    status: 'retry',
    error: 'timed out',
    elapsed_time: 10.010368,
    execution_metadata: {
      iteration_id: null,
      parallel_mode_run_id: null,
    },
    extras: {},
    created_at: 1735112950,
    created_by_role: 'account',
    created_by_account: {
      id: '6d8ad01f-edf9-43a6-b863-a034b1828ac7',
      name: '九彩拼盘',
      email: 'iamjoel007@gmail.com',
    },
    created_by_end_user: null,
    finished_at: 1735112960,
  }

  return {
    in: [startNode, httpNode, retry1, retry2],
    expect: [startNode, {
      ...httpNode,
      retryDetail: [retry1, retry2],
    }],
  }
})()
