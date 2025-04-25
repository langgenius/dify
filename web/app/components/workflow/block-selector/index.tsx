import { useMemo } from 'react'
import type { NodeSelectorProps } from './main'
import NodeSelector from './main'
import { useHooksStore } from '@/app/components/workflow/hooks-store/store'
import { BlockEnum } from '@/app/components/workflow/types'

const NodeSelectorWrapper = (props: NodeSelectorProps) => {
  const availableNodesMetaData = useHooksStore(s => s.availableNodesMetaData)

  const blocks = useMemo(() => {
    const result = availableNodesMetaData?.nodes || []
    console.log(result, 'result')

    return result.filter((block) => {
      if (block.type === BlockEnum.Start)
        return false

      if (block.type === BlockEnum.IterationStart)
        return false

      if (block.type === BlockEnum.LoopStart)
        return false

      return true
    })
  }, [availableNodesMetaData?.nodes])

  return (
    <NodeSelector
      {...props}
      blocks={blocks}
    />
  )
}

export default NodeSelectorWrapper
