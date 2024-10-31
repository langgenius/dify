'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import { useGetLanguage } from '@/context/i18n'
import { CollectionType } from '../../../tools/types'
import type { ToolWithProvider } from '../../types'
import { BlockEnum } from '../../types'
import type { ToolDefaultValue } from '../types'
import { ViewType } from '../view-type-select'
import ActonItem from './action-item'
import BlockIcon from '../../block-icon'

import { useBoolean } from 'ahooks'

type Props = {
  className?: string
  payload: ToolWithProvider
  viewType: ViewType
  isShowLetterIndex: boolean
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}

const Tool: FC<Props> = ({
  className,
  payload,
  viewType,
  isShowLetterIndex,
  onSelect,
}) => {
  const language = useGetLanguage()
  const isTreeView = viewType === ViewType.tree
  const actions = payload.tools
  const hasAction = payload.type === CollectionType.builtIn
  const [isFold, {
    toggle: toggleFold,
  }] = useBoolean(false)
  const FoldIcon = isFold ? RiArrowDownSLine : RiArrowRightSLine

  return (
    <div
      key={payload.id}
      className='mb-1 last-of-type:mb-0'
    >
      <div className={cn(className)}>
        <div
          className='flex items-center justify-between pl-3 pr-1 w-full rounded-lg hover:bg-gray-50 cursor-pointer select-none'
          onClick={() => {
            if (hasAction) {
              toggleFold()
              return
            }
            onSelect(BlockEnum.Tool, {
              provider_id: payload.id,
              provider_type: payload.type,
              provider_name: payload.name,
              tool_name: payload.name,
              tool_label: payload.label[language],
              title: payload.label[language],
            })
          }}
        >
          <div className='flex grow items-center h-8'>
            <BlockIcon
              className='shrink-0'
              type={BlockEnum.Tool}
              toolIcon={payload.icon}
            />
            <div className='ml-2 text-sm text-gray-900 flex-1 w-0 grow truncate'>{payload.label[language]}</div>
          </div>
          {hasAction && (
            <FoldIcon className={cn('w-4 h-4 text-text-quaternary shrink-0', isFold && 'text-text-tertiary')} />
          )}
        </div>

        {hasAction && isFold && (
          actions.map(action => (
            <ActonItem
              key={action.name}
              className={cn(isShowLetterIndex && 'mr-6')}
              provider={payload}
              payload={action}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  )
}
export default React.memo(Tool)
