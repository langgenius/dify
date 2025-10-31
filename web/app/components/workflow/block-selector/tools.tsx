import {
  memo,
  useMemo,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { BlockEnum, ToolWithProvider } from '../types'
import IndexBar, { groupItems } from './index-bar'
import type { ToolDefaultValue, ToolValue } from './types'
import type { ToolTypeEnum } from './types'
import { ViewType } from './view-type-select'
import Empty from '@/app/components/tools/add-tool-modal/empty'
import { useGetLanguage } from '@/context/i18n'
import ToolListTreeView from './tool/tool-list-tree-view/list'
import ToolListFlatView from './tool/tool-list-flat-view/list'
import classNames from '@/utils/classnames'

type ToolsProps = {
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
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
  canChooseMCPTool?: boolean
  isShowRAGRecommendations?: boolean
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
  canChooseMCPTool,
  isShowRAGRecommendations = false,
}: ToolsProps) => {
  // const tools: any = []
  const { t } = useTranslation()
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
    <div className={classNames('max-w-[100%] p-1', className)}>
      {
        !tools.length && hasSearchText && (
          <div className='mt-2 flex h-[22px] items-center px-3 text-xs font-medium text-text-secondary'>{t('workflow.tabs.noResult')}</div>
        )
      }
      {!tools.length && !hasSearchText && (
        <div className='py-10'>
          <Empty type={toolType!} isAgent={isAgent} />
        </div>
      )}
      {!!tools.length && isShowRAGRecommendations && (
        <div className='system-xs-medium px-3 pb-0.5 pt-1 text-text-tertiary'>
          {t('tools.allTools')}
        </div>
      )}
      {!!tools.length && (
        isFlatView ? (
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
            canChooseMCPTool={canChooseMCPTool}
            indexBar={<IndexBar letters={letters} itemRefs={toolRefs} className={indexBarClassName} />}
          />
        ) : (
          <ToolListTreeView
            payload={treeViewToolsData}
            hasSearchText={hasSearchText}
            onSelect={onSelect}
            canNotSelectMultiple={canNotSelectMultiple}
            onSelectMultiple={onSelectMultiple}
            selectedTools={selectedTools}
            canChooseMCPTool={canChooseMCPTool}
          />
        )
      )}
    </div>
  )
}

export default memo(Tools)
