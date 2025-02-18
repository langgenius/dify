import Tooltip from '@/app/components/base/tooltip'
import Indicator from '@/app/components/header/indicator'
import classNames from '@/utils/classnames'
import { memo, useMemo, useRef, useState } from 'react'
import { useAllBuiltInTools, useAllCustomTools, useAllWorkflowTools } from '@/service/use-tools'
import { getIconFromMarketPlace } from '@/utils/get-icon'
import { useTranslation } from 'react-i18next'
import { Group } from '@/app/components/base/icons/src/vender/other'

type Status = 'not-installed' | 'not-authorized' | undefined

export type ToolIconProps = {
  providerName: string
}

export const ToolIcon = memo(({ providerName }: ToolIconProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const isDataReady = !!buildInTools && !!customTools && !!workflowTools
  const currentProvider = useMemo(() => {
    const mergedTools = [...(buildInTools || []), ...(customTools || []), ...(workflowTools || [])]
    return mergedTools.find((toolWithProvider) => {
      return toolWithProvider.name === providerName
    })
  }, [buildInTools, customTools, providerName, workflowTools])
  const providerNameParts = providerName.split('/')
  const author = providerNameParts[0]
  const name = providerNameParts[1]
  const icon = useMemo(() => {
    if (currentProvider) return currentProvider.icon as string
    const iconFromMarketPlace = getIconFromMarketPlace(`${author}/${name}`)
    return iconFromMarketPlace
  }, [author, currentProvider, name])
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
        'size-5 border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge relative flex items-center justify-center rounded-[6px]',
      )}
      ref={containerRef}
    >
      {!iconFetchError
        // eslint-disable-next-line @next/next/no-img-element
        ? <img
          src={icon}
          alt='tool icon'
          className={classNames(
            'w-full h-full size-3.5 object-cover',
            notSuccess && 'opacity-50',
          )}
          onError={() => setIconFetchError(true)}
        />
        : <Group className="h-3 w-3 opacity-35" />
      }
      {indicator && <Indicator color={indicator} className="absolute right-[-1px] top-[-1px]" />}
    </div>
  </Tooltip>
})

ToolIcon.displayName = 'ToolIcon'
