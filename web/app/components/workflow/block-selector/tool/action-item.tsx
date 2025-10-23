'use client'
import type { FC } from 'react'
import React from 'react'
import type { ToolWithProvider } from '../../types'
import { BlockEnum } from '../../types'
import type { ToolDefaultValue } from '../types'
import Tooltip from '@/app/components/base/tooltip'
import type { Tool } from '@/app/components/tools/types'
import { useGetLanguage } from '@/context/i18n'
import BlockIcon from '../../block-icon'
import cn from '@/utils/classnames'
import { useTranslation } from 'react-i18next'

type Props = {
  provider: ToolWithProvider
  payload: Tool
  disabled?: boolean
  isAdded?: boolean
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}

const ToolItem: FC<Props> = ({
  provider,
  payload,
  onSelect,
  disabled,
  isAdded,
}) => {
  const { t } = useTranslation()

  const language = useGetLanguage()

  return (
    <Tooltip
      key={payload.name}
      position='right'
      needsDelay={false}
      popupClassName='!p-0 !px-3 !py-2.5 !w-[200px] !leading-[18px] !text-xs !text-gray-700 !border-[0.5px] !border-black/5 !rounded-xl !shadow-lg'
      popupContent={(
        <div>
          <BlockIcon
            size='md'
            className='mb-2'
            type={BlockEnum.Tool}
            toolIcon={provider.icon}
          />
          <div className='mb-1 text-sm leading-5 text-text-primary'>{payload.label[language]}</div>
          <div className='text-xs leading-[18px] text-text-secondary'>{payload.description[language]}</div>
        </div>
      )}
    >
      <div
        key={payload.name}
        className='flex cursor-pointer items-center justify-between rounded-lg pl-[21px] pr-1 hover:bg-state-base-hover'
        onClick={() => {
          if (disabled) return
          const params: Record<string, string> = {}
          if (payload.parameters) {
            payload.parameters.forEach((item) => {
              params[item.name] = ''
            })
          }
          onSelect(BlockEnum.Tool, {
            provider_id: provider.id,
            provider_type: provider.type,
            provider_name: provider.name,
            tool_name: payload.name,
            tool_label: payload.label[language],
            tool_description: payload.description[language],
            title: payload.label[language],
            is_team_authorization: provider.is_team_authorization,
            paramSchemas: payload.parameters,
            params,
            meta: provider.meta,
          })
        }}
      >
        <div className={cn('system-sm-medium h-8 truncate border-l-2 border-divider-subtle pl-4 leading-8 text-text-secondary')}>
          <span className={cn(disabled && 'opacity-30')}>{payload.label[language]}</span>
        </div>
        {isAdded && (
          <div className='system-xs-regular mr-4 text-text-tertiary'>{t('tools.addToolModal.added')}</div>
        )}
      </div>
    </Tooltip >
  )
}
export default React.memo(ToolItem)
