'use client'
import type { FC } from 'react'
import type { ToolWithProvider } from '../../types'
import type { ToolDefaultValue } from '../types'
import type { Tool } from '@/app/components/tools/types'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import Tooltip from '@/app/components/base/tooltip'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { cn } from '@/utils/classnames'
import { basePath } from '@/utils/var'
import BlockIcon from '../../block-icon'
import { BlockEnum } from '../../types'

const normalizeProviderIcon = (icon?: ToolWithProvider['icon']) => {
  if (!icon)
    return icon
  if (typeof icon === 'string' && basePath && icon.startsWith('/') && !icon.startsWith(`${basePath}/`))
    return `${basePath}${icon}`
  return icon
}

type Props = {
  provider: ToolWithProvider
  payload: Tool
  disabled?: boolean
  isAdded?: boolean
  onSelect: (type: BlockEnum, tool: ToolDefaultValue) => void
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
  const { theme } = useTheme()
  const normalizedIcon = useMemo<ToolWithProvider['icon']>(() => {
    return normalizeProviderIcon(provider.icon) ?? provider.icon
  }, [provider.icon])
  const normalizedIconDark = useMemo(() => {
    if (!provider.icon_dark)
      return undefined
    return normalizeProviderIcon(provider.icon_dark) ?? provider.icon_dark
  }, [provider.icon_dark])
  const providerIcon = useMemo(() => {
    if (theme === Theme.dark && normalizedIconDark)
      return normalizedIconDark
    return normalizedIcon
  }, [theme, normalizedIcon, normalizedIconDark])

  return (
    <Tooltip
      key={payload.name}
      position="right"
      needsDelay={false}
      popupClassName="!p-0 !px-3 !py-2.5 !w-[200px] !leading-[18px] !text-xs !text-gray-700 !border-[0.5px] !border-black/5 !rounded-xl !shadow-lg"
      popupContent={(
        <div>
          <BlockIcon
            size="md"
            className="mb-2"
            type={BlockEnum.Tool}
            toolIcon={providerIcon}
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
            payload.parameters.forEach((item) => {
              params[item.name] = ''
            })
          }
          onSelect(BlockEnum.Tool, {
            provider_id: provider.id,
            provider_type: provider.type,
            provider_name: provider.name,
            plugin_id: provider.plugin_id,
            plugin_unique_identifier: provider.plugin_unique_identifier,
            provider_icon: normalizedIcon,
            provider_icon_dark: normalizedIconDark,
            tool_name: payload.name,
            tool_label: payload.label[language],
            tool_description: payload.description[language],
            title: payload.label[language],
            is_team_authorization: provider.is_team_authorization,
            paramSchemas: payload.parameters,
            params,
            meta: provider.meta,
          })
          trackEvent('tool_selected', {
            tool_name: payload.name,
            plugin_id: provider.plugin_id,
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
export default React.memo(ToolItem)
