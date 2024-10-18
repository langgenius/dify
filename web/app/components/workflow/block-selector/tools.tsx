import {
  memo,
  useCallback,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { BlockEnum, ToolWithProvider } from '../types'
import { CollectionType } from '../../tools/types'
import IndexBar, { groupItems } from './index-bar'
import type { ToolDefaultValue } from './types'
import ToolItem from './tool-item'
import { ViewType } from './view-type-select'
import Empty from '@/app/components/tools/add-tool-modal/empty'
import { useGetLanguage } from '@/context/i18n'

type ToolsProps = {
  showWorkflowEmpty: boolean
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  tools: ToolWithProvider[]
  viewType: ViewType
}
const Blocks = ({
  showWorkflowEmpty,
  onSelect,
  tools,
  viewType,
}: ToolsProps) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const isListView = viewType === ViewType.list
  const isTreeView = viewType === ViewType.tree

  const { letters, groups: groupedTools } = groupItems(tools, tool => tool.label[language][0])
  const toolRefs = useRef({})

  const renderGroup = useCallback((toolWithProvider: ToolWithProvider) => {
    const list = toolWithProvider.tools

    return (
      <div
        key={toolWithProvider.id}
        className='mb-1 last-of-type:mb-0'
      >
        {isTreeView && (
          <div className='flex items-start px-3 h-[22px] text-xs font-medium text-gray-500'>
            {toolWithProvider.label[language]}
          </div>
        )}
        {
          list.map(tool => (
            <ToolItem
              key={tool.name}
              className={isListView && 'mr-6'}
              isToolPlugin={toolWithProvider.type === CollectionType.builtIn}
              provider={toolWithProvider}
              payload={tool}
              onSelect={onSelect}
            />
          ))
        }
      </div>
    )
  }, [onSelect, language])

  const renderLetterGroup = (letter) => {
    const tools = groupedTools[letter]
    return (
      <div
        key={letter}
        ref={el => (toolRefs.current[letter] = el)}
      >
        {tools.map(renderGroup)}
      </div>
    )
  }

  return (
    <div className='p-1 max-w-[320px]'>
      {
        !tools.length && !showWorkflowEmpty && (
          <div className='flex items-center px-3 h-[22px] text-xs font-medium text-gray-500'>{t('workflow.tabs.noResult')}</div>
        )
      }
      {!tools.length && showWorkflowEmpty && (
        <div className='py-10'>
          <Empty />
        </div>
      )}
      {!!tools.length && letters.map(renderLetterGroup)}
      {isListView && tools.length > 10 && <IndexBar letters={letters} itemRefs={toolRefs} />}
    </div>
  )
}

export default memo(Blocks)
