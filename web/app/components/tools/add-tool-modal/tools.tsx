import {
  memo,
  useCallback,
} from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
} from '@remixicon/react'
import { ArrowUpRight } from '@/app/components/base/icons/src/vender/line/arrows'
import { Check } from '@/app/components/base/icons/src/vender/line/general'
import { Tag01 } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import BlockIcon from '@/app/components/workflow/block-icon'
import Tooltip from '@/app/components/base/tooltip'
import Button from '@/app/components/base/button'
import { useGetLanguage } from '@/context/i18n'
import { useStore as useLabelStore } from '@/app/components/tools/labels/store'
import Empty from '@/app/components/tools/add-tool-modal/empty'
import type { Tool } from '@/app/components/tools/types'
import { CollectionType } from '@/app/components/tools/types'
import type { AgentTool } from '@/types/app'
import { MAX_TOOLS_NUM } from '@/config'

type ToolsProps = {
  showWorkflowEmpty: boolean
  tools: ToolWithProvider[]
  addedTools: AgentTool[]
  onSelect: (provider: ToolWithProvider, tool: Tool) => void
  onAuthSetup: (provider: ToolWithProvider) => void
}
const Blocks = ({
  showWorkflowEmpty,
  tools,
  addedTools,
  onSelect,
  onAuthSetup,
}: ToolsProps) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const labelList = useLabelStore(s => s.labelList)
  const addable = addedTools.length < MAX_TOOLS_NUM

  const renderGroup = useCallback((toolWithProvider: ToolWithProvider) => {
    const list = toolWithProvider.tools
    const needAuth = toolWithProvider.allow_delete && !toolWithProvider.is_team_authorization && toolWithProvider.type === CollectionType.builtIn

    return (
      <div
        key={toolWithProvider.id}
        className='group mb-1 last-of-type:mb-0'
      >
        <div className='flex items-center justify-between w-full pl-3 pr-1 h-[22px] text-xs font-medium text-gray-500'>
          {toolWithProvider.label[language]}
          <a className='hidden cursor-pointer items-center group-hover:flex' href={`/tools?category=${toolWithProvider.type}`} target='_blank'>{t('tools.addToolModal.manageInTools')}<ArrowUpRight className='ml-0.5 w-3 h-3' /></a>
        </div>
        {list.map((tool) => {
          const labelContent = (() => {
            if (!tool.labels)
              return ''
            return tool.labels.map((name) => {
              const label = labelList.find(item => item.name === name)
              return label?.label[language]
            }).filter(Boolean).join(', ')
          })()
          const added = !!addedTools?.find(v => v.provider_id === toolWithProvider.id && v.provider_type === toolWithProvider.type && v.tool_name === tool.name)
          return (
            <Tooltip
              key={tool.name}
              selector={`workflow-block-tool-${tool.name}`}
              position='bottom'
              className='!p-0 !px-3 !py-2.5 !w-[210px] !leading-[18px] !text-xs !text-gray-700 !border-[0.5px] !border-black/5 !bg-transparent !rounded-xl !shadow-lg translate-x-[108px]'
              htmlContent={(
                <div>
                  <BlockIcon
                    size='md'
                    className='mb-2'
                    type={BlockEnum.Tool}
                    toolIcon={toolWithProvider.icon}
                  />
                  <div className='mb-1 text-sm leading-5 text-gray-900'>{tool.label[language]}</div>
                  <div className='text-xs text-gray-700 leading-[18px]'>{tool.description[language]}</div>
                  {tool.labels?.length > 0 && (
                    <div className='flex items-center shrink-0 mt-1'>
                      <div className='relative w-full flex items-center gap-1 py-1 rounded-md text-gray-500' title={labelContent}>
                        <Tag01 className='shrink-0 w-3 h-3 text-gray-500' />
                        <div className='grow text-xs text-start leading-[18px] font-normal truncate'>{labelContent}</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              noArrow
            >
              <div className='group/item flex items-center w-full pl-3 pr-1 h-8 rounded-lg hover:bg-gray-50 cursor-pointer'>
                <BlockIcon
                  className={cn('mr-2 shrink-0', needAuth && 'opacity-30')}
                  type={BlockEnum.Tool}
                  toolIcon={toolWithProvider.icon}
                />
                <div className={cn('grow text-sm text-gray-900 truncate', needAuth && 'opacity-30')}>{tool.label[language]}</div>
                {!needAuth && added && (
                  <div className='flex items-center gap-1 rounded-[6px] border border-gray-100 px-2 py-[3px] bg-white text-gray-300 text-xs font-medium leading-[18px]'>
                    <Check className='w-3 h-3' />
                    {t('tools.addToolModal.added').toLocaleUpperCase()}
                  </div>
                )}
                {!needAuth && !added && addable && (
                  <Button
                    variant='secondary-accent'
                    size='small'
                    className={cn('hidden shrink-0 items-center group-hover/item:flex')}
                    onClick={() => onSelect(toolWithProvider, tool)}
                  >
                    <RiAddLine className='w-3 h-3' />
                    {t('tools.addToolModal.add').toLocaleUpperCase()}
                  </Button>
                )}
                {needAuth && (
                  <Button
                    variant='secondary-accent'
                    size='small'
                    className={cn('hidden shrink-0 group-hover/item:flex')}
                    onClick={() => onAuthSetup(toolWithProvider)}
                  >{t('tools.auth.setup')}</Button>
                )}
              </div>
            </Tooltip>
          )
        })}
      </div>
    )
  }, [addable, language, t, labelList, addedTools, onAuthSetup, onSelect])

  return (
    <div className='p-1 pb-6 max-w-[440px]'>
      {!tools.length && !showWorkflowEmpty && (
        <div className='flex items-center px-3 h-[22px] text-xs font-medium text-gray-500'>{t('workflow.tabs.noResult')}</div>
      )}
      {!tools.length && showWorkflowEmpty && (
        <div className='pt-[280px]'>
          <Empty />
        </div>
      )}
      {!!tools.length && tools.map(renderGroup)}
    </div>
  )
}

export default memo(Blocks)
