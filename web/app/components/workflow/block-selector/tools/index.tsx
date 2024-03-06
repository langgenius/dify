import {
  memo,
  useCallback,
} from 'react'
import produce from 'immer'
import { useStore } from '../../store'
import type { BlockEnum } from '../../types'
import type {
  ToolDefaultValue,
  ToolInWorkflow,
} from '../types'
import Item from './item'

type ToolsProps = {
  isCustom?: boolean
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}
const Tools = ({
  isCustom,
  onSelect,
}: ToolsProps) => {
  const toolsets = useStore(state => state.toolsets).filter(toolset => toolset.type === (isCustom ? 'api' : 'builtin'))
  const setToolsets = useStore(state => state.setToolsets)
  const toolsMap = useStore(state => state.toolsMap)
  const setToolsMap = useStore(state => state.setToolsMap)

  const handleExpand = useCallback((toolId: string) => {
    const currentToolset = toolsets.find(toolset => toolset.id === toolId)!

    if (currentToolset.expanded) {
      setToolsets(produce(toolsets, (draft) => {
        const index = draft.findIndex(toolset => toolset.id === toolId)
        draft[index].expanded = false
      }))
      return
    }

    if (!currentToolset.expanded) {
      setToolsets(produce(toolsets, (draft) => {
        const index = draft.findIndex(toolset => toolset.id === toolId)

        if (!toolsMap[toolId].length && !currentToolset.fetching)
          draft[index].fetching = true

        draft[index].expanded = true
      }))
    }
  }, [setToolsets, toolsets, toolsMap])

  const handleAddTools = useCallback((toolsetId: string, tools: ToolInWorkflow[]) => {
    setToolsMap(produce(toolsMap, (draft) => {
      draft[toolsetId] = tools
    }))
  }, [setToolsMap, toolsMap])

  const handleFetched = useCallback((toolsetId: string) => {
    setToolsets(produce(toolsets, (draft) => {
      const index = draft.findIndex(toolset => toolset.id === toolsetId)
      draft[index].fetching = false
    }))
  }, [setToolsets, toolsets])

  return (
    <div className='p-1 max-h-[464px] overflow-y-auto'>
      {
        toolsets.map(toolset => (
          <Item
            key={toolset.id}
            data={toolset}
            tools={toolsMap[toolset.id]}
            onExpand={handleExpand}
            onAddTools={handleAddTools}
            onFetched={handleFetched}
            onSelect={onSelect}
          />
        ))
      }
    </div>
  )
}

export default memo(Tools)
