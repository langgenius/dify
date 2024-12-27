import { BlockEnum } from '@/app/components/workflow/types'
import type { NodeTracing } from '@/types/workflow'

function printNodeStructure(node: NodeTracing, level: number) {
  const indent = '  '.repeat(level)
  console.log(`${indent}${node.title}`)
  if (node.parallelDetail?.children) {
    node.parallelDetail.children.forEach((child) => {
      printNodeStructure(child, level + 1)
    })
  }
}

function addTitle({
  list, level, parallelNumRecord,
}: {
  list: NodeTracing[], level: number, parallelNumRecord: Record<string, number>
}, t: any) {
  let branchIndex = 0
  list.forEach((node) => {
    const parallel_id = node.parallel_id ?? node.execution_metadata?.parallel_id ?? null
    const parallel_start_node_id = node.parallel_start_node_id ?? node.execution_metadata?.parallel_start_node_id ?? null

    const isNotInParallel = !parallel_id || node.node_type === BlockEnum.End
    if (isNotInParallel)
      return

    const isParallelStartNode = node.parallelDetail?.isParallelStartNode
    if (isParallelStartNode)
      parallelNumRecord.num++

    const letter = parallelNumRecord.num > 1 ? String.fromCharCode(64 + level) : ''
    const parallelLevelInfo = `${parallelNumRecord.num}${letter}`

    if (isParallelStartNode) {
      node.parallelDetail!.isParallelStartNode = true
      node.parallelDetail!.parallelTitle = `${t('workflow.common.parallel')}-${parallelLevelInfo}`
    }

    const isBrachStartNode = parallel_start_node_id === node.node_id
    if (isBrachStartNode) {
      branchIndex++
      const branchLetter = String.fromCharCode(64 + branchIndex)
      if (!node.parallelDetail) {
        node.parallelDetail = {
          branchTitle: '',
        }
      }

      node.parallelDetail!.branchTitle = `${t('workflow.common.branch')}-${parallelLevelInfo}-${branchLetter}`
    }

    if (node.parallelDetail?.children && node.parallelDetail.children.length > 0) {
      addTitle({
        list: node.parallelDetail.children,
        level: level + 1,
        parallelNumRecord,
      }, t)
    }
  })
}

// list => group by parallel_id(parallel tree).
const format = (list: NodeTracing[], t: any): NodeTracing[] => {
  // console.log(list)
  const result: NodeTracing[] = [...list]
  const parallelFirstNodeMap: Record<string, string> = {}
  // list to tree by parent_parallel_start_node_id and branch by parallel_start_node_id. Each parallel may has more than one branch.
  result.forEach((node) => {
    const parallel_id = node.parallel_id ?? node.execution_metadata?.parallel_id ?? null
    const parent_parallel_id = node.parent_parallel_id ?? node.execution_metadata?.parent_parallel_id ?? null
    const branchStartNodeId = node.parallel_start_node_id ?? node.execution_metadata?.parallel_start_node_id ?? null
    const parent_parallel_start_node_id = node.parent_parallel_start_node_id ?? node.execution_metadata?.parent_parallel_start_node_id ?? null
    const isNotInParallel = !parallel_id || node.node_type === BlockEnum.End
    if (isNotInParallel)
      return

    const isParallelStartNode = !parallelFirstNodeMap[parallel_id]
    if (isParallelStartNode) {
      const selfNode = { ...node, parallelDetail: undefined }
      node.parallelDetail = {
        isParallelStartNode: true,
        children: [selfNode],
      }
      parallelFirstNodeMap[parallel_id] = node.node_id
      const isRootLevel = !parent_parallel_id
      if (isRootLevel)
        return

      const parentParallelStartNode = result.find(item => item.node_id === parent_parallel_start_node_id)
      // append to parent parallel start node
      if (parentParallelStartNode) {
        if (!parentParallelStartNode?.parallelDetail) {
          parentParallelStartNode!.parallelDetail = {
            children: [],
          }
        }
        if (parentParallelStartNode!.parallelDetail.children)
          parentParallelStartNode!.parallelDetail.children.push(node)
      }
      return
    }

    // append to parallel start node and after the same branch
    const parallelStartNode = result.find(item => item.node_id === parallelFirstNodeMap[parallel_id])
    if (parallelStartNode && parallelStartNode.parallelDetail && parallelStartNode!.parallelDetail!.children) {
      const sameBranchNodesLastIndex = parallelStartNode.parallelDetail.children.findLastIndex((node) => {
        const currStartNodeId = node.parallel_start_node_id ?? node.execution_metadata?.parallel_start_node_id ?? null
        return currStartNodeId === branchStartNodeId
      })
      if (sameBranchNodesLastIndex !== -1) {
        parallelStartNode.parallelDetail.children.splice(sameBranchNodesLastIndex + 1, 0, node)
      }
      else { // new branch
        parallelStartNode.parallelDetail.children.push(node)
      }
    }
    // parallelStartNode!.parallelDetail!.children.push(node)
  })

  const filteredInParallelSubNodes = result.filter((node) => {
    const parallel_id = node.parallel_id ?? node.execution_metadata?.parallel_id ?? null
    const isNotInParallel = !parallel_id || node.node_type === BlockEnum.End
    if (isNotInParallel)
      return true

    const parent_parallel_id = node.parent_parallel_id ?? node.execution_metadata?.parent_parallel_id ?? null

    if (parent_parallel_id)
      return false

    const isParallelStartNode = node.parallelDetail?.isParallelStartNode
    if (!isParallelStartNode)
      return false

    return true
  })

  // print node structure for debug
  // filteredInParallelSubNodes.forEach((node) => {
  //   const now = Date.now()
  //   console.log(`----- p: ${now} start -----`)
  //   printNodeStructure(node, 0)
  //   console.log(`----- p: ${now} end -----`)
  // })

  const parallelNumRecord: Record<string, number> = {
    num: 0,
  }

  addTitle({
    list: filteredInParallelSubNodes,
    level: 1,
    parallelNumRecord,
  }, t)

  return filteredInParallelSubNodes
}
export default format
