'use client'
import type { FC } from 'react'
import React from 'react'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import BlockIcon from '../block-icon'
import type { ToolWithProvider } from '../types'
import { BlockEnum } from '../types'
import type { ToolDefaultValue } from './types'
import Tooltip from '@/app/components/base/tooltip'
import type { Tool } from '@/app/components/tools/types'
import { useGetLanguage } from '@/context/i18n'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  isToolPlugin: boolean // Tool plugin should choose action
  provider: ToolWithProvider
  payload: Tool
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}

const ToolItem: FC<Props> = ({
  className,
  isToolPlugin,
  provider,
  payload,
  onSelect,
}) => {
  const language = useGetLanguage()
  const [isFold, {
    toggle: toggleFold,
  }] = useBoolean(false)

  const FoldIcon = isFold ? RiArrowDownSLine : RiArrowRightSLine

  const actions = [
    'DuckDuckGo AI Search',
    'DuckDuckGo Connect',
  ]

  return (
    <Tooltip
      key={payload.name}
      position='right'
      popupClassName='!p-0 !px-3 !py-2.5 !w-[200px] !leading-[18px] !text-xs !text-gray-700 !border-[0.5px] !border-black/5 !rounded-xl !shadow-lg'
      popupContent={(
        <div>
          <BlockIcon
            size='md'
            className='mb-2'
            type={BlockEnum.Tool}
            toolIcon={provider.icon}
          />
          <div className='mb-1 text-sm leading-5 text-gray-900'>{payload.label[language]}</div>
          <div className='text-xs text-gray-700 leading-[18px]'>{payload.description[language]}</div>
        </div>
      )}
    >
      <div className={cn(className)}>
        <div
          className='flex items-center justify-between pl-3 pr-1 w-full rounded-lg hover:bg-gray-50 cursor-pointer'
          onClick={() => {
            if (isToolPlugin) {
              toggleFold()
              return
            }
            onSelect(BlockEnum.Tool, {
              provider_id: provider.id,
              provider_type: provider.type,
              provider_name: provider.name,
              tool_name: payload.name,
              tool_label: payload.label[language],
              title: payload.label[language],
            })
          }}
        >
          <div className='flex items-center h-8'>
            <BlockIcon
              className='shrink-0'
              type={BlockEnum.Tool}
              toolIcon={provider.icon}
            />
            <div className='ml-2 text-sm text-gray-900 flex-1 min-w-0 truncate'>{payload.label[language]}</div>
          </div>
          {isToolPlugin && (
            <FoldIcon className={cn('w-4 h-4 text-text-quaternary shrink-0', isFold && 'text-text-tertiary')} />
          )}
        </div>
        {(!isFold && isToolPlugin) && (
          <div>
            {actions.map(action => (
              <div
                key={action}
                className='rounded-lg pl-[21px] hover:bg-state-base-hover cursor-pointer'
                onClick={() => {
                  onSelect(BlockEnum.Tool, {
                    provider_id: provider.id,
                    provider_type: provider.type,
                    provider_name: provider.name,
                    tool_name: payload.name,
                    tool_label: payload.label[language],
                    title: payload.label[language],
                  })
                }}
              >
                <div className='h-8 leading-8 border-l-2 border-divider-subtle pl-4 truncate text-text-secondary system-sm-medium'>{action}</div>
              </div>
            ))}
          </div>
        )}
      </div>

    </Tooltip>
  )
}
export default React.memo(ToolItem)
