'use client'
import type { Tool as ToolType } from '../../../tools/types'
import type { ToolWithProvider } from '../../types'
import type { ToolDefaultValue, ToolValue } from '../types'
import type { ToolActionPreviewCardHandle } from './action-item'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useMCPToolAvailability } from '@/app/components/workflow/nodes/_base/components/mcp-tool-availability'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { basePath } from '@/utils/var'
import { CollectionType } from '../../../tools/types'
import BlockIcon from '../../block-icon'
import McpToolNotSupportTooltip from '../../nodes/_base/components/mcp-tool-not-support-tooltip'
import { BlockEnum } from '../../types'
import { ViewType } from '../types'
import ActionItem from './action-item'

const normalizeProviderIcon = (icon?: ToolWithProvider['icon']) => {
  if (!icon) return icon!
  if (
    typeof icon === 'string' &&
    basePath &&
    icon.startsWith('/') &&
    !icon.startsWith(`${basePath}/`)
  )
    return `${basePath}${icon}`
  return icon
}

type Props = Readonly<{
  className?: string
  payload: ToolWithProvider
  previewCardHandle: ToolActionPreviewCardHandle
  viewType: ViewType
  hasSearchText: boolean
  onSelect: (type: BlockEnum, tool: ToolDefaultValue) => void
  canNotSelectMultiple?: boolean
  onSelectMultiple?: (type: BlockEnum, tools: ToolDefaultValue[]) => void
  selectedTools?: ToolValue[]
  isShowLetterIndex?: boolean
}>

