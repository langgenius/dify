import type { BlockEnum, ToolWithProvider } from '../../types'
import type { ToolDefaultValue } from '../types'
import type { Plugin } from '@/app/components/plugins/types'
import type { OnSelectBlock } from '@/app/components/workflow/types'
import { useCallback, useMemo, useRef } from 'react'
import { useGetLanguage } from '@/context/i18n'
import { cn } from '@/utils/classnames'
import { groupItems } from '../index-bar'
import ToolListFlatView from '../tool/tool-list-flat-view/list'
import ToolListTreeView from '../tool/tool-list-tree-view/list'
import { ViewType } from '../view-type-select'
import UninstalledItem from './uninstalled-item'

type ListProps = {
  onSelect: OnSelectBlock
  tools: ToolWithProvider[]
  viewType: ViewType
  unInstalledPlugins: Plugin[]
  className?: string
}

const List = ({
  onSelect,
  tools,
  viewType,
  unInstalledPlugins,
  className,
}: ListProps) => {
  const language = useGetLanguage()
  const isFlatView = viewType === ViewType.flat

  const { letters, groups: withLetterAndGroupViewToolsData } = groupItems(tools, tool => tool.label[language][0])
  const treeViewToolsData = useMemo(() => {
    const result: Record<string, ToolWithProvider[]> = {}
    Object.keys(withLetterAndGroupViewToolsData).forEach((letter) => {
      Object.keys(withLetterAndGroupViewToolsData[letter]).forEach((groupName) => {
        if (!result[groupName])
          result[groupName] = []
        result[groupName].push(...withLetterAndGroupViewToolsData[letter][groupName])
      })
    })
    return result
  }, [withLetterAndGroupViewToolsData])

  const listViewToolData = useMemo(() => {
    const result: ToolWithProvider[] = []
    letters.forEach((letter) => {
      Object.keys(withLetterAndGroupViewToolsData[letter]).forEach((groupName) => {
        result.push(...withLetterAndGroupViewToolsData[letter][groupName].map((item) => {
          return {
            ...item,
            letter,
          }
        }))
      })
    })

    return result
  }, [withLetterAndGroupViewToolsData, letters])

  const toolRefs = useRef({})

  const handleSelect = useCallback((type: BlockEnum, tool: ToolDefaultValue) => {
    onSelect(type, tool)
  }, [onSelect])

  return (
    <div className={cn('max-w-[100%] p-1', className)}>
      {!!tools.length && (
        isFlatView
          ? (
              <ToolListFlatView
                toolRefs={toolRefs}
                letters={letters}
                payload={listViewToolData}
                isShowLetterIndex={false}
                hasSearchText={false}
                onSelect={handleSelect}
                canNotSelectMultiple
                indexBar={null}
              />
            )
          : (
              <ToolListTreeView
                payload={treeViewToolsData}
                hasSearchText={false}
                onSelect={handleSelect}
                canNotSelectMultiple
              />
            )
      )}
      {
        unInstalledPlugins.map((item) => {
          return (
            <UninstalledItem
              key={item.plugin_id}
              payload={item}
            />
          )
        })
      }
    </div>
  )
}

export default List
