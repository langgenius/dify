import {
  memo,
  useCallback,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { BlockEnum, ToolWithProvider } from '../types'
import IndexBar, { groupItems } from './index-bar'
import type { ToolDefaultValue } from './types'
import ToolItem from './tool-item'
import Empty from '@/app/components/tools/add-tool-modal/empty'
import { useGetLanguage } from '@/context/i18n'

type ToolsProps = {
  showWorkflowEmpty: boolean
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  tools: ToolWithProvider[]
}
const Blocks = ({
  showWorkflowEmpty,
  onSelect,
  tools,
}: ToolsProps) => {
  const { t } = useTranslation()
  const language = useGetLanguage()

  const { letters, groups: groupedTools } = groupItems(tools, tool => tool.label[language][0])
  const toolRefs = useRef({})

  const renderGroup = useCallback((toolWithProvider: ToolWithProvider) => {
    const list = toolWithProvider.tools

    return (
      <div
        key={toolWithProvider.id}
        className='mb-1 last-of-type:mb-0'
      >
        <div className='flex items-start px-3 h-[22px] text-xs font-medium text-gray-500'>
          {toolWithProvider.label[language]}
        </div>
        {
          list.map(tool => (
            <ToolItem
              key={tool.name}
              isToolPlugin={toolWithProvider.type === 'builtin'}
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
    <div className='p-1 max-w-[320px] max-h-[464px] overflow-y-auto'>
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
      {tools.length > 10 && <IndexBar letters={letters} itemRefs={toolRefs} />}
    </div>
  )
}

export default memo(Blocks)
