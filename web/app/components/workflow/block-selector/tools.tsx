import type { BlockEnum, ToolWithProvider } from '../types'
import type { ToolDefaultValue, ToolTypeEnum, ToolValue } from './types'
import { memo, useMemo, useRef } from 'react'
import Empty from '@/app/components/tools/provider/empty'
import { useGetLanguage } from '@/context/i18n'
import { cn } from '@/utils/classnames'
import IndexBar, { groupItems } from './index-bar'
import ToolListFlatView from './tool/tool-list-flat-view/list'
import ToolListTreeView from './tool/tool-list-tree-view/list'
import { ViewType } from './view-type-select'

type ToolsProps = {
  onSelect: (type: BlockEnum, tool: ToolDefaultValue) => void
  canNotSelectMultiple?: boolean
  onSelectMultiple?: (type: BlockEnum, tools: ToolDefaultValue[]) => void
  tools: ToolWithProvider[]
  viewType: ViewType
  hasSearchText: boolean
  toolType?: ToolTypeEnum
  isAgent?: boolean
  className?: string
  indexBarClassName?: string
  selectedTools?: ToolValue[]
}
const Tools = ({
  onSelect,
  canNotSelectMultiple,
  onSelectMultiple,
  tools,
  viewType,
  hasSearchText,
  toolType,
  isAgent,
  className,
  indexBarClassName,
  selectedTools,
}: ToolsProps) => {
  // const tools: any = []
  const language = useGetLanguage()
  const isFlatView = viewType === ViewType.flat
  const isShowLetterIndex = isFlatView && tools.length > 10

  /*
  treeViewToolsData:
  {
    A: {
      'google': [ // plugin organize name
        ...tools
      ],
      'custom': [ // custom tools
        ...tools
      ],
      'workflow': [ // workflow as tools
        ...tools
      ]
    }
  }
  */
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
      {!tools.length && !hasSearchText && (
        <div className="py-10">
          <Empty type={toolType!} isAgent={isAgent} />
        </div>
      )}
      {!!tools.length && (
        isFlatView
          ? (
              <ToolListFlatView
                toolRefs={toolRefs}
                letters={letters}
                payload={listViewToolData}
                isShowLetterIndex={isShowLetterIndex}
                hasSearchText={hasSearchText}
                onSelect={onSelect}
                canNotSelectMultiple={canNotSelectMultiple}
                onSelectMultiple={onSelectMultiple}
                selectedTools={selectedTools}
                indexBar={<IndexBar letters={letters} itemRefs={toolRefs} className={indexBarClassName} />}
              />
            )
          : (
              <ToolListTreeView
                payload={treeViewToolsData}
                hasSearchText={hasSearchText}
                onSelect={onSelect}
                canNotSelectMultiple={canNotSelectMultiple}
                onSelectMultiple={onSelectMultiple}
                selectedTools={selectedTools}
              />
            )
      )}
    </div>
  )
}

export default memo(Tools)
