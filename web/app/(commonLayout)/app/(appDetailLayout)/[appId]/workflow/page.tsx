'use client'

import { memo } from 'react'
import Workflow from '@/app/components/workflow'

// export function createNodesAndEdges(xNodes = 10, yNodes = 10) {
//   const nodes = []
//   const edges = []
//   let nodeId = 1
//   let recentNodeId = null

//   for (let y = 0; y < yNodes; y++) {
//     for (let x = 0; x < xNodes; x++) {
//       const position = { x: x * 200, y: y * 50 }
//       const node = {
//         id: `stress-${nodeId.toString()}`,
//         type: 'custom',
//         data: { type: 'start', title: '开始', variables: [] },
//         position,
//       }
//       nodes.push(node)

//       if (recentNodeId && nodeId <= xNodes * yNodes) {
//         edges.push({
//           id: `${x}-${y}`,
//           type: 'custom',
//           source: `stress-${recentNodeId.toString()}`,
//           target: `stress-${nodeId.toString()}`,
//         })
//       }

//       recentNodeId = nodeId
//       nodeId++
//     }
//   }

//   return { nodes, edges }
// }

const Page = () => {
  // const {
  //   nodes,
  //   edges,
  // } = createNodesAndEdges()
  return (
    <div className='w-full h-full overflow-x-auto'>
      <Workflow
        // nodes={nodes}
        // edges={edges}
      />
    </div>
  )
}
export default memo(Page)
