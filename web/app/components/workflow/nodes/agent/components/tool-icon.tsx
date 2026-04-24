import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { Group } from '@/app/components/base/icons/src/vender/other'
import Indicator from '@/app/components/header/indicator'
import { useAllBuiltInTools, useAllCustomTools, useAllMCPTools, useAllWorkflowTools } from '@/service/use-tools'
import { getIconFromMarketPlace } from '@/utils/get-icon'

type Status = 'not-installed' | 'not-authorized' | undefined

export type ToolIconProps = {
  id: string
  providerName: string
}

export const ToolIcon = memo(({ providerName }: ToolIconProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const isDataReady = !!buildInTools && !!customTools && !!workflowTools && !!mcpTools
  const currentProvider = useMemo(() => {
    const mergedTools = [...(buildInTools || []), ...(customTools || []), ...(workflowTools || []), ...(mcpTools || [])]
    return mergedTools.find((toolWithProvider) => {
      return toolWithProvider.name === providerName || toolWithProvider.id === providerName
    })
  }, [buildInTools, customTools, providerName, workflowTools, mcpTools])

  const providerNameParts = providerName.split('/')
  const author = providerNameParts[0]
  const name = providerNameParts[1]
  const icon = useMemo(() => {
    if (!isDataReady)
      return ''
    if (currentProvider)
      return currentProvider.icon
    const iconFromMarketPlace = getIconFromMarketPlace(`${author}/${name}`)
    return iconFromMarketPlace
  }, [author, currentProvider, name, isDataReady])
  const status: Status = useMemo(() => {
    if (!isDataReady)
      return undefined
    if (!currentProvider)
      return 'not-installed'
    if (currentProvider.is_team_authorization === false)
      return 'not-authorized'
    return undefined
  }, [currentProvider, isDataReady])
  const indicator = status === 'not-installed' ? 'red' : status === 'not-authorized' ? 'yellow' : undefined
  const notSuccess = (['not-installed', 'not-authorized'] as Array<Status>).includes(status)
  const { t } = useTranslation()
  const tooltip = useMemo(() => {
    if (!notSuccess)
      return undefined
    if (status === 'not-installed')
      return t('nodes.agent.toolNotInstallTooltip', { ns: 'workflow', tool: name })
    if (status === 'not-authorized')
      return t('nodes.agent.toolNotAuthorizedTooltip', { ns: 'workflow', tool: name })
    throw new Error('Unknown status')
  }, [name, notSuccess, status, t])
  const [iconFetchError, setIconFetchError] = useState(false)
  let iconContent: ReactNode = <Group className="h-3 w-3 opacity-35" />

  if (!iconFetchError && icon) {
    if (typeof icon === 'string') {
      iconContent = (
        <img
          src={icon}
          alt="tool icon"
          className={cn('size-3.5 h-full w-full object-cover', notSuccess && 'opacity-50')}
          onError={() => setIconFetchError(true)}
        />
      )
    }
    else if (typeof icon === 'object') {
      iconContent = (
        <AppIcon
          className={cn('size-3.5 h-full w-full object-cover', notSuccess && 'opacity-50')}
          icon={icon?.content}
          background={icon?.background}
        />
      )
    }
  }

  const iconNode = (
    <div
      aria-label={tooltip}
      className={cn('relative')}
      ref={containerRef}
    >
      <div className="flex size-5 items-center justify-center overflow-hidden rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge">
        {iconContent}
      </div>
      {indicator && <Indicator color={indicator} className="absolute -top-px -right-px" />}
    </div>
  )

  if (!notSuccess || !tooltip)
    return iconNode

  return (
    <Tooltip>
      <TooltipTrigger render={iconNode} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
})

ToolIcon.displayName = 'ToolIcon'
