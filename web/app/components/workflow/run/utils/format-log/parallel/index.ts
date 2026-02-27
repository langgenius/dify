import type { NodeTracing } from '@/types/workflow'
import { BlockEnum } from '@/app/components/workflow/types'

function printNodeStructure(node: NodeTracing, depth: number) {
  const indent = '  '.repeat(depth)
  console.log(`${indent}${node.title}`)
  if (node.parallelDetail?.children) {
    node.parallelDetail.children.forEach((child) => {
      printNodeStructure(child, depth + 1)
    })
  }
}

function addTitle({
  list,
  depth,
  belongParallelIndexInfo,
}: {
  list: NodeTracing[]
  depth: number
  belongParallelIndexInfo?: string
}, t: any) {
  let branchIndex = 0
  const hasMoreThanOneParallel = list.filter(node => node.parallelDetail?.isParallelStartNode).length > 1
  list.forEach((node) => {
    const parallel_id = node.parallel_id ?? node.execution_metadata?.parallel_id ?? null
    const parallel_start_node_id = node.parallel_start_node_id ?? node.execution_metadata?.parallel_start_node_id ?? null

    const isNotInParallel = !parallel_id || node.node_type === BlockEnum.End
    if (isNotInParallel)
      return

    const isParallelStartNode = node.parallelDetail?.isParallelStartNode

    const parallelIndexLetter = (() => {
      if (!isParallelStartNode || !hasMoreThanOneParallel)
        return ''

      const index = 1 + list.filter(node => node.parallelDetail?.isParallelStartNode).findIndex(item => item.node_id === node.node_id)
      return String.fromCharCode(64 + index)
    })()

    const parallelIndexInfo = `${depth}${parallelIndexLetter}`

    if (isParallelStartNode) {
      node.parallelDetail!.isParallelStartNode = true
      node.parallelDetail!.parallelTitle = `${t('common.parallel', { ns: 'workflow' })}-${parallelIndexInfo}`
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

      node.parallelDetail!.branchTitle = `${t('common.branch', { ns: 'workflow' })}-${belongParallelIndexInfo}-${branchLetter}`
    }

    if (node.parallelDetail?.children && node.parallelDetail.children.length > 0) {
      addTitle({
        list: node.parallelDetail.children,
        depth: depth + 1,
        belongParallelIndexInfo: parallelIndexInfo,
      }, t)
    }
  })
}

// list => group by parallel_id(parallel tree).
const format = (list: NodeTracing[], t: any, isPrint?: boolean): NodeTracing[] => {
  if (isPrint)
    console.log(list)

  const result: NodeTracing[] = [...list]
  // list to tree by parent_parallel_start_node_id and branch by parallel_start_node_id. Each parallel may has more than one branch.
  result.forEach((node) => {
    const parallel_id = node.parallel_id ?? node.execution_metadata?.parallel_id ?? null
    const parallel_start_node_id = node.parallel_start_node_id ?? node.execution_metadata?.parallel_start_node_id ?? null
    const parent_parallel_id = node.parent_parallel_id ?? node.execution_metadata?.parent_parallel_id ?? null
    const branchStartNodeId = node.parallel_start_node_id ?? node.execution_metadata?.parallel_start_node_id ?? null
    const parentParallelBranchStartNodeId = node.parent_parallel_start_node_id ?? node.execution_metadata?.parent_parallel_start_node_id ?? null
    const isNotInParallel = !parallel_id || node.node_type === BlockEnum.End
    if (isNotInParallel)
      return

    const isParallelStartNode = parallel_start_node_id === node.node_id // in the same parallel has more than one start node
    if (isParallelStartNode) {
      const selfNode = { ...node, parallelDetail: undefined }
      node.parallelDetail = {
        isParallelStartNode: true,
        children: [selfNode],
      }
      const isRootLevel = !parent_parallel_id
      if (isRootLevel)
        return

      const parentParallelStartNode = result.find(item => item.node_id === parentParallelBranchStartNodeId)
      // append to parent parallel start node and after the same branch
      if (parentParallelStartNode) {
        if (!parentParallelStartNode?.parallelDetail) {
          parentParallelStartNode!.parallelDetail = {
            children: [],
          }
        }
        if (parentParallelStartNode!.parallelDetail.children) {
          const sameBranchNodesLastIndex = parentParallelStartNode.parallelDetail.children.findLastIndex((node) => {
            const currStartNodeId = node.parallel_start_node_id ?? node.execution_metadata?.parallel_start_node_id ?? null
            return currStartNodeId === parentParallelBranchStartNodeId
          })
          if (sameBranchNodesLastIndex !== -1)
            parentParallelStartNode!.parallelDetail.children.splice(sameBranchNodesLastIndex + 1, 0, node)
          else
            parentParallelStartNode!.parallelDetail.children.push(node)
        }
      }
      return
    }

    // append to parallel start node and after the same branch
    const parallelStartNode = result.find(item => parallel_start_node_id === item.node_id)

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
  if (isPrint) {
    filteredInParallelSubNodes.forEach((node) => {
      const now = Date.now()
      console.log(`----- p: ${now} start -----`)
      printNodeStructure(node, 0)
      console.log(`----- p: ${now} end -----`)
    })
  }

  addTitle({
    list: filteredInParallelSubNodes,
    depth: 1,
  }, t)

  return filteredInParallelSubNodes
}
export default format
