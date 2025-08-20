'use client'
import type { FC } from 'react'
import React, { useEffect, useMemo, useRef } from 'react'
import cn from '@/utils/classnames'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import { useGetLanguage } from '@/context/i18n'
import { CollectionType } from '../../../tools/types'
import type { ToolWithProvider } from '../../types'
import { BlockEnum } from '../../types'
import type { ToolDefaultValue } from '../types'
import TriggerPluginActionItem from './action-item'
import BlockIcon from '../../block-icon'
import { useTranslation } from 'react-i18next'

type Props = {
  className?: string
  payload: ToolWithProvider
  hasSearchText: boolean
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}

const TriggerPluginItem: FC<Props> = ({
  className,
  payload,
  hasSearchText,
  onSelect,
}) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const notShowProvider = payload.type === CollectionType.workflow
  const actions = payload.tools
  const hasAction = !notShowProvider
  const [isFold, setFold] = React.useState<boolean>(true)
  const ref = useRef(null)

  useEffect(() => {
    if (hasSearchText && isFold) {
      setFold(false)
      return
    }
    if (!hasSearchText && !isFold)
      setFold(true)
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
      className={cn('mb-1 last-of-type:mb-0')}
      ref={ref}
    >
      <div className={cn(className)}>
        <div
          className='group/item flex w-full cursor-pointer select-none items-center justify-between rounded-lg pl-3 pr-1 hover:bg-state-base-hover'
          onClick={() => {
            if (hasAction) {
              setFold(!isFold)
              return
            }

            const tool = actions[0]
            const params: Record<string, string> = {}
            if (tool.parameters) {
              tool.parameters.forEach((item) => {
                params[item.name] = ''
              })
            }
            onSelect(BlockEnum.TriggerPlugin, {
              provider_id: payload.id,
              provider_type: payload.type,
              provider_name: payload.name,
              tool_name: tool.name,
              tool_label: tool.label[language],
              tool_description: tool.description[language],
              title: tool.label[language],
              is_team_authorization: payload.is_team_authorization,
              output_schema: tool.output_schema,
              paramSchemas: tool.parameters,
              params,
            })
          }}
        >
          <div className='flex h-8 grow items-center'>
            <BlockIcon
              className='shrink-0'
              type={BlockEnum.TriggerPlugin}
              toolIcon={payload.icon}
            />
            <div className='ml-2 flex w-0 grow items-center text-sm text-text-primary'>
              <span className='max-w-[250px] truncate'>{notShowProvider ? actions[0]?.label[language] : payload.label[language]}</span>
              <span className='system-xs-regular ml-2 shrink-0 text-text-quaternary'>{groupName}</span>
            </div>
          </div>

          <div className='ml-2 flex items-center'>
            {hasAction && (
              <FoldIcon className={cn('h-4 w-4 shrink-0 text-text-tertiary group-hover/item:text-text-tertiary', isFold && 'text-text-quaternary')} />
            )}
          </div>
        </div>

        {!notShowProvider && hasAction && !isFold && (
          actions.map(action => (
            <TriggerPluginActionItem
              key={action.name}
              provider={payload}
              payload={action}
              onSelect={onSelect}
              disabled={false}
              isAdded={false}
            />
          ))
        )}
      </div>
    </div>
  )
}
export default React.memo(TriggerPluginItem)
