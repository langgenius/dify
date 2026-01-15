import type { FC } from 'react'
import type { Emoji } from '@/app/components/tools/types'
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

type ToolBlockComponentProps = {
  nodeKey: string
  provider: string
  tool: string
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
  label,
  icon,
  iconDark,
}) => {
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_TOOL_BLOCK_COMMAND)
  const language = useGetLanguage()
  const { theme } = useTheme()
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

  const toolMeta = useMemo(() => {
    const collections = [buildInTools, customTools, workflowTools, mcpTools].filter(Boolean) as ToolWithProvider[][]
    for (const collection of collections) {
      const providerItem = collection.find(item => item.name === provider || item.id === provider || canFindTool(item.id, provider))
      if (!providerItem)
        continue
      const toolItem = providerItem.tools?.find(item => item.name === tool)
      if (!toolItem)
        continue
      return {
        label: toolItem.label?.[language] || tool,
        icon: providerItem.icon,
        iconDark: providerItem.icon_dark,
      }
    }
    return null
  }, [buildInTools, customTools, workflowTools, mcpTools, language, provider, tool])

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

  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-[2px] rounded-[5px] border border-state-accent-hover-alt bg-state-accent-hover px-[4px] py-[1px] shadow-xs',
        isSelected && 'border-text-accent',
      )}
      title={`${provider}.${tool}`}
    >
      {renderIcon()}
      <span className="system-xs-medium max-w-[180px] truncate text-text-accent">
        {displayLabel}
      </span>
    </span>
  )
}

export default React.memo(ToolBlockComponent)
