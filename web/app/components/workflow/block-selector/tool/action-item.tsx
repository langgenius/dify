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

type Props = {
  provider: ToolWithProvider
  payload: Tool
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}

const ToolItem: FC<Props> = ({
  provider,
  payload,
  onSelect,
}) => {
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
          <div className='mb-1 text-sm leading-5 text-gray-900'>{payload.label[language]}</div>
          <div className='text-xs text-gray-700 leading-[18px]'>{payload.description[language]}</div>
        </div>
      )}
    >
      <div
        key={payload.name}
        className='rounded-lg pl-[21px] hover:bg-state-base-hover cursor-pointer'
        onClick={() => {
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
        <div className='h-8 leading-8 border-l-2 border-divider-subtle pl-4 truncate text-text-secondary system-sm-medium'>{payload.label[language]}</div>
      </div>
    </Tooltip >
  )
}
export default React.memo(ToolItem)
