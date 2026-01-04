'use client'
import type { FC } from 'react'
import type { TriggerDefaultValue, TriggerWithProvider } from '../types'
import type { Event } from '@/app/components/tools/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import { useGetLanguage } from '@/context/i18n'
import { cn } from '@/utils/classnames'
import BlockIcon from '../../block-icon'
import { BlockEnum } from '../../types'

type Props = {
  provider: TriggerWithProvider
  payload: Event
  disabled?: boolean
  isAdded?: boolean
  onSelect: (type: BlockEnum, trigger?: TriggerDefaultValue) => void
}

const TriggerPluginActionItem: FC<Props> = ({
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
      position="right"
      needsDelay={false}
      popupClassName="!p-0 !px-3 !py-2.5 !w-[224px] !leading-[18px] !text-xs !text-gray-700 !border-[0.5px] !border-black/5 !rounded-xl !shadow-lg"
      popupContent={(
        <div>
          <BlockIcon
            size="md"
            className="mb-2"
            type={BlockEnum.TriggerPlugin}
            toolIcon={provider.icon}
          />
          <div className="mb-1 text-sm leading-5 text-text-primary">{payload.label[language]}</div>
          <div className="text-xs leading-[18px] text-text-secondary">{payload.description[language]}</div>
        </div>
      )}
    >
      <div
        key={payload.name}
        className="flex cursor-pointer items-center justify-between rounded-lg pl-[21px] pr-1 hover:bg-state-base-hover"
        onClick={() => {
          if (disabled)
            return
          const params: Record<string, string> = {}
          if (payload.parameters) {
            payload.parameters.forEach((item: any) => {
              params[item.name] = ''
            })
          }
          onSelect(BlockEnum.TriggerPlugin, {
            plugin_id: provider.plugin_id,
            provider_id: provider.name,
            provider_type: provider.type as string,
            provider_name: provider.name,
            event_name: payload.name,
            event_label: payload.label[language],
            event_description: payload.description[language],
            plugin_unique_identifier: provider.plugin_unique_identifier,
            title: payload.label[language],
            is_team_authorization: provider.is_team_authorization,
            output_schema: payload.output_schema || {},
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
          <div className="system-xs-regular mr-4 text-text-tertiary">{t('addToolModal.added', { ns: 'tools' })}</div>
        )}
      </div>
    </Tooltip>
  )
}
export default React.memo(TriggerPluginActionItem)
