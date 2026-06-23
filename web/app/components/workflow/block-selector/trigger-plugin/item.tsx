'use client'
import type { FC } from 'react'
import type { TriggerPluginActionPreviewCardHandle } from './action-item'
import type { TriggerDefaultValue, TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import * as React from 'react'
import { useMemo, useRef } from 'react'
import { useTranslation } from '#i18n'
import { CollectionType } from '@/app/components/tools/types'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { basePath } from '@/utils/var'
import { BlockSelectorRow } from '../block-selector-row'
import TriggerPluginActionItem from './action-item'

const normalizeProviderIcon = (icon?: TriggerWithProvider['icon']) => {
  if (!icon)
    return icon
  if (typeof icon === 'string' && basePath && icon.startsWith('/') && !icon.startsWith(`${basePath}/`))
    return `${basePath}${icon}`
  return icon
}

type Props = Readonly<{
  className?: string
  payload: TriggerWithProvider
  hasSearchText: boolean
  previewCardHandle: TriggerPluginActionPreviewCardHandle
  onSelect: (type: BlockEnum, trigger?: TriggerDefaultValue) => void
  disabled?: boolean
}>

const TriggerPluginItem: FC<Props> = ({
  className,
  payload,
  hasSearchText,
  previewCardHandle,
  onSelect,
  disabled = false,
}) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const { theme } = useTheme()
  const notShowProvider = payload.type === CollectionType.workflow
  const actions = payload.events
  const hasAction = !notShowProvider
  const [isFold, setIsFold] = React.useState<boolean>(true)
  const [isFoldHasSearchText, setIsFoldHasSearchText] = React.useState(hasSearchText)
  const ref = useRef(null)

  if (isFoldHasSearchText !== hasSearchText) {
    setIsFoldHasSearchText(hasSearchText)
    setIsFold(!hasSearchText)
  }

  const FoldIcon = isFold ? RiArrowRightSLine : RiArrowDownSLine

  const groupName = useMemo(() => {
    if (payload.type === CollectionType.builtIn)
      return payload.author

    if (payload.type === CollectionType.custom)
      return t('tabs.customTool', { ns: 'workflow' })

    if (payload.type === CollectionType.workflow)
      return t('tabs.workflowTool', { ns: 'workflow' })

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
        <BlockSelectorRow
          nativeDisabled={disabled}
          disabled={disabled}
          className="group/item justify-between select-none"
          onClick={() => {
            if (disabled)
              return
            if (hasAction) {
              setIsFold(!isFold)
              return
            }

            const event = actions[0]
            const params: Record<string, string> = {}
            if (event!.parameters) {
              event!.parameters.forEach((item) => {
                params[item.name] = ''
              })
            }
            onSelect(BlockEnum.TriggerPlugin, {
              plugin_id: payload.plugin_id,
              provider_id: payload.name,
              provider_type: payload.type,
              provider_name: payload.name,
              event_name: event!.name,
              event_label: event!.label[language]!,
              event_description: event!.description[language]!,
              title: event!.label[language]!,
              plugin_unique_identifier: payload.plugin_unique_identifier,
              is_team_authorization: payload.is_team_authorization,
              output_schema: event!.output_schema || {},
              paramSchemas: event!.parameters,
              params,
            })
          }}
        >
          <div className="flex min-w-0 grow items-center">
            <BlockIcon
              className="mr-2 shrink-0"
              type={BlockEnum.TriggerPlugin}
              size="sm"
              toolIcon={providerIcon}
            />
            <div className="flex min-w-0 flex-1 items-center text-sm text-text-primary">
              <span className="max-w-[200px] truncate">{notShowProvider ? actions[0]?.label[language] : payload.label[language]}</span>
              <span className="ml-2 truncate system-xs-regular text-text-quaternary">{groupName}</span>
            </div>
          </div>

          <div className="ml-2 flex items-center">
            {hasAction && (
              <FoldIcon className={cn('size-4 shrink-0 text-text-tertiary group-hover/item:text-text-tertiary', isFold && 'text-text-quaternary')} />
            )}
          </div>
        </BlockSelectorRow>

        {!notShowProvider && hasAction && !isFold && (
          <ScrollAreaRoot className="relative max-h-[240px] overflow-hidden overscroll-contain">
            <ScrollAreaViewport
              aria-label={t('tabs.allTriggers', { ns: 'workflow' })}
              className="max-h-[240px] overscroll-contain"
              role="region"
            >
              <ScrollAreaContent>
                {actions.map(action => (
                  <TriggerPluginActionItem
                    key={action.name}
                    provider={providerWithResolvedIcon}
                    payload={action}
                    previewCardHandle={previewCardHandle}
                    onSelect={onSelect}
                    disabled={disabled}
                    isAdded={false}
                  />
                ))}
              </ScrollAreaContent>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar className="data-[orientation=vertical]:my-1 data-[orientation=vertical]:me-1">
              <ScrollAreaThumb />
            </ScrollAreaScrollbar>
          </ScrollAreaRoot>
        )}
      </div>
    </div>
  )
}
export default React.memo(TriggerPluginItem)
