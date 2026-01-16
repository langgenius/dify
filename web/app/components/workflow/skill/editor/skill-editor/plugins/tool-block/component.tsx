import type { FC } from 'react'
import type { Emoji } from '@/app/components/tools/types'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { useSelectOrDelete } from '@/app/components/base/prompt-editor/hooks'
import ToolAuthorizationSection from '@/app/components/plugins/plugin-detail-panel/tool-selector/sections/tool-authorization-section'
import { generateFormValue, toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import ToolSettingsSection from '@/app/components/workflow/skill/editor/skill-editor/tool-setting/tool-settings-section'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { Theme } from '@/types/app'
import { canFindTool } from '@/utils'
import { cn } from '@/utils/classnames'
import { basePath } from '@/utils/var'
import { DELETE_TOOL_BLOCK_COMMAND } from './index'

type ToolBlockComponentProps = {
  nodeKey: string
  provider: string
  tool: string
  configId: string
  label?: string
  icon?: string | Emoji
  iconDark?: string | Emoji
}

const normalizeProviderIcon = (icon?: ToolWithProvider['icon']) => {
  if (!icon)
    return icon
  if (typeof icon === 'string' && basePath && icon.startsWith('/') && !icon.startsWith(`${basePath}/`))
    return `${basePath}${icon}`
  return icon
}

const ToolBlockComponent: FC<ToolBlockComponentProps> = ({
  nodeKey,
  provider,
  tool,
  configId,
  label,
  icon,
  iconDark,
}) => {
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_TOOL_BLOCK_COMMAND)
  const language = useGetLanguage()
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [isSettingOpen, setIsSettingOpen] = useState(false)
  const [toolValue, setToolValue] = useState<ToolValue | null>(null)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

  const mergedTools = useMemo(() => {
    return [buildInTools, customTools, workflowTools, mcpTools].filter(Boolean) as ToolWithProvider[][]
  }, [buildInTools, customTools, workflowTools, mcpTools])

  const currentProvider = useMemo(() => {
    for (const collection of mergedTools) {
      const providerItem = collection.find(item => item.name === provider || item.id === provider || canFindTool(item.id, provider))
      if (providerItem)
        return providerItem
    }
    return undefined
  }, [mergedTools, provider])

  const currentTool = useMemo(() => {
    if (!currentProvider)
      return undefined
    return currentProvider.tools?.find(item => item.name === tool)
  }, [currentProvider, tool])

  const toolMeta = useMemo(() => {
    if (!currentProvider || !currentTool)
      return null
    return {
      label: currentTool.label?.[language] || tool,
      icon: currentProvider.icon,
      iconDark: currentProvider.icon_dark,
    }
  }, [currentProvider, currentTool, language, tool])

  const defaultToolValue = useMemo(() => {
    if (!currentProvider || !currentTool)
      return null
    const settingsSchemas = toolParametersToFormSchemas(currentTool.parameters?.filter(param => param.form !== 'llm') || [])
    const paramsSchemas = toolParametersToFormSchemas(currentTool.parameters?.filter(param => param.form === 'llm') || [])
    const toolLabel = currentTool.label?.[language] || tool
    const toolDescription = typeof currentTool.description === 'object'
      ? (currentTool.description?.[language] || '')
      : (currentTool.description || '')
    return {
      provider_name: currentProvider.id,
      provider_show_name: currentProvider.name,
      tool_name: currentTool.name,
      tool_label: toolLabel,
      tool_description: toolDescription,
      settings: generateFormValue({}, settingsSchemas as any),
      parameters: generateFormValue({}, paramsSchemas as any, true),
      enabled: true,
      extra: { description: toolDescription },
    } as ToolValue
  }, [currentProvider, currentTool, language, tool])

  useEffect(() => {
    if (!defaultToolValue)
      return
    if (!toolValue || toolValue.tool_name !== defaultToolValue.tool_name || toolValue.provider_name !== defaultToolValue.provider_name)
      setToolValue(defaultToolValue)
  }, [defaultToolValue, toolValue])

  useEffect(() => {
    const containerFromRef = ref.current?.closest('[data-skill-editor-root="true"]') as HTMLElement | null
    const fallbackContainer = document.querySelector('[data-skill-editor-root="true"]') as HTMLElement | null
    const container = containerFromRef || fallbackContainer
    if (container)
      setPortalContainer(container)
  }, [ref])

  useEffect(() => {
    if (!isSettingOpen)
      return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null
      const triggerEl = ref.current
      const panelEl = portalContainer?.querySelector('[data-tool-setting-panel="true"]')
      if (!target || !panelEl)
        return
      if (panelEl.contains(target))
        return
      if (triggerEl && triggerEl.contains(target))
        return
      setIsSettingOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isSettingOpen, portalContainer, ref])

  const displayLabel = label || toolMeta?.label || tool
  const resolvedIcon = (() => {
    const fromNode = theme === Theme.dark ? iconDark : icon
    if (fromNode)
      return normalizeProviderIcon(fromNode)
    const fromMeta = theme === Theme.dark ? toolMeta?.iconDark : toolMeta?.icon
    return normalizeProviderIcon(fromMeta)
  })()

  const renderIcon = () => {
    if (!resolvedIcon)
      return null
    if (typeof resolvedIcon === 'string') {
      if (resolvedIcon.startsWith('http') || resolvedIcon.startsWith('/')) {
        return (
          <span
            className="h-[14px] w-[14px] shrink-0 rounded-[3px] bg-cover bg-center"
            style={{ backgroundImage: `url(${resolvedIcon})` }}
          />
        )
      }
      return (
        <AppIcon
          size="xs"
          icon={resolvedIcon}
          className="!h-[14px] !w-[14px] shrink-0 !border-0"
        />
      )
    }
    return (
      <AppIcon
        size="xs"
        icon={resolvedIcon.content}
        background={resolvedIcon.background}
        className="!h-[14px] !w-[14px] shrink-0 !border-0"
      />
    )
  }

  const handleToolValueChange = (nextValue: ToolValue) => {
    setToolValue(nextValue)
  }

  const handleAuthorizationItemClick = (id: string) => {
    setToolValue(prev => (prev ? { ...prev, credential_id: id } : prev))
  }

  return (
    <>
      <span
        ref={ref}
        className={cn(
          'inline-flex cursor-pointer items-center gap-[2px] rounded-[5px] border border-state-accent-hover-alt bg-state-accent-hover px-[4px] py-[1px] shadow-xs',
          isSelected && 'border-text-accent',
        )}
        title={`${provider}.${tool}`}
        data-tool-config-id={configId}
        onMouseDown={() => {
          if (!currentProvider || !currentTool)
            return
          setIsSettingOpen(true)
        }}
      >
        {renderIcon()}
        <span className="system-xs-medium max-w-[180px] truncate text-text-accent">
          {displayLabel}
        </span>
      </span>
      {portalContainer && isSettingOpen && createPortal(
        <div
          className="absolute right-4 top-4 z-[999]"
          data-tool-setting-panel="true"
        >
          <div className={cn('relative max-h-[642px] min-h-20 w-[361px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur pb-4 shadow-lg backdrop-blur-sm', 'overflow-y-auto pb-2')}>
            <div className="system-xl-semibold px-4 pb-1 pt-3.5 text-text-primary">{t('detailPanel.toolSelector.toolSetting', { ns: 'plugin' })}</div>
            {currentProvider && currentTool && toolValue && (
              <>
                <div className="px-4 pb-2 text-xs text-text-tertiary">{displayLabel}</div>
                <ToolAuthorizationSection
                  currentProvider={currentProvider}
                  credentialId={toolValue.credential_id}
                  onAuthorizationItemClick={handleAuthorizationItemClick}
                />
                <ToolSettingsSection
                  currentProvider={currentProvider}
                  currentTool={currentTool}
                  value={toolValue}
                  onChange={handleToolValueChange}
                  nodeId={undefined}
                />
              </>
            )}
          </div>
        </div>,
        portalContainer,
      )}
    </>
  )
}

export default React.memo(ToolBlockComponent)
