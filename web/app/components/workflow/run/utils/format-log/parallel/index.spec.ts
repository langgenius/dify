import graphToLogStruct from '../graph-to-log-struct'

describe('parallel', () => {
  const list = graphToLogStruct('(parallel, parallelNode, nodeA, nodeB -> nodeC)')
  const [parallelNode, ...parallelDetail] = list
  const parallelI18n = 'PARALLEL'
  // format will change the list...
  // const result = format(cloneDeep(list) as any, () => parallelI18n)

  test('parallel should put nodes in details', () => {
    // expect(result as any).toEqual([
    //   {
    //     ...parallelNode,
    //     parallelDetail: {
    //       isParallelStartNode: true,
    //       parallelTitle: `${parallelI18n}-1`,
    //       children: [
    //         parallelNode,
    //         {
    //           ...parallelDetail[0],
    //           parallelDetail: {
    //             branchTitle: `${parallelI18n}-1-A`,
    //           },
    //         },
    //         {
    //           ...parallelDetail[1],
    //           parallelDetail: {
    //             branchTitle: `${parallelI18n}-1-B`,
    //           },
    //         },
    //         parallelDetail[2],
    //       ],
    //     },
    //   },
    // ])
  })
})
