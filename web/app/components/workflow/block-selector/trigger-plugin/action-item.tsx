'use client'
import type { ComponentProps, FC } from 'react'
import type { TriggerDefaultValue, TriggerWithProvider } from '../types'
import type { Event } from '@/app/components/tools/types'
import { cn } from '@langgenius/dify-ui/cn'
import { PreviewCardContent, PreviewCardTrigger } from '@langgenius/dify-ui/preview-card'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useGetLanguage } from '@/context/i18n'
import BlockIcon from '../../block-icon'
import { BlockEnum } from '../../types'

type Props = {
  provider: TriggerWithProvider
  payload: Event
  previewCardHandle: TriggerPluginActionPreviewCardHandle
  disabled?: boolean
  isAdded?: boolean
  onSelect: (type: BlockEnum, trigger?: TriggerDefaultValue) => void
}

export type TriggerPluginActionPreviewPayload = {
  provider: TriggerWithProvider
  payload: Event
  language: ReturnType<typeof useGetLanguage>
}

type PreviewCardHandle = NonNullable<ComponentProps<typeof PreviewCardTrigger>['handle']>
export type TriggerPluginActionPreviewCardHandle = PreviewCardHandle

const TriggerPluginActionItem: FC<Props> = ({
  provider,
  payload,
  previewCardHandle,
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
          payload.parameters.forEach((item) => {
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
    <PreviewCardTrigger
      key={payload.name}
      delay={150}
      closeDelay={150}
      handle={previewCardHandle}
      payload={{ provider, payload, language }}
      render={row}
    />
  )
}

type TriggerPluginActionPreviewCardProps = {
  payload?: TriggerPluginActionPreviewPayload
}

export function TriggerPluginActionPreviewCard({
  payload,
}: TriggerPluginActionPreviewCardProps) {
  if (!payload)
    return null

  return (
    <PreviewCardContent placement="right" popupClassName="w-[224px] px-3 py-2.5">
      <div>
        <BlockIcon
          size="md"
          className="mb-2"
          type={BlockEnum.TriggerPlugin}
          toolIcon={payload.provider.icon}
        />
        <div className="mb-1 text-sm leading-5 text-text-primary">{payload.payload.label[payload.language]}</div>
        <div className="text-xs leading-[18px] wrap-break-word text-text-secondary">{payload.payload.description[payload.language]}</div>
      </div>
    </PreviewCardContent>
  )
}

export default React.memo(TriggerPluginActionItem)
