import type { BlockEnum, ToolWithProvider } from '../types'
import type { ToolActionPreviewPayload } from './tool/action-item'
import type { ToolDefaultValue, ToolTypeEnum, ToolValue } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { createPreviewCardHandle, PreviewCard } from '@langgenius/dify-ui/preview-card'
import { memo, useMemo, useRef } from 'react'
import Empty from '@/app/components/tools/provider/empty'
import { useGetLanguage } from '@/context/i18n'
import IndexBar, { groupItems } from './index-bar'
import { ToolActionPreviewCard } from './tool/action-item'
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
  const language = useGetLanguage()
  const previewCardHandle = useMemo(() => createPreviewCardHandle<ToolActionPreviewPayload>(), [])
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
  const { letters, groups: withLetterAndGroupViewToolsData } = groupItems(tools, tool => tool.label[language]![0]!)
  const treeViewToolsData = useMemo(() => {
    const result: Record<string, ToolWithProvider[]> = {}
    Object.keys(withLetterAndGroupViewToolsData).forEach((letter) => {
      Object.keys(withLetterAndGroupViewToolsData[letter]!).forEach((groupName) => {
        if (!result[groupName])
          result[groupName] = []
        result[groupName].push(...(withLetterAndGroupViewToolsData[letter]![groupName] ?? []))
      })
    })
    return result
  }, [withLetterAndGroupViewToolsData])

  const listViewToolData = useMemo(() => {
    const result: ToolWithProvider[] = []
    letters.forEach((letter) => {
      Object.keys(withLetterAndGroupViewToolsData[letter]!).forEach((groupName) => {
        result.push(...withLetterAndGroupViewToolsData[letter]![groupName]!.map((item) => {
          return {
            ...item,
            letter,
          }
        }))
      })
    })

    return result
  }, [withLetterAndGroupViewToolsData, letters])

  const toolRefsRef = useRef<Record<string, HTMLDivElement | null>>({})

  return (
    <div className={cn('max-w-full p-1', className)}>
      {!tools.length && !hasSearchText && (
        <div className="py-10">
          <Empty type={toolType!} isAgent={isAgent} />
        </div>
      )}
      {!!tools.length && (
        isFlatView
          ? (
              <ToolListFlatView
                toolRefs={toolRefsRef}
                letters={letters}
                payload={listViewToolData}
                previewCardHandle={previewCardHandle}
                isShowLetterIndex={isShowLetterIndex}
                hasSearchText={hasSearchText}
                onSelect={onSelect}
                canNotSelectMultiple={canNotSelectMultiple}
                onSelectMultiple={onSelectMultiple}
                selectedTools={selectedTools}
                indexBar={<IndexBar letters={letters} itemRefs={toolRefsRef} className={indexBarClassName} />}
              />
            )
          : (
              <ToolListTreeView
                payload={treeViewToolsData}
                previewCardHandle={previewCardHandle}
                hasSearchText={hasSearchText}
                onSelect={onSelect}
                canNotSelectMultiple={canNotSelectMultiple}
                onSelectMultiple={onSelectMultiple}
                selectedTools={selectedTools}
              />
            )
      )}
      <PreviewCard handle={previewCardHandle}>
        {({ payload }) => (
          <ToolActionPreviewCard payload={payload as ToolActionPreviewPayload | undefined} />
        )}
      </PreviewCard>
    </div>
  )
}

export default memo(Tools)
