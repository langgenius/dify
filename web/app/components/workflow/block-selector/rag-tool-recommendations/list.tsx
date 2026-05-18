import type { BlockEnum, ToolWithProvider } from '../../types'
import type { ToolActionPreviewPayload } from '../tool/action-item'
import type { ToolDefaultValue } from '../types'
import type { Plugin } from '@/app/components/plugins/types'
import type { OnSelectBlock } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { createPreviewCardHandle, PreviewCard } from '@langgenius/dify-ui/preview-card'
import { useCallback, useMemo, useRef } from 'react'
import { useGetLanguage } from '@/context/i18n'
import { groupItems } from '../index-bar'
import { ToolActionPreviewCard } from '../tool/action-item'
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
  const previewCardHandle = useMemo(() => createPreviewCardHandle<ToolActionPreviewPayload>(), [])
  const isFlatView = viewType === ViewType.flat

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

  const handleSelect = useCallback((type: BlockEnum, tool: ToolDefaultValue) => {
    onSelect(type, tool)
  }, [onSelect])

  return (
    <div className={cn('max-w-full p-1', className)}>
      {!!tools.length && (
        isFlatView
          ? (
              <ToolListFlatView
                toolRefs={toolRefsRef}
                letters={letters}
                payload={listViewToolData}
                previewCardHandle={previewCardHandle}
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
                previewCardHandle={previewCardHandle}
                hasSearchText={false}
                onSelect={handleSelect}
                canNotSelectMultiple
              />
            )
      )}
      <PreviewCard handle={previewCardHandle}>
        {({ payload }) => (
          <ToolActionPreviewCard payload={payload as ToolActionPreviewPayload | undefined} />
        )}
      </PreviewCard>
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
