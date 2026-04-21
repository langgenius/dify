'use client'
import type { FC } from 'react'
import type { TriggerDefaultValue, TriggerWithProvider } from '../types'
import type { Event } from '@/app/components/tools/types'
import { cn } from '@langgenius/dify-ui/cn'
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from '@langgenius/dify-ui/preview-card'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useGetLanguage } from '@/context/i18n'
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

  const row = (
    <div
      key={payload.name}
      className="flex cursor-pointer items-center justify-between rounded-lg pr-1 pl-[21px] hover:bg-state-base-hover"
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
          event_label: payload.label[language]!,
          event_description: payload.description[language]!,
          plugin_unique_identifier: provider.plugin_unique_identifier,
          title: payload.label[language]!,
          is_team_authorization: provider.is_team_authorization,
          output_schema: payload.output_schema || {},
          paramSchemas: payload.parameters,
          params,
          meta: provider.meta,
        })
      }}
    >
      <div className={cn('truncate border-l-2 border-divider-subtle py-2 pl-4 system-sm-medium text-text-secondary')}>
        <span className={cn(disabled && 'opacity-30')}>{payload.label[language]}</span>
      </div>
      {isAdded && (
        <div className="mr-4 system-xs-regular text-text-tertiary">{t('addToolModal.added', { ns: 'tools' })}</div>
      )}
    </div>
  )

  return (
    // Preview is supplementary: provider icon, event label and description are all
    // reachable from the node inspector after the row is clicked to add the trigger,
    // so hover/focus-only activation is a11y-safe. See
    // packages/dify-ui/AGENTS.md → Overlay Primitive Selection.
    <PreviewCard key={payload.name}>
      <PreviewCardTrigger delay={150} closeDelay={150} render={row} />
      <PreviewCardContent placement="right" popupClassName="w-[224px] px-3 py-2.5">
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
      </PreviewCardContent>
    </PreviewCard>
  )
}
export default React.memo(TriggerPluginActionItem)
