import {
  useMemo,
  useRef,
} from 'react'
import type { BlockEnum, ToolWithProvider } from '../../types'
import type { ToolDefaultValue } from '../types'
import { ViewType } from '../view-type-select'
import { useGetLanguage } from '@/context/i18n'
import { groupItems } from '../index-bar'
import cn from '@/utils/classnames'
import ToolListTreeView from '../tool/tool-list-tree-view/list'
import ToolListFlatView from '../tool/tool-list-flat-view/list'
import UninstalledItem from './uninstalled-item'
import type { Plugin } from '@/app/components/plugins/types'

type ListProps = {
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
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

  return (
    <div className={cn('max-w-[100%] p-1', className)}>
      {!!tools.length && (
        isFlatView ? (
          <ToolListFlatView
            toolRefs={toolRefs}
            letters={letters}
            payload={listViewToolData}
            isShowLetterIndex={false}
            hasSearchText={false}
            onSelect={onSelect}
            canNotSelectMultiple
            indexBar={null}
          />
        ) : (
          <ToolListTreeView
            payload={treeViewToolsData}
            hasSearchText={false}
            onSelect={onSelect}
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