function Tool({
  className,
  payload,
  previewCardHandle,
  viewType,
  hasSearchText,
  onSelect,
  canNotSelectMultiple,
  onSelectMultiple,
  selectedTools,
}: Props) {
  const { t } = useTranslation()
  const { allowed: isMCPToolAllowed } = useMCPToolAvailability()
  const language = useGetLanguage()
  const isFlatView = viewType === ViewType.flat
  const notShowProvider = payload.type === CollectionType.workflow
  const actions = payload.tools
  const panelId = React.useId()
  const [open, setOpen] = React.useState(hasSearchText)
  const [previousHasSearchText, setPreviousHasSearchText] = React.useState(hasSearchText)
  const isMCPTool = payload.type === CollectionType.mcp
  const isShowCanNotChooseMCPTip = !isMCPToolAllowed && isMCPTool
  const { theme } = useTheme()
  const normalizedIcon = useMemo<ToolWithProvider['icon']>(() => {
    return normalizeProviderIcon(payload.icon) ?? payload.icon
  }, [payload.icon])
  const normalizedIconDark = useMemo(() => {
    if (!payload.icon_dark) return undefined!
    return normalizeProviderIcon(payload.icon_dark) ?? payload.icon_dark
  }, [payload.icon_dark])
  const providerIcon = useMemo<ToolWithProvider['icon']>(() => {
    if (theme === Theme.dark && normalizedIconDark) return normalizedIconDark
    return normalizedIcon
  }, [theme, normalizedIcon, normalizedIconDark])
  const getIsDisabled = useCallback(
    (tool: ToolType) => {
      if (!selectedTools || !selectedTools.length) return false
      return selectedTools.some(
        (selectedTool) =>
          (selectedTool.provider_name === payload.name ||
            selectedTool.provider_name === payload.id) &&
          selectedTool.tool_name === tool.name,
      )
    },
    [payload.id, payload.name, selectedTools],
  )

  const totalToolsNum = actions.length
  const selectedToolsNum = actions.filter((action) => getIsDisabled(action)).length
  const isAllSelected = selectedToolsNum === totalToolsNum

  if (previousHasSearchText !== hasSearchText) {
    setPreviousHasSearchText(hasSearchText)
    setOpen(hasSearchText)
  }

  const groupName = useMemo(() => {
    if (payload.type === CollectionType.builtIn) return payload.author

    if (payload.type === CollectionType.custom)
      return t(($) => $['tabs.customTool'], { ns: 'workflow' })

    if (payload.type === CollectionType.workflow)
      return t(($) => $['tabs.workflowTool'], { ns: 'workflow' })

    return ''
  }, [payload.author, payload.type, t])

  const providerDetails = (
    <div
      className={cn('flex h-8 min-w-0 grow items-center', isShowCanNotChooseMCPTip && 'opacity-30')}
    >
      <BlockIcon className="shrink-0" type={BlockEnum.Tool} toolIcon={providerIcon} />
      <div className="ml-2 flex w-0 grow items-center text-sm text-text-primary">
        <span className="max-w-[250px] truncate">
          {notShowProvider ? actions[0]?.label[language] : payload.label[language]}
        </span>
        {isFlatView && groupName && (
          <span className="ml-2 shrink-0 system-xs-regular text-text-quaternary">{groupName}</span>
        )}
        {isMCPTool && (
          <span
            aria-hidden
            className="ml-2 i-custom-vender-other-mcp size-3.5 shrink-0 text-text-quaternary"
          />
        )}
      </div>
    </div>
  )

  const selectedStatus = selectedToolsNum
    ? isAllSelected
      ? t(($) => $['tabs.allAdded'], { ns: 'workflow' })
      : `${selectedToolsNum} / ${totalToolsNum}`
    : undefined

  const handleSelectAll = () => {
    onSelectMultiple?.(
      BlockEnum.Tool,
      actions
        .filter((action) => !getIsDisabled(action))
        .map((tool) => {
          const params: Record<string, string> = {}
          tool.parameters?.forEach((item) => {
            params[item.name] = ''
          })
          return {
            provider_id: payload.id,
            provider_type: payload.type,
            provider_name: payload.name,
            provider_show_name: payload.label[language],
            plugin_id: payload.plugin_id!,
            plugin_unique_identifier: payload.plugin_unique_identifier!,
            provider_icon: normalizedIcon,
            provider_icon_dark: normalizedIconDark,
            tool_name: tool.name,
            tool_label: tool.label[language]!,
            tool_description: tool.description[language],
            title: tool.label[language]!,
            is_team_authorization: payload.is_team_authorization,
            paramSchemas: tool.parameters,
            params,
          }
        }),
    )
  }

  const handleWorkflowToolSelect = () => {
    const tool = actions[0]!
    const params: Record<string, string> = {}
    tool.parameters?.forEach((item) => {
      params[item.name] = ''
    })
    onSelect(BlockEnum.Tool, {
      provider_id: payload.id,
      provider_type: payload.type,
      provider_name: payload.name,
      provider_show_name: payload.label[language],
      plugin_id: payload.plugin_id,
      plugin_unique_identifier: payload.plugin_unique_identifier,
      provider_icon: normalizedIcon,
      provider_icon_dark: normalizedIconDark,
      tool_name: tool.name,
      tool_label: tool.label[language]!,
      tool_description: tool.description[language],
      title: tool.label[language]!,
      is_team_authorization: payload.is_team_authorization,
      paramSchemas: tool.parameters,
      params,
    })
  }

  if (notShowProvider) {
    return (
      <div className={cn('mb-1 last-of-type:mb-0', className)}>
        <button
          type="button"
          className="flex h-8 w-full cursor-pointer items-center rounded-lg border-0 bg-transparent pr-2 pl-3 text-left hover:bg-state-base-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid focus-visible:outline-hidden"
          onClick={handleWorkflowToolSelect}
        >
          {providerDetails}
          {!canNotSelectMultiple && selectedStatus && (
            <span className="ml-2 shrink-0 system-xs-regular text-text-tertiary">
              {t(($) => $['addToolModal.added'], { ns: 'tools' })}
            </span>
          )}
        </button>
      </div>
    )
  }

  return (
    <Collapsible
      className={cn('mb-1 last-of-type:mb-0', className)}
      open={open}
      onOpenChange={setOpen}
    >
      <div className="group/item relative flex w-full items-center rounded-lg">
        <CollapsibleTrigger
          aria-controls={panelId}
          className="h-8 min-h-8 w-full min-w-0 justify-start gap-0 rounded-lg bg-transparent py-0 pr-2 pl-3 group-hover/item:bg-state-base-hover hover:not-data-disabled:bg-state-base-hover focus-visible:ring-inset"
        >
          {providerDetails}
          {!isShowCanNotChooseMCPTip && !canNotSelectMultiple && selectedStatus && (
            <span
              className={cn(
                'ml-2 shrink-0 system-xs-regular text-text-tertiary',
                !isAllSelected &&
                  'group-focus-within/item:hidden group-hover/item:hidden [@media(hover:none)]:hidden',
              )}
            >
              {selectedStatus}
            </span>
          )}
          <span
            aria-hidden
            className={cn(
              'ml-2 i-ri-arrow-right-s-line size-4 shrink-0 text-text-quaternary transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none',
              !isShowCanNotChooseMCPTip &&
                !canNotSelectMultiple &&
                !isAllSelected &&
                onSelectMultiple &&
                'group-focus-within/item:hidden group-hover/item:hidden [@media(hover:none)]:hidden',
              isShowCanNotChooseMCPTip && 'mr-7',
            )}
          />
        </CollapsibleTrigger>

        {!isShowCanNotChooseMCPTip &&
          !canNotSelectMultiple &&
          !isAllSelected &&
          onSelectMultiple && (
            <Button
              variant="ghost"
              size="small"
              className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 text-components-button-secondary-accent-text opacity-0 group-focus-within/item:pointer-events-auto group-focus-within/item:opacity-100 group-hover/item:pointer-events-auto group-hover/item:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                handleSelectAll()
              }}
            >
              {t(($) => $['tabs.addAll'], { ns: 'workflow' })}
            </Button>
          )}
        {isShowCanNotChooseMCPTip && (
          <div className="absolute top-1/2 right-3 flex -translate-y-1/2">
            <McpToolNotSupportTooltip />
          </div>
        )}
      </div>

      <CollapsiblePanel id={panelId}>
        {actions.map((action) => (
          <ActionItem
            key={action.name}
            provider={payload}
            payload={action}
            previewCardHandle={previewCardHandle}
            onSelect={onSelect}
            disabled={getIsDisabled(action) || isShowCanNotChooseMCPTip}
            isAdded={getIsDisabled(action)}
          />
        ))}
      </CollapsiblePanel>
    </Collapsible>
  )
}
export default React.memo(Tool)
