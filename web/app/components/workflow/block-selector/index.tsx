import {
  useMemo,
} from 'react'
import type { NodeSelectorProps } from './main'
import NodeSelector from './main'
import { useHooksStore } from '@/app/components/workflow/hooks-store/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { useStore } from '@/app/components/workflow/store'
import { useDataSourceList } from '@/service/use-pipeline'

const NodeSelectorWrapper = (props: NodeSelectorProps) => {
  const availableNodesMetaData = useHooksStore(s => s.availableNodesMetaData)

  const blocks = useMemo(() => {
    const result = availableNodesMetaData?.nodes || []

    return result.filter((block) => {
      if (block.metaData.type === BlockEnum.Start)
        return false

      if (block.metaData.type === BlockEnum.DataSource)
        return false

      if (block.metaData.type === BlockEnum.IterationStart)
        return false

      if (block.metaData.type === BlockEnum.LoopStart)
        return false

      return true
    })
  }, [availableNodesMetaData?.nodes])

  const pipelineId = useStore(s => s.pipelineId)
  const { data: dataSourceList } = useDataSourceList(!!pipelineId)

  return (
    <NodeSelector
      {...props}
      blocks={blocks}
      dataSources={dataSourceList || []}
    />
  )
}

export default NodeSelectorWrapper
