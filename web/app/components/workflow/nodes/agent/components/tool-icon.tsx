import Tooltip from '@/app/components/base/tooltip'
import Indicator from '@/app/components/header/indicator'
import classNames from '@/utils/classnames'
import { memo, useMemo, useRef } from 'react'
import { useAllBuiltInTools, useAllCustomTools, useAllWorkflowTools } from '@/service/use-tools'
import { getIconFromMarketPlace } from '@/utils/get-icon'

export type ToolIconProps = {
  status?: 'error' | 'warning'
  tooltip?: string
  providerName: string
}

export const ToolIcon = memo(({ status, tooltip, providerName }: ToolIconProps) => {
  const indicator = status === 'error' ? 'red' : status === 'warning' ? 'yellow' : undefined
  const containerRef = useRef<HTMLDivElement>(null)
  const notSuccess = (['error', 'warning'] as Array<ToolIconProps['status']>).includes(status)
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const currentProvider = useMemo(() => {
    const mergedTools = [...(buildInTools || []), ...(customTools || []), ...(workflowTools || [])]
    return mergedTools.find((toolWithProvider) => {
      return toolWithProvider.name === providerName
    })
  }, [providerName, buildInTools, customTools, workflowTools])
  const icon = useMemo(() => {
    if (currentProvider) return currentProvider.icon as string
    const providerNameParts = providerName.split('/')
    const author = providerNameParts[0]
    const name = providerNameParts[1]
    const iconFromMarketPlace = getIconFromMarketPlace(`${author}/${name}`)
    return iconFromMarketPlace
  }, [currentProvider, providerName])
  return <Tooltip triggerMethod='hover' popupContent={tooltip} disabled={!notSuccess}>
    <div className={classNames(
      'size-5 border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge relative flex items-center justify-center rounded-[6px]',
    )}
    ref={containerRef}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={icon}
        alt='tool icon'
        className={classNames(
          'w-full h-full size-3.5 object-cover',
          notSuccess && 'opacity-50',
        )}
      />
      {indicator && <Indicator color={indicator} className="absolute right-[-1px] top-[-1px]" />}
    </div>
  </Tooltip>
})

ToolIcon.displayName = 'ToolIcon'
