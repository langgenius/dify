import Tooltip from '@/app/components/base/tooltip'
import Indicator from '@/app/components/header/indicator'
import classNames from '@/utils/classnames'
import { memo, useMemo, useRef, useState } from 'react'
import { useAllBuiltInTools, useAllCustomTools, useAllMCPTools, useAllWorkflowTools } from '@/service/use-tools'
import { getIconFromMarketPlace } from '@/utils/get-icon'
import { useTranslation } from 'react-i18next'
import { Group } from '@/app/components/base/icons/src/vender/other'
import AppIcon from '@/app/components/base/app-icon'

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
  const indicator = status === 'not-installed' ? 'red' : status === 'not-authorized' ? 'yellow' : undefined
  const notSuccess = (['not-installed', 'not-authorized'] as Array<Status>).includes(status)
  const { t } = useTranslation()
  const tooltip = useMemo(() => {
    if (!notSuccess) return undefined
    if (status === 'not-installed') return t('workflow.nodes.agent.toolNotInstallTooltip', { tool: name })
    if (status === 'not-authorized') return t('workflow.nodes.agent.toolNotAuthorizedTooltip', { tool: name })
    throw new Error('Unknown status')
  }, [name, notSuccess, status, t])
  const [iconFetchError, setIconFetchError] = useState(false)
  return <Tooltip
    triggerMethod='hover'
    popupContent={tooltip}
    disabled={!notSuccess}
  >
    <div
      className={classNames(
        'relative',
      )}
      ref={containerRef}
    >
      <div className="flex size-5 items-center justify-center overflow-hidden rounded-[6px] border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge">
        {(() => {
          if (iconFetchError || !icon)
            return <Group className="h-3 w-3 opacity-35" />
          if (typeof icon === 'string') {
            return <img
              src={icon}
              alt='tool icon'
              className={classNames(
                'size-3.5 h-full w-full object-cover',
                notSuccess && 'opacity-50',
              )}
              onError={() => setIconFetchError(true)}
            />
          }
          if (typeof icon === 'object') {
            return <AppIcon
              className={classNames(
                'size-3.5 h-full w-full object-cover',
                notSuccess && 'opacity-50',
              )}
              icon={icon?.content}
              background={icon?.background}
            />
          }
          return <Group className="h-3 w-3 opacity-35" />
        })()}
      </div>
      {indicator && <Indicator color={indicator} className="absolute -right-[1px] -top-[1px]" />}
    </div>
  </Tooltip>
})

ToolIcon.displayName = 'ToolIcon'
