import type { NodeTracing } from '@/types/workflow'

type TracingNodeProps = {
  id: string
  uniqueId: string
  isParallel: boolean
  data: NodeTracing | null
  children: TracingNodeProps[]
  parallelTitle?: string
  branchTitle?: string
  hideNodeInfo?: boolean
  hideNodeProcessDetail?: boolean
}

function buildLogTree(nodes: NodeTracing[], t: (key: string) => string): TracingNodeProps[] {
  const rootNodes: TracingNodeProps[] = []
  const parallelStacks: { [key: string]: TracingNodeProps } = {}
  const levelCounts: { [key: string]: number } = {}
  const parallelChildCounts: { [key: string]: Set<string> } = {}
  let uniqueIdCounter = 0
  const getUniqueId = () => {
    uniqueIdCounter++
    return `unique-${uniqueIdCounter}`
  }

  const getParallelTitle = (parentId: string | null): string => {
    const levelKey = parentId || 'root'
    if (!levelCounts[levelKey])
      levelCounts[levelKey] = 0

    levelCounts[levelKey]++

    const parentTitle = parentId ? parallelStacks[parentId]?.parallelTitle : ''
    const levelNumber = parentTitle ? Number.parseInt(parentTitle.split('-')[1]) + 1 : 1
    const letter = parallelChildCounts[levelKey]?.size > 1 ? String.fromCharCode(64 + levelCounts[levelKey]) : ''
    return `${t('workflow.common.parallel')}-${levelNumber}${letter}`
  }

  const getBranchTitle = (parentId: string | null, branchNum: number): string => {
    const levelKey = parentId || 'root'
    const parentTitle = parentId ? parallelStacks[parentId]?.parallelTitle : ''
    const levelNumber = parentTitle ? Number.parseInt(parentTitle.split('-')[1]) + 1 : 1
    const letter = parallelChildCounts[levelKey]?.size > 1 ? String.fromCharCode(64 + levelCounts[levelKey]) : ''
    const branchLetter = String.fromCharCode(64 + branchNum)
    return `${t('workflow.common.branch')}-${levelNumber}${letter}-${branchLetter}`
  }

  // Count parallel children (for figuring out if we need to use letters)
  for (const node of nodes) {
    const parent_parallel_id = node.parent_parallel_id ?? node.execution_metadata?.parent_parallel_id ?? null
    const parallel_id = node.parallel_id ?? node.execution_metadata?.parallel_id ?? null

    if (parallel_id) {
      const parentKey = parent_parallel_id || 'root'
      if (!parallelChildCounts[parentKey])
        parallelChildCounts[parentKey] = new Set()

      parallelChildCounts[parentKey].add(parallel_id)
    }
  }

  for (const node of nodes) {
    const parallel_id = node.parallel_id ?? node.execution_metadata?.parallel_id ?? null
    const parent_parallel_id = node.parent_parallel_id ?? node.execution_metadata?.parent_parallel_id ?? null
    const parallel_start_node_id = node.parallel_start_node_id ?? node.execution_metadata?.parallel_start_node_id ?? null
    const parent_parallel_start_node_id = node.parent_parallel_start_node_id ?? node.execution_metadata?.parent_parallel_start_node_id ?? null

    if (!parallel_id || node.node_type === BlockEnum.End) {
      rootNodes.push({
        id: node.id,
        uniqueId: getUniqueId(),
        isParallel: false,
        data: node,
        children: [],
      })
    }
    else {
      if (!parallelStacks[parallel_id]) {
        const newParallelGroup: TracingNodeProps = {
          id: parallel_id,
          uniqueId: getUniqueId(),
          isParallel: true,
          data: null,
          children: [],
          parallelTitle: '',
        }
        parallelStacks[parallel_id] = newParallelGroup

        if (parent_parallel_id && parallelStacks[parent_parallel_id]) {
          const sameBranchIndex = parallelStacks[parent_parallel_id].children.findLastIndex(c =>
            c.data?.execution_metadata?.parallel_start_node_id === parent_parallel_start_node_id || c.data?.parallel_start_node_id === parent_parallel_start_node_id,
          )
          parallelStacks[parent_parallel_id].children.splice(sameBranchIndex + 1, 0, newParallelGroup)
          newParallelGroup.parallelTitle = getParallelTitle(parent_parallel_id)
        }
        else {
          newParallelGroup.parallelTitle = getParallelTitle(parent_parallel_id)
          rootNodes.push(newParallelGroup)
        }
      }
      const branchTitle = parallel_start_node_id === node.node_id ? getBranchTitle(parent_parallel_id, parallelStacks[parallel_id].children.length + 1) : ''
      if (branchTitle) {
        parallelStacks[parallel_id].children.push({
          id: node.id,
          uniqueId: getUniqueId(),
          isParallel: false,
          data: node,
          children: [],
          branchTitle,
        })
      }
      else {
        let sameBranchIndex = parallelStacks[parallel_id].children.findLastIndex(c =>
          c.data?.execution_metadata?.parallel_start_node_id === parallel_start_node_id || c.data?.parallel_start_node_id === parallel_start_node_id,
        )
        if (parallelStacks[parallel_id].children[sameBranchIndex + 1]?.isParallel)
          sameBranchIndex++

        parallelStacks[parallel_id].children.splice(sameBranchIndex + 1, 0, {
          id: node.id,
          uniqueId: getUniqueId(),
          isParallel: false,
          data: node,
          children: [],
          branchTitle,
        })
      }
    }
  }

  return rootNodes
}
