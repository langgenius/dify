'use client'
import type { ComponentProps, FC } from 'react'
import type { ToolWithProvider } from '../../types'
import type { ToolDefaultValue } from '../types'
import type { Tool } from '@/app/components/tools/types'
import { cn } from '@langgenius/dify-ui/cn'
import { PreviewCardContent, PreviewCardTrigger } from '@langgenius/dify-ui/preview-card'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
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
  previewCardHandle: PreviewCardHandle
  disabled?: boolean
  isAdded?: boolean
  onSelect: (type: BlockEnum, tool: ToolDefaultValue) => void
}

export type ToolActionPreviewPayload = {
  providerIcon: ToolWithProvider['icon']
  payload: Tool
  language: ReturnType<typeof useGetLanguage>
}

type PreviewCardHandle = NonNullable<ComponentProps<typeof PreviewCardTrigger>['handle']>
export type ToolActionPreviewCardHandle = PreviewCardHandle

const ToolItem: FC<Props> = ({
  provider,
  payload,
  previewCardHandle,
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
        onSelect(BlockEnum.Tool, {
          provider_id: provider.id,
          provider_type: provider.type,
          provider_name: provider.name,
          plugin_id: provider.plugin_id,
          plugin_unique_identifier: provider.plugin_unique_identifier,
          provider_icon: normalizedIcon,
          provider_icon_dark: normalizedIconDark,
          tool_name: payload.name,
          tool_label: payload.label[language]!,
          tool_description: payload.description[language],
          title: payload.label[language]!,
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
      <div className={cn('truncate border-l-2 border-divider-subtle py-2 pl-4 system-sm-medium text-text-secondary')}>
        <span className={cn(disabled && 'opacity-30')}>{payload.label[language]}</span>
      </div>
      {isAdded && (
        <div className="mr-4 system-xs-regular text-text-tertiary">{t('addToolModal.added', { ns: 'tools' })}</div>
      )}
    </div>
  )

  return (
    // Preview is supplementary: provider icon, tool label and description are all
    // reachable from the node inspector after the row is clicked to add the tool,
    // so hover/focus-only activation is a11y-safe. See
    // packages/dify-ui/AGENTS.md → Overlay Primitive Selection.
    <PreviewCardTrigger
      key={payload.name}
      delay={150}
      closeDelay={150}
      handle={previewCardHandle}
      payload={{
        providerIcon,
        payload,
        language,
      }}
      render={row}
    />
  )
}

type ToolActionPreviewCardProps = {
  payload?: ToolActionPreviewPayload
}

export function ToolActionPreviewCard({
  payload,
}: ToolActionPreviewCardProps) {
  if (!payload)
    return null

  return (
    <PreviewCardContent placement="right" popupClassName="w-[200px] px-3 py-2.5">
      <div>
        <BlockIcon
          size="md"
          className="mb-2"
          type={BlockEnum.Tool}
          toolIcon={payload.providerIcon}
        />
        <div className="mb-1 text-sm leading-5 text-text-primary">{payload.payload.label[payload.language]}</div>
        <div className="text-xs leading-[18px] wrap-break-word text-text-secondary">{payload.payload.description[payload.language]}</div>
      </div>
    </PreviewCardContent>
  )
}

export default React.memo(ToolItem)
