import parseDSL from './graph-to-log-struct'

describe('parseDSL', () => {
  it('should parse plain nodes correctly', () => {
    const dsl = 'plainNode1 -> plainNode2'
    const result = parseDSL(dsl)
    expect(result).toEqual([
      { id: 'plainNode1', node_id: 'plainNode1', title: 'plainNode1', execution_metadata: {}, status: 'succeeded' },
      { id: 'plainNode2', node_id: 'plainNode2', title: 'plainNode2', execution_metadata: {}, status: 'succeeded' },
    ])
  })

  it('should parse retry nodes correctly', () => {
    const dsl = '(retry, retryNode, 3)'
    const result = parseDSL(dsl)
    expect(result).toEqual([
      { id: 'retryNode', node_id: 'retryNode', title: 'retryNode', execution_metadata: {}, status: 'succeeded' },
      { id: 'retryNode', node_id: 'retryNode', title: 'retryNode', execution_metadata: {}, status: 'retry' },
      { id: 'retryNode', node_id: 'retryNode', title: 'retryNode', execution_metadata: {}, status: 'retry' },
      { id: 'retryNode', node_id: 'retryNode', title: 'retryNode', execution_metadata: {}, status: 'retry' },
    ])
  })

  it('should parse iteration nodes correctly', () => {
    const dsl = '(iteration, iterationNode, plainNode1 -> plainNode2)'
    const result = parseDSL(dsl)
    expect(result).toEqual([
      { id: 'iterationNode', node_id: 'iterationNode', title: 'iterationNode', node_type: 'iteration', execution_metadata: {}, status: 'succeeded' },
      { id: 'plainNode1', node_id: 'plainNode1', title: 'plainNode1', execution_metadata: { iteration_id: 'iterationNode', iteration_index: 0 }, status: 'succeeded' },
      { id: 'plainNode2', node_id: 'plainNode2', title: 'plainNode2', execution_metadata: { iteration_id: 'iterationNode', iteration_index: 0 }, status: 'succeeded' },
    ])
  })

  it('should parse loop nodes correctly', () => {
    const dsl = '(loop, loopNode, plainNode1 -> plainNode2)'
    const result = parseDSL(dsl)
    expect(result).toEqual([
      { id: 'loopNode', node_id: 'loopNode', title: 'loopNode', node_type: 'loop', execution_metadata: {}, status: 'succeeded' },
      { id: 'plainNode1', node_id: 'plainNode1', title: 'plainNode1', execution_metadata: { loop_id: 'loopNode', loop_index: 0 }, status: 'succeeded' },
      { id: 'plainNode2', node_id: 'plainNode2', title: 'plainNode2', execution_metadata: { loop_id: 'loopNode', loop_index: 0 }, status: 'succeeded' },
    ])
  })

  it('should parse parallel nodes correctly', () => {
    const dsl = '(parallel, parallelNode, nodeA, nodeB -> nodeC)'
    const result = parseDSL(dsl)
    expect(result).toEqual([
      { id: 'parallelNode', node_id: 'parallelNode', title: 'parallelNode', execution_metadata: { parallel_id: 'parallelNode' }, status: 'succeeded' },
      { id: 'nodeA', node_id: 'nodeA', title: 'nodeA', execution_metadata: { parallel_id: 'parallelNode', parallel_start_node_id: 'nodeA' }, status: 'succeeded' },
      { id: 'nodeB', node_id: 'nodeB', title: 'nodeB', execution_metadata: { parallel_id: 'parallelNode', parallel_start_node_id: 'nodeB' }, status: 'succeeded' },
      { id: 'nodeC', node_id: 'nodeC', title: 'nodeC', execution_metadata: { parallel_id: 'parallelNode', parallel_start_node_id: 'nodeB' }, status: 'succeeded' },
    ])
  })

  // TODO
  // it('should handle nested parallel nodes', () => {
  //   const dsl = '(parallel, outerParallel, (parallel, innerParallel, plainNode1 -> plainNode2) -> plainNode3)'
  //   const result = parseDSL(dsl)
  //   expect(result).toEqual([
  //     {
  //       id: 'outerParallel',
  //       node_id: 'outerParallel',
  //       title: 'outerParallel',
  //       execution_metadata: { parallel_id: 'outerParallel' },
  //       status: 'succeeded',
  //     },
  //     {
  //       id: 'innerParallel',
  //       node_id: 'innerParallel',
  //       title: 'innerParallel',
  //       execution_metadata: { parallel_id: 'outerParallel', parallel_start_node_id: 'innerParallel' },
  //       status: 'succeeded',
  //     },
  //     {
  //       id: 'plainNode1',
  //       node_id: 'plainNode1',
  //       title: 'plainNode1',
  //       execution_metadata: {
  //         parallel_id: 'innerParallel',
  //         parallel_start_node_id: 'plainNode1',
  //         parent_parallel_id: 'outerParallel',
  //         parent_parallel_start_node_id: 'innerParallel',
  //       },
  //       status: 'succeeded',
  //     },
  //     {
  //       id: 'plainNode2',
  //       node_id: 'plainNode2',
  //       title: 'plainNode2',
  //       execution_metadata: {
  //         parallel_id: 'innerParallel',
  //         parallel_start_node_id: 'plainNode1',
  //         parent_parallel_id: 'outerParallel',
  //         parent_parallel_start_node_id: 'innerParallel',
  //       },
  //       status: 'succeeded',
  //     },
  //     {
  //       id: 'plainNode3',
  //       node_id: 'plainNode3',
  //       title: 'plainNode3',
  //       execution_metadata: {
  //         parallel_id: 'outerParallel',
  //         parallel_start_node_id: 'innerParallel',
  //       },
  //       status: 'succeeded',
  //     },
  //   ])
  // })

  // iterations not support nested iterations
  // it('should handle nested iterations', () => {
  //   const dsl = '(iteration, outerIteration, (iteration, innerIteration -> plainNode1 -> plainNode2))'
  //   const result = parseDSL(dsl)
  //   expect(result).toEqual([
  //     { id: 'outerIteration', node_id: 'outerIteration', title: 'outerIteration', node_type: 'iteration', execution_metadata: {}, status: 'succeeded' },
  //     { id: 'innerIteration', node_id: 'innerIteration', title: 'innerIteration', node_type: 'iteration', execution_metadata: { iteration_id: 'outerIteration', iteration_index: 0 }, status: 'succeeded' },
  //     { id: 'plainNode1', node_id: 'plainNode1', title: 'plainNode1', execution_metadata: { iteration_id: 'innerIteration', iteration_index: 0 }, status: 'succeeded' },
  //     { id: 'plainNode2', node_id: 'plainNode2', title: 'plainNode2', execution_metadata: { iteration_id: 'innerIteration', iteration_index: 0 }, status: 'succeeded' },
  //   ])
  // })

  // it('should handle nested iterations within parallel nodes', () => {
  //   const dsl = '(parallel, parallelNode, (iteration, iterationNode, plainNode1, plainNode2))'
  //   const result = parseDSL(dsl)
  //   expect(result).toEqual([
  //     { id: 'parallelNode', node_id: 'parallelNode', title: 'parallelNode', execution_metadata: { parallel_id: 'parallelNode' }, status: 'succeeded' },
  //     { id: 'iterationNode', node_id: 'iterationNode', title: 'iterationNode', node_type: 'iteration', execution_metadata: { parallel_id: 'parallelNode', parallel_start_node_id: 'iterationNode' }, status: 'succeeded' },
  //     { id: 'plainNode1', node_id: 'plainNode1', title: 'plainNode1', execution_metadata: { iteration_id: 'iterationNode', iteration_index: 0, parallel_id: 'parallelNode', parallel_start_node_id: 'iterationNode' }, status: 'succeeded' },
  //     { id: 'plainNode2', node_id: 'plainNode2', title: 'plainNode2', execution_metadata: { iteration_id: 'iterationNode', iteration_index: 0, parallel_id: 'parallelNode', parallel_start_node_id: 'iterationNode' }, status: 'succeeded' },
  //   ])
  // })

  it('should throw an error for unknown node types', () => {
    const dsl = '(unknown, nodeId)'
    expect(() => parseDSL(dsl)).toThrowError('Unknown nodeType: unknown')
  })
})
