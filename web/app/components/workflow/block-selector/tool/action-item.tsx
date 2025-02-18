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
import { RiCheckLine } from '@remixicon/react'
import Badge from '@/app/components/base/badge'

type Props = {
  provider: ToolWithProvider
  payload: Tool
  disabled?: boolean
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}

const ToolItem: FC<Props> = ({
  provider,
  payload,
  onSelect,
  disabled,
}) => {
  const { t } = useTranslation()

  const language = useGetLanguage()

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
          <div className='text-text-primary mb-1 text-sm leading-5'>{payload.label[language]}</div>
          <div className='text-text-secondary text-xs leading-[18px]'>{payload.description[language]}</div>
        </div>
      )}
    >
      <div
        key={payload.name}
        className='hover:bg-state-base-hover flex cursor-pointer items-center justify-between rounded-lg pl-[21px] pr-1'
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
            title: payload.label[language],
            is_team_authorization: provider.is_team_authorization,
            output_schema: payload.output_schema,
            paramSchemas: payload.parameters,
            params,
          })
        }}
      >
        <div className={cn('border-divider-subtle text-text-secondary system-sm-medium h-8 truncate border-l-2 pl-4 leading-8', disabled && 'opacity-30')}>{payload.label[language]}</div>
        {disabled && <Badge
          className='text-text-tertiary flex h-5 items-center space-x-0.5'
          uppercase
        >
          <RiCheckLine className='h-3 w-3 ' />
          <div>{t('tools.addToolModal.added')}</div>
        </Badge>
        }
      </div>
    </Tooltip >
  )
}
export default React.memo(ToolItem)
