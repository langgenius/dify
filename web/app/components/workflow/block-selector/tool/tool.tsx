'use client'
import type { FC } from 'react'
import React, { useEffect, useMemo } from 'react'
import cn from '@/utils/classnames'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import { useGetLanguage } from '@/context/i18n'
import type { Tool as ToolType } from '../../../tools/types'
import { CollectionType } from '../../../tools/types'
import type { ToolWithProvider } from '../../types'
import { BlockEnum } from '../../types'
import type { ToolDefaultValue, ToolValue } from '../types'
import { ViewType } from '../view-type-select'
import ActonItem from './action-item'
import BlockIcon from '../../block-icon'
import { useTranslation } from 'react-i18next'

type Props = {
  className?: string
  payload: ToolWithProvider
  viewType: ViewType
  isShowLetterIndex: boolean
  hasSearchText: boolean
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  selectedTools?: ToolValue[]
}

const Tool: FC<Props> = ({
  className,
  payload,
  viewType,
  isShowLetterIndex,
  hasSearchText,
  onSelect,
  selectedTools,
}) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const isFlatView = viewType === ViewType.flat
  const actions = payload.tools
  const hasAction = true // Now always support actions
  const [isFold, setFold] = React.useState<boolean>(true)
  const getIsDisabled = (tool: ToolType) => {
    if (!selectedTools || !selectedTools.length) return false
    return selectedTools.some(selectedTool => selectedTool.provider_name === payload.name && selectedTool.tool_name === tool.name)
  }
  useEffect(() => {
    if (hasSearchText && isFold) {
      setFold(false)
      return
    }
    if (!hasSearchText && !isFold)
      setFold(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSearchText])

  const FoldIcon = isFold ? RiArrowRightSLine : RiArrowDownSLine

  const groupName = useMemo(() => {
    if (payload.type === CollectionType.builtIn)
      return payload.author

    if (payload.type === CollectionType.custom)
      return t('workflow.tabs.customTool')

    if (payload.type === CollectionType.workflow)
      return t('workflow.tabs.workflowTool')

    return ''
  }, [payload.author, payload.type, t])

  return (
    <div
      key={payload.id}
      className={cn('mb-1 last-of-type:mb-0', isShowLetterIndex && 'mr-6')}
    >
      <div className={cn(className)}>
        <div
          className='hover:bg-state-base-hover flex w-full cursor-pointer select-none items-center justify-between rounded-lg pl-3 pr-1'
          onClick={() => {
            if (hasAction)
              setFold(!isFold)

            // Now always support actions
            // if (payload.parameters) {
            //   payload.parameters.forEach((item) => {
            //     params[item.name] = ''
            //   })
            // }
            // onSelect(BlockEnum.Tool, {
            //   provider_id: payload.id,
            //   provider_type: payload.type,
            //   provider_name: payload.name,
            //   tool_name: payload.name,
            //   tool_label: payload.label[language],
            //   title: payload.label[language],
            //   params: {},
            // })
          }}
        >
          <div className='flex h-8 grow items-center'>
            <BlockIcon
              className='shrink-0'
              type={BlockEnum.Tool}
              toolIcon={payload.icon}
            />
            <div className='text-text-primary ml-2 w-0 flex-1 grow truncate text-sm'>{payload.label[language]}</div>
          </div>

          <div className='flex items-center'>
            {isFlatView && (
              <div className='text-text-tertiary system-xs-regular'>{groupName}</div>
            )}
            {hasAction && (
              <FoldIcon className={cn('text-text-quaternary h-4 w-4 shrink-0', isFold && 'text-text-tertiary')} />
            )}
          </div>
        </div>

        {hasAction && !isFold && (
          actions.map(action => (
            <ActonItem
              key={action.name}
              provider={payload}
              payload={action}
              onSelect={onSelect}
              disabled={getIsDisabled(action)}
            />
          ))
        )}
      </div>
    </div>
  )
}
export default React.memo(Tool)
