'use client'
import { useGetLanguage } from '@/context/i18n'
import cn from '@/utils/classnames'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import type { FC } from 'react'
import React, { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { CollectionType } from '@/app/components/tools/types'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import type { TriggerDefaultValue, TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import TriggerPluginActionItem from './action-item'
import { Theme } from '@/types/app'
import useTheme from '@/hooks/use-theme'
import { basePath } from '@/utils/var'

const normalizeProviderIcon = (icon?: TriggerWithProvider['icon']) => {
  if (!icon)
    return icon
  if (typeof icon === 'string' && basePath && icon.startsWith('/') && !icon.startsWith(`${basePath}/`))
    return `${basePath}${icon}`
  return icon
}

type Props = {
  className?: string
  payload: TriggerWithProvider
  hasSearchText: boolean
  onSelect: (type: BlockEnum, trigger?: TriggerDefaultValue) => void
}

const TriggerPluginItem: FC<Props> = ({
  className,
  payload,
  hasSearchText,
  onSelect,
}) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const { theme } = useTheme()
  const notShowProvider = payload.type === CollectionType.workflow
  const actions = payload.events
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

    return payload.author || ''
  }, [payload.author, payload.type, t])
  const normalizedIcon = useMemo<TriggerWithProvider['icon']>(() => {
    return normalizeProviderIcon(payload.icon) ?? payload.icon
  }, [payload.icon])
  const normalizedIconDark = useMemo(() => {
    if (!payload.icon_dark)
      return undefined
    return normalizeProviderIcon(payload.icon_dark) ?? payload.icon_dark
  }, [payload.icon_dark])
  const providerIcon = useMemo<TriggerWithProvider['icon']>(() => {
    if (theme === Theme.dark && normalizedIconDark)
      return normalizedIconDark
    return normalizedIcon
  }, [normalizedIcon, normalizedIconDark, theme])
  const providerWithResolvedIcon = useMemo(() => ({
    ...payload,
    icon: providerIcon,
  }), [payload, providerIcon])

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

            const event = actions[0]
            const params: Record<string, string> = {}
            if (event.parameters) {
              event.parameters.forEach((item: any) => {
                params[item.name] = ''
              })
            }
            onSelect(BlockEnum.TriggerPlugin, {
              plugin_id: payload.plugin_id,
              provider_id: payload.name,
              provider_type: payload.type,
              provider_name: payload.name,
              event_name: event.name,
              event_label: event.label[language],
              event_description: event.description[language],
              title: event.label[language],
              plugin_unique_identifier: payload.plugin_unique_identifier,
              is_team_authorization: payload.is_team_authorization,
              output_schema: event.output_schema || {},
              paramSchemas: event.parameters,
              params,
            })
          }}
        >
          <div className='flex h-8 grow items-center'>
            <BlockIcon
              className='shrink-0'
              type={BlockEnum.TriggerPlugin}
              toolIcon={providerIcon}
            />
            <div className='ml-2 flex min-w-0 flex-1 items-center text-sm text-text-primary'>
              <span className='max-w-[200px] truncate'>{notShowProvider ? actions[0]?.label[language] : payload.label[language]}</span>
              <span className='system-xs-regular ml-2 truncate text-text-quaternary'>{groupName}</span>
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
              provider={providerWithResolvedIcon}
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
