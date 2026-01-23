import type { FC } from 'react'
import type { ToolToken } from './utils'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import * as React from 'react'
import { useMemo } from 'react'
import AppIcon from '@/app/components/base/app-icon'
import { useSelectOrDelete } from '@/app/components/base/prompt-editor/hooks'
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

type ToolGroupBlockComponentProps = {
  nodeKey: string
  tools: ToolToken[]
}

const normalizeProviderIcon = (icon?: ToolWithProvider['icon']) => {
  if (!icon)
    return icon
  if (typeof icon === 'string' && basePath && icon.startsWith('/') && !icon.startsWith(`${basePath}/`))
    return `${basePath}${icon}`
  return icon
}

const ToolGroupBlockComponent: FC<ToolGroupBlockComponentProps> = ({
  nodeKey,
  tools,
}) => {
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_TOOL_BLOCK_COMMAND)
  const language = useGetLanguage()
  const { theme } = useTheme()
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

  const mergedTools = useMemo(() => {
    return [buildInTools, customTools, workflowTools, mcpTools].filter(Boolean) as ToolWithProvider[][]
  }, [buildInTools, customTools, workflowTools, mcpTools])

  const providerId = tools[0]?.provider || ''
  const currentProvider = useMemo(() => {
    if (!providerId)
      return undefined
    for (const collection of mergedTools) {
      const providerItem = collection.find(item => item.name === providerId || item.id === providerId || canFindTool(item.id, providerId))
      if (providerItem)
        return providerItem
    }
    return undefined
  }, [mergedTools, providerId])

  const providerLabel = currentProvider?.label?.[language] || currentProvider?.name || providerId
  const resolvedIcon = (() => {
    const fromMeta = theme === Theme.dark ? currentProvider?.icon_dark : currentProvider?.icon
    return normalizeProviderIcon(fromMeta)
  })()

  const renderIcon = () => {
    if (!resolvedIcon)
      return null
    if (typeof resolvedIcon === 'string') {
      if (resolvedIcon.startsWith('http') || resolvedIcon.startsWith('/')) {
        return (
          <span
            className="h-4 w-4 shrink-0 rounded-[4px] bg-cover bg-center"
            style={{ backgroundImage: `url(${resolvedIcon})` }}
          />
        )
      }
      return (
        <AppIcon
          size="xs"
          icon={resolvedIcon}
          className="!h-4 !w-4 shrink-0 !border-0"
        />
      )
    }
    return (
      <AppIcon
        size="xs"
        icon={resolvedIcon.content}
        background={resolvedIcon.background}
        className="!h-4 !w-4 shrink-0 !border-0"
      />
    )
  }

  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-[2px] rounded-[5px] border border-state-accent-hover-alt bg-state-accent-hover px-[4px] py-[1px] shadow-xs',
        isSelected && 'border-text-accent',
      )}
      title={providerLabel}
    >
      {renderIcon()}
      <span className="system-xs-medium max-w-[160px] truncate text-text-accent">
        {providerLabel}
      </span>
      <span className="system-2xs-medium-uppercase rounded-[5px] border border-text-accent-secondary bg-components-badge-bg-dimm px-[4px] py-[2px] text-text-accent-secondary">
        {tools.length}
      </span>
    </span>
  )
}

export default React.memo(ToolGroupBlockComponent)
