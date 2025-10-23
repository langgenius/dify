import type { FC, ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export type EntryNodeStatus = 'enabled' | 'disabled'

type EntryNodeContainerProps = {
  children: ReactNode
  status?: EntryNodeStatus
  customLabel?: string
  nodeType?: 'start' | 'trigger'
}

const EntryNodeContainer: FC<EntryNodeContainerProps> = ({
  children,
  customLabel,
  nodeType = 'trigger',
}) => {
  const { t } = useTranslation()

  const statusConfig = useMemo(() => {
    const translationKey = nodeType === 'start' ? 'entryNodeStatus' : 'triggerStatus'

    return {
      label: customLabel || t(`workflow.${translationKey}.enabled`),
      dotClasses: 'bg-components-badge-status-light-success-bg border-components-badge-status-light-success-border-inner',
    }
  }, [customLabel, nodeType, t])

  return (
    <div className="w-fit min-w-[242px] rounded-2xl bg-workflow-block-wrapper-bg-1 px-0 pb-0 pt-0.5">
      <div className="mb-0.5 flex items-center px-1.5 pt-0.5">
        <span className="text-2xs font-semibold uppercase text-text-tertiary">
          {statusConfig.label}
        </span>
      </div>
      {children}
    </div>
  )
}

export default EntryNodeContainer
