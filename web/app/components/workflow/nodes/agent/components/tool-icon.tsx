import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useQuery } from '@tanstack/react-query'
import { memo, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { selectToolsWithProvider } from '@/app/components/tools/utils/query-select'
import { consoleQuery } from '@/service/console'
import { getIconFromMarketPlace } from '@/utils/get-icon'
import { matchesProviderReference } from '@/utils/provider-reference'

type Status = 'not-installed' | 'not-authorized' | undefined

export type ToolIconProps = {
  id: string
  providerName: string
}

export const ToolIcon = memo(({ providerName }: ToolIconProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const { data: buildInTools } = useQuery(
    consoleQuery.workspaces.current.tools.builtin.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )
  const { data: customTools } = useQuery(
    consoleQuery.workspaces.current.tools.api.get.queryOptions({ select: selectToolsWithProvider }),
  )
  const { data: workflowTools } = useQuery(
    consoleQuery.workspaces.current.tools.workflow.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )
  const { data: mcpTools } = useQuery(
    consoleQuery.workspaces.current.tools.mcp.get.queryOptions({ select: selectToolsWithProvider }),
  )
  const isDataReady = !!buildInTools && !!customTools && !!workflowTools && !!mcpTools
  const currentProvider = useMemo(() => {
    const mergedTools = [
      ...(buildInTools || []),
      ...(customTools || []),
      ...(workflowTools || []),
      ...(mcpTools || []),
    ]
    return mergedTools.find((toolWithProvider) => {
      return (
        toolWithProvider.name === providerName ||
        matchesProviderReference(toolWithProvider, providerName)
      )
    })
  }, [buildInTools, customTools, providerName, workflowTools, mcpTools])

  const providerNameParts = providerName.split('/')
  const author = providerNameParts[0]
  const name = providerNameParts[1] ?? providerName
  const icon = useMemo(() => {
    if (!isDataReady) return ''
    if (currentProvider) return currentProvider.icon
    const iconFromMarketPlace = getIconFromMarketPlace(`${author}/${name}`)
    return iconFromMarketPlace
  }, [author, currentProvider, name, isDataReady])
  const status: Status = useMemo(() => {
    if (!isDataReady) return undefined
    if (!currentProvider) return 'not-installed'
    if (currentProvider.is_team_authorization === false) return 'not-authorized'
    return undefined
  }, [currentProvider, isDataReady])
  const indicator =
    status === 'not-installed' ? 'error' : status === 'not-authorized' ? 'warning' : undefined
  const notSuccess = (['not-installed', 'not-authorized'] as Array<Status>).includes(status)
  const { t } = useTranslation(['workflow'])
  const tooltip = useMemo(() => {
    if (!notSuccess) return undefined
    if (status === 'not-installed')
      return t(($) => $['nodes.agent.toolNotInstallTooltip'], { ns: 'workflow', tool: name })
    if (status === 'not-authorized')
      return t(($) => $['nodes.agent.toolNotAuthorizedTooltip'], {
        ns: 'workflow',
        tool: name,
      })
    throw new Error('Unknown status')
  }, [name, notSuccess, status, t])
  const [iconFetchError, setIconFetchError] = useState(false)
  let iconContent: ReactNode = (
    <span aria-hidden className="i-custom-vender-other-group size-3 opacity-35" />
  )

  if (!iconFetchError && icon) {
    if (typeof icon === 'string') {
      iconContent = (
        <img
          src={icon}
          alt="tool icon"
          className={cn('size-3.5 size-full object-cover', notSuccess && 'opacity-50')}
          onError={() => setIconFetchError(true)}
        />
      )
    } else if (typeof icon === 'object') {
      iconContent = (
        <AppIcon
          className={cn('size-3.5 size-full object-cover', notSuccess && 'opacity-50')}
          icon={{
            icon_type: 'emoji',
            icon: icon?.content,
            icon_background: icon?.background,
          }}
        />
      )
    }
  }

  const iconNode = (
    <div className={cn('relative')} ref={containerRef}>
      <div className="flex size-5 items-center justify-center overflow-hidden rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge">
        {iconContent}
      </div>
      {indicator && <StatusDot status={indicator} className="absolute -top-px -right-px" />}
      {tooltip && <span className="sr-only">{tooltip}</span>}
    </div>
  )

  if (!notSuccess || !tooltip) return iconNode

  return (
    <Tooltip>
      <TooltipTrigger render={iconNode} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
})

ToolIcon.displayName = 'ToolIcon'
