import { BlockEnum } from '@/app/components/workflow/types'

export const agentNodeData = (() => {
  const node = {
    node_type: BlockEnum.Agent,
    execution_metadata: {
      agent_log: [
        { id: '1', label: 'Root 1' },
        { id: '2', parent_id: '1', label: 'Child 1.2' },
        { id: '3', parent_id: '1', label: 'Child 1.3' },
        { id: '4', parent_id: '2', label: 'Child 2.4' },
        { id: '5', parent_id: '2', label: 'Child 2.5' },
        { id: '6', parent_id: '3', label: 'Child 3.6' },
        { id: '7', parent_id: '4', label: 'Child 4.7' },
        { id: '8', parent_id: '4', label: 'Child 4.8' },
        { id: '9', parent_id: '5', label: 'Child 5.9' },
        { id: '10', parent_id: '5', label: 'Child 5.10' },
        { id: '11', parent_id: '7', label: 'Child 7.11' },
        { id: '12', parent_id: '7', label: 'Child 7.12' },
        { id: '13', parent_id: '9', label: 'Child 9.13' },
        { id: '14', parent_id: '9', label: 'Child 9.14' },
        { id: '15', parent_id: '9', label: 'Child 9.15' },
      ],
    },
  }

  return {
    in: [node],
    expect: [{
      ...node,
      agentLog: [
        {
          id: '1',
          label: 'Root 1',
          children: [
            {
              id: '2',
              parent_id: '1',
              label: 'Child 1.2',
              children: [
                {
                  id: '4',
                  parent_id: '2',
                  label: 'Child 2.4',
                  children: [
                    {
                      id: '7',
                      parent_id: '4',
                      label: 'Child 4.7',
                      children: [
                        { id: '11', parent_id: '7', label: 'Child 7.11' },
                        { id: '12', parent_id: '7', label: 'Child 7.12' },
                      ],
                    },
                    { id: '8', parent_id: '4', label: 'Child 4.8' },
                  ],
                },
                {
                  id: '5',
                  parent_id: '2',
                  label: 'Child 2.5',
                  children: [
                    {
                      id: '9',
                      parent_id: '5',
                      label: 'Child 5.9',
                      children: [
                        { id: '13', parent_id: '9', label: 'Child 9.13' },
                        { id: '14', parent_id: '9', label: 'Child 9.14' },
                        { id: '15', parent_id: '9', label: 'Child 9.15' },
                      ],
                    },
                    { id: '10', parent_id: '5', label: 'Child 5.10' },
                  ],
                },
              ],
            },
            {
              id: '3',
              parent_id: '1',
              label: 'Child 1.3',
              children: [
                { id: '6', parent_id: '3', label: 'Child 3.6' },
              ],
            },
          ],
        },
      ],
    }],
  }
})()

export const oneStepCircle = (() => {
  const node = {
    node_type: BlockEnum.Agent,
    execution_metadata: {
      agent_log: [
        { id: '1', label: 'Node 1' },
        { id: '1', parent_id: '1', label: 'Node 1' },
        { id: '1', parent_id: '1', label: 'Node 1' },
        { id: '1', parent_id: '1', label: 'Node 1' },
        { id: '1', parent_id: '1', label: 'Node 1' },
        { id: '1', parent_id: '1', label: 'Node 1' },
      ],
    },
  }

  return {
    in: [node],
    expect: [{
      ...node,
      agentLog: [
        {
          id: '1',
          label: 'Node 1',
          hasCircle: true,
          children: [],
        },
      ],
    }],
  }
})()

export const multiStepsCircle = (() => {
  const node = {
    node_type: BlockEnum.Agent,
    execution_metadata: {
      agent_log: [
        // 1 -> [2 -> 4 -> 1, 3]
        { id: '1', label: 'Node 1' },
        { id: '2', parent_id: '1', label: 'Node 2' },
        { id: '3', parent_id: '1', label: 'Node 3' },
        { id: '4', parent_id: '2', label: 'Node 4' },

        // Loop
        { id: '1', parent_id: '4', label: 'Node 1' },
        { id: '2', parent_id: '1', label: 'Node 2' },
        { id: '4', parent_id: '2', label: 'Node 4' },
        { id: '1', parent_id: '4', label: 'Node 1' },
        { id: '2', parent_id: '1', label: 'Node 2' },
        { id: '4', parent_id: '2', label: 'Node 4' },
      ],
    },
  }
  // 1 -> [2(4(1(2(4...)))), 3]
  return {
    in: [node],
    expect: [{
      ...node,
      agentLog: [
        {
          id: '1',
          label: 'Node 1',
          children: [
            {
              id: '2',
              parent_id: '1',
              label: 'Node 2',
              children: [
                {
                  id: '4',
                  parent_id: '2',
                  label: 'Node 4',
                  children: [],
                  hasCircle: true,
                },
              ],
            },
            {
              id: '3',
              parent_id: '1',
              label: 'Node 3',
            },
          ],
        },
      ],
    }],
  }
})()
