import type { FC, ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export type EntryNodeStatus = 'enabled' | 'disabled'

type EntryNodeContainerProps = {
  children: ReactNode
  status?: EntryNodeStatus
  customLabel?: string
  showIndicator?: boolean
  nodeType?: 'start' | 'trigger'
}

const EntryNodeContainer: FC<EntryNodeContainerProps> = ({
  children,
  status = 'enabled',
  customLabel,
  showIndicator = true,
  nodeType = 'trigger',
}) => {
  const { t } = useTranslation()

  const statusConfig = useMemo(() => {
    const isDisabled = status === 'disabled'
    const translationKey = nodeType === 'start' ? 'entryNodeStatus' : 'triggerStatus'

    return {
      label: customLabel || (isDisabled ? t(`workflow.${translationKey}.disabled`) : t(`workflow.${translationKey}.enabled`)),
      indicatorColor: isDisabled ? 'gray' : 'green',
    }
  }, [status, customLabel, nodeType, t])

  return (
    <div className="w-[242px] rounded-2xl bg-workflow-block-wrapper-bg-1 px-0 pb-0 pt-0.5">
      <div className="mb-0.5 flex items-center px-1.5 pt-0.5">
        {showIndicator && (
          <div className={`mr-0.5 h-2 w-2 rounded-[3px] border border-solid ${
            statusConfig.indicatorColor === 'gray'
              ? 'border-components-badge-status-light-disabled-border-inner bg-components-badge-status-light-disabled-bg'
              : 'border-components-badge-status-light-success-border-inner bg-components-badge-status-light-success-bg'
          }`} />
        )}
        <span className="text-2xs font-semibold uppercase text-text-tertiary">
          {statusConfig.label}
        </span>
      </div>
      {children}
    </div>
  )
}

export default EntryNodeContainer
