import {
  memo,
  useCallback,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import BlockIcon from '../block-icon'
import { BlockEnum } from '../types'
import type { ToolWithProvider } from '../types'
import IndexBar, { groupItems } from './index-bar'
import type { ToolDefaultValue } from './types'
import Tooltip from '@/app/components/base/tooltip'
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
            <Tooltip
              key={tool.name}
              position='right'
              popupClassName='w-[200px]'
              popupContent={(
                <div>
                  <BlockIcon
                    size='md'
                    className='mb-2'
                    type={BlockEnum.Tool}
                    toolIcon={toolWithProvider.icon}
                  />
                  <div className='mb-1 system-md-medium text-text-primary'>{tool.label[language]}</div>
                  <div className='system-xs-regular text-text-tertiary'>{tool.description[language]}</div>
                </div>
              )}
            >
              <div
                className='flex items-center px-3 w-full h-8 rounded-lg hover:bg-state-base-hover cursor-pointer'
                onClick={() => onSelect(BlockEnum.Tool, {
                  provider_id: toolWithProvider.id,
                  provider_type: toolWithProvider.type,
                  provider_name: toolWithProvider.name,
                  tool_name: tool.name,
                  tool_label: tool.label[language],
                  title: tool.label[language],
                })}
              >
                <BlockIcon
                  className='mr-2 shrink-0'
                  type={BlockEnum.Tool}
                  toolIcon={toolWithProvider.icon}
                />
                <div className='text-sm text-text-secondary flex-1 min-w-0 truncate'>{tool.label[language]}</div>
              </div>
            </Tooltip>
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
          <div className='flex items-center px-3 h-[22px] text-xs font-medium text-text-tertiary'>{t('workflow.tabs.noResult')}</div>
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
